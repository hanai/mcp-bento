import { serve, type HttpBindings } from '@hono/node-server'
import { RESPONSE_ALREADY_SENT } from '@hono/node-server/utils/response'
import { Hono } from 'hono'
import type { Context } from 'hono'

import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { Server as McpServer } from '@modelcontextprotocol/sdk/server/index.js'
import {
    CallToolRequestSchema,
    ErrorCode,
    GetPromptRequestSchema,
    ListPromptsRequestSchema,
    ListToolsRequestSchema,
    McpError,
    type CallToolRequest,
    type GetPromptRequest,
    type ServerCapabilities,
} from '@modelcontextprotocol/sdk/types.js'

import type { Config } from './types.js'
import { Profile } from './profile.js'
import { ConnectorRegistry } from './connectors/index.js'
import { logger } from './logger.js'
import { CleanupManager } from './cleanupManager.js'

const MCP_SERVER_VERSION = '1.0.0'
const MCP_SERVER_NAME = 'bento'

const createCapabilities = (): ServerCapabilities => ({
    tools: {},
    prompts: {},
})

const createServerForProfile = (activeProfile: Profile): McpServer => {
    const capabilities = createCapabilities()
    const server = new McpServer(
        { name: MCP_SERVER_NAME, version: MCP_SERVER_VERSION },
        { capabilities }
    )

    server.setRequestHandler(ListToolsRequestSchema, () => ({
        tools: activeProfile.listTools(),
    }))

    server.setRequestHandler(ListPromptsRequestSchema, () => ({
        prompts: activeProfile.listPrompts(),
    }))

    server.setRequestHandler(
        CallToolRequestSchema,
        async (request: CallToolRequest) => {
            return activeProfile.callTool(request.params)
        }
    )

    server.setRequestHandler(
        GetPromptRequestSchema,
        async (request: GetPromptRequest) => {
            return activeProfile.getPrompt(request.params)
        }
    )

    return server
}

const toMcpError = (error: unknown): McpError => {
    if (error instanceof McpError) {
        return error
    }
    if (error instanceof Error) {
        return new McpError(ErrorCode.InternalError, error.message)
    }
    return new McpError(ErrorCode.InternalError, 'Unknown error')
}

const jsonErrorResponse = (error: McpError, status = 400): Response =>
    new Response(
        JSON.stringify({
            jsonrpc: '2.0',
            error: {
                code: error.code,
                message: error.message,
                data:
                    error instanceof McpError && error.data !== undefined
                        ? error.data
                        : undefined,
            },
            id: null,
        }),
        {
            status,
            headers: { 'content-type': 'application/json; charset=utf-8' },
        }
    )

const ALLOWED_METHODS = new Set(['POST', 'GET', 'DELETE'])

type ValidationResult =
    | { status: 'ok'; profileName: string; method: string }
    | { status: 'error'; response: Response }

const validateRequest = (
    c: Context<{ Bindings: HttpBindings }>
): ValidationResult => {
    if (!ALLOWED_METHODS.has(c.req.method)) {
        return {
            status: 'error',
            response: jsonErrorResponse(
                new McpError(ErrorCode.InvalidRequest, 'Method not allowed'),
                405
            ),
        }
    }

    const profileName = c.req.query('profile')
    if (!profileName) {
        return {
            status: 'error',
            response: jsonErrorResponse(
                new McpError(
                    ErrorCode.InvalidRequest,
                    'Missing profile query parameter'
                ),
                400
            ),
        }
    }

    return { status: 'ok', profileName, method: c.req.method }
}

type ProfileResolutionResult =
    | { status: 'ok'; profile: Profile }
    | { status: 'error'; response: Response }

interface ResolveActiveProfileOptions {
    config: Config
    registry: ConnectorRegistry
    profileName: string
}

const resolveActiveProfile = async ({
    config,
    registry,
    profileName,
}: ResolveActiveProfileOptions): Promise<ProfileResolutionResult> => {
    try {
        const profile = await Profile.create({
            config,
            profileName,
            registry,
        })
        return { status: 'ok', profile }
    } catch (error) {
        return { status: 'error', response: jsonErrorResponse(toMcpError(error)) }
    }
}

interface DispatchRequestOptions {
    context: Context<{ Bindings: HttpBindings }>
    profileName: string
    method: string
    transport: StreamableHTTPServerTransport
    incoming: HttpBindings['incoming']
    outgoing: HttpBindings['outgoing']
}

const dispatchRequest = async ({
    context,
    profileName,
    method,
    transport,
    incoming,
    outgoing,
}: DispatchRequestOptions) => {
    let parsedBody: unknown
    if (method === 'POST') {
        try {
            parsedBody = await context.req.json()
        } catch (parseError) {
            let rawBody: string | undefined
            try {
                rawBody = await context.req.text()
            } catch {
                // ignore failures while fetching raw body text for logging purposes
            }
            logger.warn(
                {
                    err: parseError,
                    profile: profileName,
                    rawBody,
                },
                'Failed to parse request body as JSON'
            )
        }
    }

    await transport.handleRequest(incoming, outgoing, parsedBody)
}

export const createApp = (config: Config, registry: ConnectorRegistry) => {
    const app = new Hono<{ Bindings: HttpBindings }>()

    const handler = async (c: Context<{ Bindings: HttpBindings }>) => {
        const validation = validateRequest(c)
        if (validation.status === 'error') {
            return validation.response
        }

        const profileResult = await resolveActiveProfile({
            config,
            registry,
            profileName: validation.profileName,
        })
        if (profileResult.status === 'error') {
            return profileResult.response
        }

        const incoming = c.env.incoming
        const outgoing = c.env.outgoing
        const transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: undefined,
        })
        const server = createServerForProfile(profileResult.profile)
        const cleanup = new CleanupManager({
            profileName: validation.profileName,
        })
        cleanup.watchEmitter(outgoing, ['close', 'finish', 'error'])
        cleanup.register(async () => {
            try {
                await transport.close()
            } catch (closeError) {
                logger.warn(
                    { err: closeError, profile: validation.profileName },
                    'Unable to close HTTP transport cleanly'
                )
            }
        })
        cleanup.register(async () => {
            try {
                await server.close()
            } catch (closeError) {
                logger.warn(
                    { err: closeError, profile: validation.profileName },
                    'Unable to close MCP server cleanly'
                )
            }
        })

        try {
            await server.connect(transport)
            await dispatchRequest({
                context: c,
                profileName: validation.profileName,
                method: validation.method,
                transport,
                incoming,
                outgoing,
            })
        } catch (error) {
            logger.error(
                { err: error, profile: validation.profileName },
                'Error handling request'
            )
            cleanup.run({ cause: error })
        }

        return RESPONSE_ALREADY_SENT
    }

    app.post('/mcp', handler)
    app.get('/mcp', handler)
    app.delete('/mcp', handler)

    app.all('*', () =>
        jsonErrorResponse(
            new McpError(ErrorCode.InvalidRequest, 'Not found'),
            404
        )
    )

    return app
}

export const startServer = (config: Config, registry: ConnectorRegistry) => {
    const app = createApp(config, registry)
    const [hostname, portText] = config.listen.split(':')
    const port = Number.parseInt(portText, 10)

    return serve({
        fetch: app.fetch,
        hostname,
        port,
    })
}
