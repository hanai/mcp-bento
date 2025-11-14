#!/usr/bin/env node
import http from 'node:http'
import process from 'node:process'

import { Server as BaseServer } from '@modelcontextprotocol/sdk/server/index.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import {
    CallToolRequestSchema,
    ErrorCode,
    GetPromptRequestSchema,
    ListPromptsRequestSchema,
    ListToolsRequestSchema,
    McpError,
} from '@modelcontextprotocol/sdk/types.js'

const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined })
const server = new BaseServer(
    { name: 'fixture-http', version: '1.0.0' },
    { capabilities: { tools: {}, prompts: {} } }
)

const toolEntries = new Map([
    [
        'http_alpha',
        {
            definition: {
                name: 'http_alpha',
                description: 'Echo message via http-alpha',
                inputSchema: createMessageSchema(),
            },
            respond: (message) => createEchoResult('http-alpha', message),
        },
    ],
    [
        'http_beta',
        {
            definition: {
                name: 'http_beta',
                description: 'Echo message via http-beta',
                inputSchema: createMessageSchema(),
            },
            respond: (message) => createEchoResult('http-beta', message),
        },
    ],
])

const promptEntries = new Map([
    [
        'http_greeting',
        {
            definition: {
                name: 'http_greeting',
                description: 'Greeting from the HTTP fixture',
            },
            result: createPromptResult('Hello from the HTTP fixture'),
        },
    ],
    [
        'http_status',
        {
            definition: {
                name: 'http_status',
                description: 'Status update from the HTTP fixture',
            },
            result: createPromptResult('HTTP fixture is running smoothly'),
        },
    ],
])

server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: Array.from(toolEntries.values()).map((entry) => entry.definition),
}))

server.setRequestHandler(ListPromptsRequestSchema, () => ({
    prompts: Array.from(promptEntries.values()).map((entry) => entry.definition),
}))

server.setRequestHandler(CallToolRequestSchema, (request) => {
    const entry = toolEntries.get(request.params.name)
    if (!entry) {
        throw new McpError(
            ErrorCode.MethodNotFound,
            `Unknown tool: ${request.params.name}`
        )
    }
    const message = extractMessageArgument(request.params.arguments)
    return entry.respond(message)
})

server.setRequestHandler(GetPromptRequestSchema, (request) => {
    const entry = promptEntries.get(request.params.name)
    if (!entry) {
        throw new McpError(
            ErrorCode.MethodNotFound,
            `Unknown prompt: ${request.params.name}`
        )
    }
    return entry.result
})

const httpServer = http.createServer(async (req, res) => {
    try {
        await transport.handleRequest(req, res)
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        res.writeHead(500, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ error: message }))
    }
})

const shutdown = async (signal) => {
    try {
        await server.close()
    } catch (error) {
        console.error('Failed to close MCP server', error)
    }
    try {
        await transport.close?.()
    } catch (error) {
        console.error('Failed to close transport', error)
    }
    await new Promise((resolve) => {
        httpServer.close(() => resolve())
    })
    console.error(`SHUTDOWN ${signal}`)
    process.exit(0)
}

process.once('SIGINT', () => {
    void shutdown('SIGINT')
})
process.once('SIGTERM', () => {
    void shutdown('SIGTERM')
})

const port = Number.parseInt(process.env.PORT ?? '0', 10)

const start = async () => {
    await server.connect(transport)
    httpServer.listen(port, '127.0.0.1', () => {
        const address = httpServer.address()
        const actualPort =
            typeof address === 'object' && address !== null
                ? address.port
                : port
        console.log(`READY ${actualPort}`)
    })
}

start().catch((error) => {
    console.error('HTTP fixture failed to start', error)
    process.exit(1)
})

function extractMessageArgument(args) {
    if (!args || typeof args !== 'object') {
        throw new McpError(ErrorCode.InvalidParams, 'Missing arguments')
    }
    const { message } = args
    if (typeof message !== 'string') {
        throw new McpError(
            ErrorCode.InvalidParams,
            'Argument "message" must be a string'
        )
    }
    return message
}

function createMessageSchema() {
    return {
        type: 'object',
        properties: {
            message: {
                type: 'string',
                description: 'Message to echo back',
            },
        },
        required: ['message'],
    }
}

function createEchoResult(source, message) {
    return {
        content: [
            {
                type: 'text',
                text: JSON.stringify({ source, message }),
            },
        ],
        isError: false,
    }
}

function createPromptResult(text) {
    return {
        description: text,
        messages: [
            {
                role: 'assistant',
                content: {
                    type: 'text',
                    text,
                },
            },
        ],
    }
}
