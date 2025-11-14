import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { once } from 'node:events'
import fs from 'node:fs/promises'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import readline from 'node:readline'
import { fileURLToPath } from 'node:url'

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'

const repoRoot = path.resolve(fileURLToPath(new URL('../..', import.meta.url)))
const fixturesDir = path.join(repoRoot, 'src', '__tests__', 'fixtures')
const httpFixturePath = path.join(fixturesDir, 'http-mcp-server.mjs')
const stdioFixturePath = path.join(fixturesDir, 'stdio-mcp-server.mjs')
const configTemplatePath = path.join(fixturesDir, 'config.integration.json')
const tsxBin = path.join(repoRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs')
const CLIENT_CONNECTION_TIMEOUT_MS = 20000
const CLIENT_RETRY_DELAY_MS = 250
const PROCESS_TERMINATION_TIMEOUT_MS = 5000

interface SpawnedFixture {
    child: ChildProcessWithoutNullStreams
    port: number
}

let httpFixture: SpawnedFixture | null = null
let activeGateway: ChildProcessWithoutNullStreams | null = null
const tempConfigDirectories: string[] = []

beforeAll(async () => {
    httpFixture = await startHttpFixture()
})

afterAll(async () => {
    if (httpFixture) {
        await terminateProcess(httpFixture.child)
        httpFixture = null
    }
})

afterEach(async () => {
    if (activeGateway) {
        await terminateProcess(activeGateway, 'SIGINT')
        activeGateway = null
    }
    await cleanupTempConfigDirectories()
})

describe('mcp-bento integration', () => {
    test(
        'forwards tools and prompts from HTTP and stdio servers',
        { timeout: 60000 },
        async () => {
            if (!httpFixture) {
                throw new Error('HTTP fixture failed to start')
            }

            const bentoPort = await getAvailablePort()
            const configPath = await copyIntegrationConfig()
            const env = {
                ...process.env,
                BENTO_PORT: String(bentoPort),
                FIXTURE_HTTP_PORT: String(httpFixture.port),
                STDIO_SERVER_PATH: stdioFixturePath,
            }

            const cli = spawn(
                process.execPath,
                [tsxBin, path.join('src', 'index.ts'), 'serve', configPath],
                {
                    cwd: repoRoot,
                    env,
                    stdio: ['ignore', 'pipe', 'pipe'],
                }
            )
            activeGateway = cli

            const client = await connectClientWithRetry(
                new URL(`http://127.0.0.1:${bentoPort}/mcp?profile=default`)
            )

            try {
                const { tools } = await client.listTools()
                const toolNames = tools.map((tool) => tool.name)
                expect(toolNames).toEqual(
                    expect.arrayContaining([
                        'http_alpha',
                        'http_beta',
                        'stdio_alpha',
                        'stdio_beta',
                    ])
                )

                const { prompts } = await client.listPrompts()
                const promptNames = prompts.map((prompt) => prompt.name)
                expect(promptNames).toEqual(
                    expect.arrayContaining([
                        'http_greeting',
                        'http_status',
                        'stdio_greeting',
                        'stdio_status',
                    ])
                )

                const httpCall = await client.callTool({
                    name: 'http_alpha',
                    arguments: { message: 'hello from http' },
                })
                expect(extractTextContent(httpCall.content)).toContain('http-alpha')

                const stdioCall = await client.callTool({
                    name: 'stdio_beta',
                    arguments: { message: 'hello from stdio' },
                })
                expect(extractTextContent(stdioCall.content)).toContain('stdio-beta')

                const httpPrompt = await client.getPrompt({ name: 'http_greeting' })
                expect(extractPromptText(httpPrompt.messages)).toContain(
                    'HTTP fixture'
                )

                const stdioPrompt = await client.getPrompt({ name: 'stdio_status' })
                expect(extractPromptText(stdioPrompt.messages)).toContain(
                    'STDIO fixture'
                )
            } finally {
                await client.close()
            }
        }
    )
})

const startHttpFixture = async (): Promise<SpawnedFixture> => {
    const child = spawn(process.execPath, [httpFixturePath], {
        env: { ...process.env, PORT: '0' },
        stdio: ['ignore', 'pipe', 'pipe'],
    })
    const port = await waitForReadyPort(child)
    return { child, port }
}

const waitForReadyPort = async (child: ChildProcessWithoutNullStreams) => {
    if (!child.stdout) {
        throw new Error('Fixture stdout is not available')
    }
    const rl = readline.createInterface({ input: child.stdout })
    return await new Promise<number>((resolve, reject) => {
        const onLine = (line: string) => {
            if (line.startsWith('READY ')) {
                cleanup()
                resolve(Number.parseInt(line.slice(6), 10))
            }
        }
        const onError = (error: unknown) => {
            cleanup()
            reject(error instanceof Error ? error : new Error(String(error)))
        }
        const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
            cleanup()
            reject(
                new Error(
                    `HTTP fixture exited before reporting readiness (code=${code}, signal=${signal})`
                )
            )
        }
        const cleanup = () => {
            rl.removeListener('line', onLine)
            rl.close()
            child.off('error', onError)
            child.off('exit', onExit)
        }
        rl.on('line', onLine)
        child.once('error', onError)
        child.once('exit', onExit)
    })
}

