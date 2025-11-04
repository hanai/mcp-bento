#! /usr/bin/env node
import process from 'node:process'

import { Command } from 'commander'
import {
    ErrorCode,
    McpError,
    type Prompt,
    type Tool,
} from '@modelcontextprotocol/sdk/types.js'

import { loadConfig } from './config.js'
import { ConnectorRegistry } from './connectors/index.js'
import type { Connector } from './connectors/types.js'
import { applyEnvFiles } from './env.js'
import { logger } from './logger.js'
import { Profile } from './profile.js'
import { startServer } from './server.js'
import type { Config } from './types.js'

type ListKind = 'tools' | 'prompts'
type SectionEntry = Tool | Prompt

interface Section {
    label: string
    entries: ReadonlyArray<SectionEntry>
}

interface RuntimeContext {
    configPath: string
    config: Config
    registry: ConnectorRegistry
}

interface ServeOptions {
    config?: string
}

interface ListOptions {
    config: string
}

interface RunCliOptions {
    exitOnSuccess?: boolean
}

const program = new Command()
let envFilesApplied = false

program.name('mcp-bento').description('MCP Bento gateway CLI')

program
    .command('serve [configPath]', { isDefault: true })
    .description('Start the MCP gateway server')
    .option('-c, --config <path>', 'Path to the configuration file')
    .action((configPath: string | undefined, options: ServeOptions) => {
        const resolved = resolveServeConfigPath(configPath, options.config)
        runCli(() => runServe(resolved))
    })

program.option(
    '--env-file <path>',
    'Load environment variables from file (same semantics as `node --env-file`).',
    collectEnvFileOption,
    []
)

program.hook('preAction', (_thisCommand, actionCommand) => {
    if (envFilesApplied) {
        return
    }
    const options = actionCommand.optsWithGlobals()
    const envFiles = Array.isArray(options.envFile) ? options.envFile : []
    applyEnvFiles(envFiles)
    envFilesApplied = true
})

addListCommand('tools')
addListCommand('prompts')

program.parse(process.argv)

function runCli(handler: () => Promise<void>, options?: RunCliOptions): void {
    handler()
        .then(() => {
            if (options?.exitOnSuccess) {
                process.exit(0)
            }
        })
        .catch(handleCliError)
}

function resolveServeConfigPath(
    positional: string | undefined,
    flag: string | undefined
): string {
    if (positional && flag) {
        throw new Error(
            'Provide the configuration path either as a positional argument or with -c/--config, not both.'
        )
    }

    const resolved = positional ?? flag

    if (!resolved) {
        throw new Error(
            'Configuration file path is required. Supply it as a positional argument or with -c/--config.'
        )
    }

    return resolved
}

function addListCommand(kind: ListKind): void {
    const commandName = kind === 'tools' ? 'listTools' : 'listPrompts'
    const description =
        kind === 'tools'
            ? 'List tools exposed by an MCP server or profile.'
            : 'List prompts exposed by an MCP server or profile.'

    program
        .command(`${commandName} [profileOrServer]`)
        .description(description)
        .requiredOption('-c, --config <path>', 'Path to the configuration file')
        .action((target: string | undefined, options: ListOptions) => {
            runCli(
                () =>
                    withRuntime(options.config, async (runtime) => {
                        await listEntries(kind, runtime, target)
                    }),
                { exitOnSuccess: true }
            )
        })
}

async function runServe(configPath: string): Promise<void> {
    const config = loadConfig(configPath)
    const registry = new ConnectorRegistry(config)
    const server = startServer(config, registry)

    let shuttingDown = false

    const shutdown = async (signal: string) => {
        if (shuttingDown) {
            logger.warn(
                `Shutdown already in progress, ignoring additional signal: ${signal}`
            )
            return
        }
        shuttingDown = true

        await new Promise<void>((resolve) => {
            server.close((closeError) => {
                if (closeError) {
                    logger.error(
                        { err: closeError },
                        'Error while closing HTTP server'
                    )
                }
                resolve()
            })
        })

        const forceExitTimer = setTimeout(() => {
            logger.warn('Shutdown timeout reached, forcing exit')
            process.exit(1)
        }, 5000)
        forceExitTimer.unref()

        try {
            await registry.disposeAll()
        } catch (error) {
            logger.error({ err: error }, 'Failed to dispose connectors')
        }

        clearTimeout(forceExitTimer)
        logger.info({ signal }, 'Shutdown complete')
        process.exit(0)
    }

    process.once('SIGINT', () => {
        logger.info('Received SIGINT, commencing shutdown')
        void shutdown('SIGINT')
    })
    process.once('SIGTERM', () => {
        logger.info('Received SIGTERM, commencing shutdown')
        void shutdown('SIGTERM')
    })
}

