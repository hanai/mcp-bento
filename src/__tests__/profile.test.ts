import { describe, expect, it } from 'vitest'

import { Profile } from '../profile.js'
import type { Config } from '../types.js'
import type { Connector, ConnectorRegistry } from '../connectors/index.js'
import {
    McpError,
    ErrorCode,
    type CallToolRequest,
    type GetPromptRequest,
    type Prompt,
    type Tool,
} from '@modelcontextprotocol/sdk/types.js'
import type {
    CallToolResultType,
    GetPromptResultType,
} from '../connectors/types.js'

const createTool = (name: string): Tool =>
    ({
        name,
        inputSchema: { type: 'object' },
    }) as Tool

const createPrompt = (name: string): Prompt =>
    ({
        name,
    }) as Prompt

const createConnectorRegistry = (
    connectors: Record<string, Connector>
): ConnectorRegistry =>
    ({
        get(id: string): Connector {
            const connector = connectors[id]
            if (!connector) {
                throw new McpError(
                    ErrorCode.InvalidRequest,
                    `Unknown server id ${id}`
                )
            }
            return connector
        },
        async disposeAll(): Promise<void> {
            /* no-op for tests */
        },
    }) as unknown as ConnectorRegistry

const createConnector = (options: {
    id: string
    tools?: Tool[]
    prompts?: Prompt[]
    ensureReadyError?: Error
    kind?: 'http' | 'stdio'
    onCallTool?: (params: CallToolRequest['params']) => void
    onGetPrompt?: (params: GetPromptRequest['params']) => void
}): Connector => {
    const {
        id,
        tools = [],
        prompts = [],
        ensureReadyError,
        kind = 'http',
        onCallTool,
        onGetPrompt,
    } = options

    return {
        id,
        kind,
        async ensureReady() {
            if (ensureReadyError) {
                throw ensureReadyError
            }
        },
        async listTools() {
            return tools
        },
        async listPrompts() {
            return prompts
        },
        async callTool(params) {
            onCallTool?.(params)
            return {} as CallToolResultType
        },
        async getPrompt(params) {
            onGetPrompt?.(params)
            return {} as GetPromptResultType
        },
        async dispose() {
            /* no-op */
        },
    } satisfies Connector
}

const baseConfig: Config = {
    listen: 'localhost:3003',
    mcpServers: {
        alpha: { type: 'http', url: 'https://alpha.example' },
        beta: { type: 'http', url: 'https://beta.example' },
    },
    profiles: {
        base: {
            alpha: {},
        },
        child: {
            base: {},
        },
    },
}

