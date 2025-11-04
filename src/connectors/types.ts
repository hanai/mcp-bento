import type { Client } from '@modelcontextprotocol/sdk/client/index.js'
import type {
    CallToolRequest,
    GetPromptRequest,
    ListPromptsResult,
    ListToolsResult,
    Prompt,
    Tool,
} from '@modelcontextprotocol/sdk/types.js'

export type CallToolResultType = Awaited<ReturnType<Client['callTool']>>
export type GetPromptResultType = Awaited<ReturnType<Client['getPrompt']>>

export interface Connector {
    readonly id: string
    readonly kind: 'http' | 'stdio'
    ensureReady(): Promise<void>
    listTools(): Promise<Tool[]>
    listPrompts(): Promise<Prompt[]>
    callTool(params: CallToolRequest['params']): Promise<CallToolResultType>
    getPrompt(params: GetPromptRequest['params']): Promise<GetPromptResultType>
    dispose(): Promise<void>
}

export type ConnectorListToolsResult = ListToolsResult['tools']
export type ConnectorListPromptsResult = ListPromptsResult['prompts']
