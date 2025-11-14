#!/usr/bin/env node
import process from 'node:process'

import { Server as BaseServer } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  ErrorCode,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ListToolsRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js'

import {
  createEchoResult,
  createMessageSchema,
  createPromptResult,
  extractMessageArgument,
} from './mcp-fixture-utils.mjs'

const transport = new StdioServerTransport()
const server = new BaseServer(
    { name: 'fixture-stdio', version: '1.0.0' },
    { capabilities: { tools: {}, prompts: {} } }
)

const toolEntries = new Map([
    [
        'stdio_alpha',
        {
            definition: {
                name: 'stdio_alpha',
                description: 'Echo message via stdio-alpha',
                inputSchema: createMessageSchema(),
            },
            respond: (message) => createEchoResult('stdio-alpha', message),
        },
    ],
    [
        'stdio_beta',
        {
            definition: {
                name: 'stdio_beta',
                description: 'Echo message via stdio-beta',
                inputSchema: createMessageSchema(),
            },
            respond: (message) => createEchoResult('stdio-beta', message),
        },
    ],
])

const promptEntries = new Map([
    [
        'stdio_greeting',
        {
            definition: {
                name: 'stdio_greeting',
                description: 'Greeting from the stdio fixture',
            },
            result: createPromptResult('Hello from the stdio fixture'),
        },
    ],
    [
        'stdio_status',
        {
            definition: {
                name: 'stdio_status',
                description: 'Status update from the stdio fixture',
            },
            result: createPromptResult('STDIO fixture is running smoothly'),
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

const shutdown = async (signal) => {
    try {
        await server.close()
    } catch (error) {
        console.error('Failed to close MCP server', error)
    }
    try {
        await transport.close()
    } catch (error) {
        console.error('Failed to close transport', error)
    }
    console.error(`SHUTDOWN ${signal}`)
    process.exit(0)
}

process.once('SIGINT', () => {
    void shutdown('SIGINT')
})
process.once('SIGTERM', () => {
    void shutdown('SIGTERM')
})

const start = async () => {
    await server.connect(transport)
    process.stdin.resume()
}

start().catch((error) => {
    console.error('STDIO fixture failed to start', error)
    process.exit(1)
})
