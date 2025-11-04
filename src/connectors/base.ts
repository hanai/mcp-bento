import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import type {
    CallToolRequest,
    GetPromptRequest,
    Prompt,
    Tool,
} from '@modelcontextprotocol/sdk/types.js'

import type {
    Connector,
    CallToolResultType,
    GetPromptResultType,
} from './types.js'

export abstract class ClientConnector implements Connector {
    protected client: Client | null = null
    private initPromise: Promise<void> | null = null
    private disposed = false
    private toolCache: Tool[] | null = null
    private promptCache: Prompt[] | null = null

    protected constructor(
        public readonly id: string,
        public readonly kind: 'http' | 'stdio'
    ) {}

    protected abstract createTransport(): Transport

    protected createClient(): Client {
        return new Client({
            name: `gateway-${this.kind}-${this.id}`,
            version: '1.0.0',
        })
    }

    async ensureReady(): Promise<void> {
        if (this.disposed) {
            throw new Error(`Connector ${this.id} has been disposed`)
        }
        if (this.client) {
            return
        }
        if (!this.initPromise) {
            this.initPromise = this.initialize()
        }
        try {
            await this.initPromise
        } catch (error) {
            this.initPromise = null
            throw error
        }
    }

    async listTools(): Promise<Tool[]> {
        await this.ensureReady()
        if (!this.client) {
            throw new Error(`Connector ${this.id} not initialized`)
        }
        if (!this.toolCache) {
            const { tools } = await this.client.listTools()
            this.toolCache = tools
        }
        return [...this.toolCache]
    }

    async listPrompts(): Promise<Prompt[]> {
        await this.ensureReady()
        if (!this.client) {
            throw new Error(`Connector ${this.id} not initialized`)
        }
        if (!this.promptCache) {
            const { prompts } = await this.client.listPrompts()
            this.promptCache = prompts
        }
        return [...this.promptCache]
    }

    async callTool(
        params: CallToolRequest['params']
    ): Promise<CallToolResultType> {
        await this.ensureReady()
        if (!this.client) {
            throw new Error(`Connector ${this.id} not initialized`)
        }
        return this.client.callTool(params)
    }

    async getPrompt(
        params: GetPromptRequest['params']
    ): Promise<GetPromptResultType> {
        await this.ensureReady()
        if (!this.client) {
            throw new Error(`Connector ${this.id} not initialized`)
        }
        return this.client.getPrompt(params)
    }

    async dispose(): Promise<void> {
        this.disposed = true
        this.toolCache = null
        this.promptCache = null
        this.initPromise = null
        if (this.client) {
            try {
                await this.client.close()
            } finally {
                this.client = null
            }
        }
    }

    private async initialize(): Promise<void> {
        const client = this.createClient()
        const transport = this.createTransport()
        await client.connect(transport)
        this.client = client
    }
}