async function listEntries(
    kind: ListKind,
    runtime: RuntimeContext,
    target: string | undefined
): Promise<void> {
    const sections = target
        ? await collectSectionsForTarget(kind, runtime, target)
        : await collectAllSections(kind, runtime)

    printSections(kind, sections)
}

function createRuntime(configPath: string): RuntimeContext {
    const config = loadConfig(configPath)
    const registry = new ConnectorRegistry(config)
    return { configPath, config, registry }
}

async function withRuntime(
    configPath: string,
    handler: (runtime: RuntimeContext) => Promise<void>
): Promise<void> {
    const runtime = createRuntime(configPath)

    try {
        await handler(runtime)
    } finally {
        await disposeRegistry(runtime.registry)
    }
}

async function disposeRegistry(registry: ConnectorRegistry): Promise<void> {
    try {
        await registry.disposeAll()
    } catch (error) {
        console.error(
            `Failed to dispose connectors cleanly: ${formatErrorMessage(error)}`
        )
    }
}

async function collectSectionsForTarget(
    kind: ListKind,
    runtime: RuntimeContext,
    targetId: string
): Promise<Section[]> {
    const { config, registry } = runtime
    const matchesServer = Object.hasOwn(config.mcpServers, targetId)
    const matchesProfile = Object.hasOwn(config.profiles, targetId)

    if (matchesServer && matchesProfile) {
        throw new Error(
            `Identifier '${targetId}' matches both a profile and an MCP server. Please choose a unique name.`
        )
    }

    if (!matchesServer && !matchesProfile) {
        throw new Error(
            `Unknown profile or MCP server '${targetId}'.`
        )
    }

    if (matchesServer) {
        const connector = registry.get(targetId)
        const entries = await listFromConnector(kind, connector)
        return [{ label: `server ${targetId}`, entries }]
    }

    const profile = await Profile.create({
        config,
        profileName: targetId,
        registry,
    })
    const entries = listFromProfile(kind, profile)
    return [{ label: `profile ${targetId}`, entries }]
}

async function collectAllSections(
    kind: ListKind,
    runtime: RuntimeContext
): Promise<Section[]> {
    const sections: Section[] = []

    for (const serverId of Object.keys(runtime.config.mcpServers)) {
        const connector = runtime.registry.get(serverId)
        const entries = await listFromConnector(kind, connector)
        sections.push({ label: `server ${serverId}`, entries })
    }

    for (const profileName of Object.keys(runtime.config.profiles)) {
        const profile = await Profile.create({
            config: runtime.config,
            profileName,
            registry: runtime.registry,
        })
        const entries = listFromProfile(kind, profile)
        sections.push({ label: `profile ${profileName}`, entries })
    }

    return sections
}

async function listFromConnector(
    kind: ListKind,
    connector: Connector
): Promise<SectionEntry[]> {
    try {
        if (kind === 'tools') {
            return await connector.listTools()
        }
        return await connector.listPrompts()
    } catch (error) {
        if (error instanceof McpError && error.code === ErrorCode.MethodNotFound) {
            return []
        }
        throw error
    }
}

function listFromProfile(kind: ListKind, profile: Profile): SectionEntry[] {
    if (kind === 'tools') {
        return Array.from(profile.listTools())
    }
    return Array.from(profile.listPrompts())
}

function printSections(kind: ListKind, sections: Section[]): void {
    for (const section of sections) {
        console.log(`${section.label}:`)
        console.log(`  ${kind}:`)
        for (const entry of section.entries) {
            console.log(formatEntry(entry))
        }
        console.log('')
    }
}

function formatEntry(entry: SectionEntry): string {
    const title = getEntryTitle(entry)
    const description = entry.description

    let line = `    ${entry.name}`
    if (title) {
        line += ` - ${title}`
    }
    if (description) {
        line += `: ${description}`
    }
    return line
}

function getEntryTitle(entry: SectionEntry): string | undefined {
    if (isTool(entry) && entry.annotations?.title) {
        return entry.annotations.title
    }
    return entry.title ?? undefined
}

function isTool(entry: SectionEntry): entry is Tool {
    return 'inputSchema' in entry
}

function handleCliError(error: unknown): never {
    console.error(formatErrorMessage(error))
    process.exit(1)
}

function formatErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
}

function collectEnvFileOption(
    value: string,
    previous: string[]
): string[] {
    return [...previous, value]
}