describe('Profile.create', () => {
    it('applies default prefixes and tool/prompt allowlists', async () => {
        const connectors = createConnectorRegistry({
            alpha: createConnector({
                id: 'alpha',
                tools: [createTool('time'), createTool('date')],
                prompts: [createPrompt('timezone'), createPrompt('format')],
            }),
        })

        const config: Config = {
            ...baseConfig,
            profiles: {
                default: {
                    alpha: {
                        tools: ['time'],
                        prompts: ['timezone'],
                    },
                },
            },
        }

        const profile = await Profile.create({
            config,
            profileName: 'default',
            registry: connectors,
        })

        expect(profile.listTools().map((tool) => tool.name)).toEqual([
            'alpha__time',
        ])
        expect(profile.listPrompts().map((prompt) => prompt.name)).toEqual([
            'alpha__timezone',
        ])
    })

    it('treats prefix false as no prefix for servers', async () => {
        const connectors = createConnectorRegistry({
            alpha: createConnector({
                id: 'alpha',
                tools: [createTool('search'), createTool('summarize')],
                prompts: [createPrompt('daily'), createPrompt('weekly')],
            }),
        })

        const config: Config = {
            ...baseConfig,
            profiles: {
                default: {
                    alpha: {
                        prefix: false,
                    },
                },
            },
        }

        const profile = await Profile.create({
            config,
            profileName: 'default',
            registry: connectors,
        })

        expect(profile.listTools().map((tool) => tool.name)).toEqual([
            'search',
            'summarize',
        ])
        expect(profile.listPrompts().map((prompt) => prompt.name)).toEqual([
            'daily',
            'weekly',
        ])
    })

    it('merges nested profiles with prefixes and allowlists', async () => {
        const connectors = createConnectorRegistry({
            alpha: createConnector({
                id: 'alpha',
                tools: [createTool('search'), createTool('summarize')],
                prompts: [createPrompt('daily'), createPrompt('weekly')],
            }),
        })

        const config: Config = {
            ...baseConfig,
            profiles: {
                base: {
                    alpha: {},
                },
                nested: {
                    base: {
                        prefix: 'nested__',
                        tools: ['alpha__search'],
                        prompts: ['alpha__daily'],
                    },
                },
            },
        }

        const profile = await Profile.create({
            config,
            profileName: 'nested',
            registry: connectors,
        })

        expect(profile.listTools().map((tool) => tool.name)).toEqual([
            'nested__alpha__search',
        ])
        expect(profile.listPrompts().map((prompt) => prompt.name)).toEqual([
            'nested__alpha__daily',
        ])
    })

    it('merges nested profiles without overriding prefixes when unset', async () => {
        const connectors = createConnectorRegistry({
            alpha: createConnector({
                id: 'alpha',
                tools: [createTool('search'), createTool('summarize')],
                prompts: [createPrompt('daily'), createPrompt('weekly')],
            }),
        })

        const config: Config = {
            ...baseConfig,
            profiles: {
                base: {
                    alpha: {},
                },
                nested: {
                    base: {},
                },
            },
        }

        const profile = await Profile.create({
            config,
            profileName: 'nested',
            registry: connectors,
        })

        expect(profile.listTools().map((tool) => tool.name)).toEqual([
            'alpha__search',
            'alpha__summarize',
        ])
        expect(profile.listPrompts().map((prompt) => prompt.name)).toEqual([
            'alpha__daily',
            'alpha__weekly',
        ])
    })

    it('treats nested prefix false as empty string', async () => {
        const connectors = createConnectorRegistry({
            alpha: createConnector({
                id: 'alpha',
                tools: [createTool('search')],
                prompts: [createPrompt('daily')],
            }),
        })

        const config: Config = {
            ...baseConfig,
            profiles: {
                base: {
                    alpha: {},
                },
                nested: {
                    base: {
                        prefix: false,
                    },
                },
            },
        }

        const profile = await Profile.create({
            config,
            profileName: 'nested',
            registry: connectors,
        })

        expect(profile.listTools().map((tool) => tool.name)).toEqual([
            'alpha__search',
        ])
        expect(profile.listPrompts().map((prompt) => prompt.name)).toEqual([
            'alpha__daily',
        ])
    })

    it('applies nested prefixes while preserving upstream identifiers', async () => {
        const connectors = createConnectorRegistry({
            github: createConnector({
                id: 'github',
                tools: [createTool('list_commits')],
            }),
        })

        const config: Config = {
            listen: 'localhost:3003',
            mcpServers: {
                github: { type: 'http', url: 'https://github.example' },
            },
            profiles: {
                'github-readonly': {
                    github: {
                        prefix: 'github__',
                        tools: ['list_commits'],
                    },
                },
                default: {
                    'github-readonly': {
                        prefix: 'gh__',
                        tools: ['github__list_commits'],
                    },
                },
            },
        }

        const profile = await Profile.create({
            config,
            profileName: 'default',
            registry: connectors,
        })

        expect(profile.listTools().map((tool) => tool.name)).toEqual([
            'gh__github__list_commits',
        ])
    })

    it('skips servers that fail to initialize', async () => {
        const connectors = createConnectorRegistry({
            alpha: createConnector({
                id: 'alpha',
                tools: [createTool('search')],
                prompts: [createPrompt('weekly')],
                ensureReadyError: new Error('boom'),
            }),
        })

        const config: Config = {
            ...baseConfig,
            profiles: {
                default: {
                    alpha: {},
                },
            },
        }

        const profile = await Profile.create({
            config,
            profileName: 'default',
            registry: connectors,
        })

        expect(profile.listTools()).toHaveLength(0)
        expect(profile.listPrompts()).toHaveLength(0)
    })

    it('forwards tool and prompt calls using original names', async () => {
        let capturedToolName: string | undefined
        let capturedPromptName: string | undefined

        const connectors = createConnectorRegistry({
            alpha: createConnector({
                id: 'alpha',
                tools: [createTool('search')],
                prompts: [createPrompt('daily')],
                onCallTool: (params) => {
                    capturedToolName = params.name
                },
                onGetPrompt: (params) => {
                    capturedPromptName = params.name
                },
            }),
        })

        const config: Config = {
            ...baseConfig,
            profiles: {
                default: {
                    alpha: {
                        prefix: 'alpha__',
                    },
                },
            },
        }

        const profile = await Profile.create({
            config,
            profileName: 'default',
            registry: connectors,
        })

        await profile.callTool({
            name: 'alpha__search',
            arguments: {},
        })

        await profile.getPrompt({
            name: 'alpha__daily',
            arguments: {},
        })

        expect(capturedToolName).toBe('search')
        expect(capturedPromptName).toBe('daily')
    })

    it('rejects circular profile references', async () => {
        const connectors = createConnectorRegistry({
            alpha: createConnector({
                id: 'alpha',
                tools: [createTool('search')],
            }),
        })

        const config: Config = {
            ...baseConfig,
            profiles: {
                loopA: {
                    loopB: {},
                },
                loopB: {
                    loopA: {},
                },
            },
        }

        await expect(
            Profile.create({
            config,
            profileName: 'loopA',
            registry: connectors,
        })
        ).rejects.toMatchObject({ code: ErrorCode.InvalidRequest })
    })

    it('throws when referencing an unknown profile or server', async () => {
        const connectors = createConnectorRegistry({
            alpha: createConnector({
                id: 'alpha',
            }),
        })

        const config: Config = {
            ...baseConfig,
            profiles: {
                invalid: {
                    missing: {},
                },
            },
        }

        await expect(
            Profile.create({
            config,
            profileName: 'invalid',
            registry: connectors,
        })
        ).rejects.toMatchObject({ code: ErrorCode.InvalidRequest })
    })
})
