import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js'

import type { Config, ProfileConfig } from './types.js'
import type { Connector } from './connectors/index.js'
import { ConnectorRegistry } from './connectors/index.js'
import type {
    CallToolRequest,
    GetPromptRequest,
    Prompt,
    Tool,
} from '@modelcontextprotocol/sdk/types.js'
import { logger } from './logger.js'
import type {
    CallToolResultType,
    GetPromptResultType,
} from './connectors/types.js'

interface ToolEntry {
    connector: Connector
    tool: Tool
    originalName: string
}

interface PromptEntry {
    connector: Connector
    prompt: Prompt
    originalName: string
}

interface ProfileInit {
    name: string
    tools: Map<string, ToolEntry>
    prompts: Map<string, PromptEntry>
}

interface ProfileCreateOptions {
    config: Config
    profileName: string
    registry: ConnectorRegistry
}

export class Profile {
    readonly name: string
    private readonly tools: Map<string, ToolEntry>
    private readonly prompts: Map<string, PromptEntry>
    private readonly toolList: Tool[]
    private readonly promptList: Prompt[]

    constructor({ name, tools, prompts }: ProfileInit) {
        this.name = name
        this.tools = tools
        this.prompts = prompts
        this.toolList = Array.from(this.tools.values()).map(
            (entry) => entry.tool
        )
        this.promptList = Array.from(this.prompts.values()).map(
            (entry) => entry.prompt
        )
    }

    listTools(): readonly Tool[] {
        return this.toolList
    }

    listPrompts(): readonly Prompt[] {
        return this.promptList
    }

    async callTool(
        params: CallToolRequest['params']
    ): Promise<CallToolResultType> {
        const entry = this.tools.get(params.name)
        if (!entry) {
            throw new McpError(
                ErrorCode.MethodNotFound,
                `Unknown tool: ${params.name}`
            )
        }
        return entry.connector.callTool({
            ...params,
            name: entry.originalName,
        })
    }

    async getPrompt(
        params: GetPromptRequest['params']
    ): Promise<GetPromptResultType> {
        const entry = this.prompts.get(params.name)
        if (!entry) {
            throw new McpError(
                ErrorCode.MethodNotFound,
                `Unknown prompt: ${params.name}`
            )
        }
        return entry.connector.getPrompt({
            ...params,
            name: entry.originalName,
        })
    }

    static async create({
        config,
        profileName,
        registry,
    }: ProfileCreateOptions): Promise<Profile> {
        const resolver = new ProfileResolver(config, registry)
        const { tools, prompts } = await resolver.resolve(profileName)
        return new Profile({ name: profileName, tools, prompts })
    }
}

const toAllowlist = (values?: string[]): Set<string> | undefined => {
    if (!values) {
        return undefined
    }
    return new Set(values)
}

const resolvePrefixValue = (
    value: ProfileConfig['prefix'],
    fallback: string
): string => {
    if (value === false) {
        return ''
    }
    return value ?? fallback
}

const shouldInclude = (allowlist: Set<string> | undefined, name: string) =>
    allowlist === undefined || allowlist.has(name)

interface MergeEntriesOptions<TItem, TEntry> {
    items: Iterable<TItem>
    target: Map<string, TEntry>
    allowlist?: Set<string>
    prefix: string
    getName: (item: TItem) => string
    createEntry: (item: TItem, exportedName: string) => TEntry
}

const mergeEntries = <TItem, TEntry>(options: MergeEntriesOptions<TItem, TEntry>) => {
    const { items, target, allowlist, prefix, getName, createEntry } = options
    for (const item of items) {
        const name = getName(item)
        if (!shouldInclude(allowlist, name)) {
            continue
        }
        const exportedName = `${prefix}${name}`
        if (target.has(exportedName)) {
            continue
        }
        target.set(exportedName, createEntry(item, exportedName))
    }
}

const assertProfile = (
    profile: Record<string, ProfileConfig> | undefined,
    profileName: string
) => {
    if (!profile) {
        throw new McpError(
            ErrorCode.InvalidRequest,
            `Unknown profile: ${profileName}`
        )
    }
    return profile
}

export interface ResolutionResult {
    tools: Map<string, ToolEntry>
    prompts: Map<string, PromptEntry>
}

interface HandleServerEntryOptions {
    profileName: string
    serverId: string
    selection: ProfileConfig
    registry: ConnectorRegistry
    tools: Map<string, ToolEntry>
    prompts: Map<string, PromptEntry>
}