const copyIntegrationConfig = async (): Promise<string> => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-bento-'))
    const destination = path.join(tempDir, 'config.integration.json')
    await fs.copyFile(configTemplatePath, destination)
    tempConfigDirectories.push(tempDir)
    return destination
}

const cleanupTempConfigDirectories = async () => {
    while (tempConfigDirectories.length > 0) {
        const dir = tempConfigDirectories.pop()
        if (!dir) {
            continue
        }
        try {
            await fs.rm(dir, { recursive: true, force: true })
        } catch (error) {
            console.warn('Failed to remove temporary config directory', dir, error)
        }
    }
}

const getAvailablePort = async (): Promise<number> => {
    return await new Promise<number>((resolve, reject) => {
        const server = net.createServer()
        server.unref()
        server.once('error', (error) => {
            server.close()
            reject(error)
        })
        server.listen(0, '127.0.0.1', () => {
            const address = server.address()
            if (typeof address === 'object' && address) {
                const port = address.port
                server.close(() => resolve(port))
            } else {
                server.close(() => reject(new Error('Unable to determine port')))
            }
        })
    })
}

const connectClientWithRetry = async (
    baseUrl: URL,
    timeoutMs = CLIENT_CONNECTION_TIMEOUT_MS
) => {
    const deadline = Date.now() + timeoutMs
    let lastError: unknown
    while (Date.now() < deadline) {
        const client = new Client({ name: 'integration-test', version: '1.0.0' })
        const transport = new StreamableHTTPClientTransport(baseUrl)
        try {
            await client.connect(transport)
            return client
        } catch (error) {
            lastError = error
            await client.close().catch(() => {})
            await new Promise((resolve) => setTimeout(resolve, CLIENT_RETRY_DELAY_MS))
        }
    }
    const message = lastError instanceof Error ? lastError.message : String(lastError)
    throw new Error(`Unable to connect to MCP gateway: ${message}`)
}

const terminateProcess = async (
    child: ChildProcessWithoutNullStreams,
    signal: NodeJS.Signals = 'SIGTERM'
) => {
    if (child.exitCode !== null || child.signalCode) {
        return
    }
    child.kill(signal)
    await Promise.race([
        once(child, 'exit'),
        new Promise((_, reject) =>
            setTimeout(
                () => reject(new Error('Process termination timeout')),
                PROCESS_TERMINATION_TIMEOUT_MS
            )
        ),
    ])
}

const extractTextContent = (
    content: Awaited<ReturnType<Client['callTool']>>['content']
): string => {
    if (!content) {
        return ''
    }
    const textPart = content.find((entry) => entry.type === 'text')
    return textPart && 'text' in textPart ? textPart.text : ''
}

const extractPromptText = (
    messages: Awaited<ReturnType<Client['getPrompt']>>['messages']
): string => {
    const first = messages[0]
    if (!first) {
        return ''
    }
    const content = first.content
    if (Array.isArray(content)) {
        const textPart = content.find((entry) => entry.type === 'text')
        return textPart && 'text' in textPart ? textPart.text : ''
    }
    return content && content.type === 'text' ? content.text : ''
}