const handleServerEntry = async ({
    profileName,
    serverId,
    selection,
    registry,
    tools,
    prompts,
}: HandleServerEntryOptions): Promise<void> => {
    const connector = registry.get(serverId)
    try {
        await connector.ensureReady()
    } catch (error) {
        logger.warn(
            { err: error, serverId, profile: profileName },
            'Failed to initialize connector'
        )
        return
    }

    const toolAllowlist = toAllowlist(selection.tools)
    const promptAllowlist = toAllowlist(selection.prompts)
    const prefix = resolvePrefixValue(selection.prefix, `${serverId}__`)

    const serverTools = await connector.listTools().catch((error: unknown) => {
        if (
            error instanceof McpError &&
            error.code === ErrorCode.MethodNotFound
        ) {
            return [] satisfies Tool[]
        }
        logger.warn(
            { err: error, serverId, profile: profileName },
            'Failed to list tools'
        )
        return [] as Tool[]
    })

    mergeEntries<Tool, ToolEntry>({
        items: serverTools,
        target: tools,
        allowlist: toolAllowlist,
        prefix,
        getName: (tool) => tool.name,
        createEntry: (tool, exportedName) => ({
            connector,
            tool: { ...tool, name: exportedName },
            originalName: tool.name,
        }),
    })

    const serverPrompts = await connector
        .listPrompts()
        .catch((error: unknown) => {
            if (
                error instanceof McpError &&
                error.code === ErrorCode.MethodNotFound
            ) {
                return [] satisfies Prompt[]
            }
            logger.warn(
                { err: error, serverId, profile: profileName },
                'Failed to list prompts'
            )
            return [] as Prompt[]
        })

    mergeEntries<Prompt, PromptEntry>({
        items: serverPrompts,
        target: prompts,
        allowlist: promptAllowlist,
        prefix,
        getName: (prompt) => prompt.name,
        createEntry: (prompt, exportedName) => ({
            connector,
            prompt: { ...prompt, name: exportedName },
            originalName: prompt.name,
        }),
    })
}

interface MergeNestedProfileOptions {
    selection: ProfileConfig
    nested: ResolutionResult
    tools: Map<string, ToolEntry>
    prompts: Map<string, PromptEntry>
}

const mergeNestedProfile = ({
    selection,
    nested,
    tools,
    prompts,
}: MergeNestedProfileOptions) => {
    const toolAllowlist = toAllowlist(selection.tools)
    const promptAllowlist = toAllowlist(selection.prompts)
    const prefix = resolvePrefixValue(selection.prefix, '')

    mergeEntries<[string, ToolEntry], ToolEntry>({
        items: nested.tools.entries(),
        target: tools,
        allowlist: toolAllowlist,
        prefix,
        getName: ([nestedName]) => nestedName,
        createEntry: ([, entry], exportedName) => ({
            connector: entry.connector,
            tool: { ...entry.tool, name: exportedName },
            originalName: entry.originalName,
        }),
    })

    mergeEntries<[string, PromptEntry], PromptEntry>({
        items: nested.prompts.entries(),
        target: prompts,
        allowlist: promptAllowlist,
        prefix,
        getName: ([nestedName]) => nestedName,
        createEntry: ([, entry], exportedName) => ({
            connector: entry.connector,
            prompt: { ...entry.prompt, name: exportedName },
            originalName: entry.originalName,
        }),
    })
}

export class ProfileResolver {
    private readonly cache = new Map<string, ResolutionResult>()

    constructor(
        private readonly config: Config,
        private readonly registry: ConnectorRegistry
    ) {}

    async resolve(profileName: string): Promise<ResolutionResult> {
        return this.resolveRecursive(profileName, [])
    }

    private async resolveRecursive(
        profileName: string,
        stack: string[]
    ): Promise<ResolutionResult> {
        const cached = this.cache.get(profileName)
        if (cached) {
            return cached
        }

        if (stack.includes(profileName)) {
            const cycle = [...stack, profileName].join(' -> ')
            throw new McpError(
                ErrorCode.InvalidRequest,
                `Circular profile reference detected: ${cycle}`
            )
        }

        stack.push(profileName)

        try {
            const profileConfig = assertProfile(
                this.config.profiles[profileName],
                profileName
            )
            const result: ResolutionResult = {
                tools: new Map<string, ToolEntry>(),
                prompts: new Map<string, PromptEntry>(),
            }

            for (const [entryName, selection] of Object.entries(profileConfig)) {
                if (Object.hasOwn(this.config.mcpServers, entryName)) {
                    await handleServerEntry({
                        profileName,
                        serverId: entryName,
                        selection,
                        registry: this.registry,
                        tools: result.tools,
                        prompts: result.prompts,
                    })
                    continue
                }

                if (Object.hasOwn(this.config.profiles, entryName)) {
                    const nested = await this.resolveRecursive(entryName, stack)
                    mergeNestedProfile({
                        selection,
                        nested,
                        tools: result.tools,
                        prompts: result.prompts,
                    })
                    continue
                }

                throw new McpError(
                    ErrorCode.InvalidRequest,
                    `Unknown server or profile '${entryName}' referenced by profile '${profileName}'`
                )
            }

            this.cache.set(profileName, result)
            return result
        } finally {
            stack.pop()
        }
    }
}
