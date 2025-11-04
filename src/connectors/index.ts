import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js'

import type { Config, McpServerConfig } from '../types.js'
import { HttpConnector } from './httpConnector.js'
import { StdioConnector } from './stdioConnector.js'
import type { Connector } from './types.js'

export const createConnector = (
    id: string,
    config: McpServerConfig
): Connector => {
    if (config.type === 'http') {
        return new HttpConnector(id, config)
    }
    if (config.type === 'stdio') {
        return new StdioConnector(id, config)
    }
    throw new McpError(
        ErrorCode.InvalidRequest,
        `Unsupported connector type for ${id}`
    )
}

export class ConnectorRegistry {
    private readonly connectors = new Map<string, Connector>()

    constructor(config: Config) {
        for (const [id, descriptor] of Object.entries(config.mcpServers)) {
            this.connectors.set(id, createConnector(id, descriptor))
        }
    }

    get(id: string): Connector {
        const connector = this.connectors.get(id)
        if (!connector) {
            throw new McpError(
                ErrorCode.InvalidRequest,
                `Unknown server id ${id}`
            )
        }
        return connector
    }

    async disposeAll(): Promise<void> {
        const results = await Promise.allSettled(
            Array.from(this.connectors.values()).map(async (connector) => {
                await connector.dispose()
            })
        )

        const failures = results.filter(
            (result): result is PromiseRejectedResult =>
                result.status === 'rejected'
        )
        if (failures.length > 0) {
            const messages = failures.map((failure) => String(failure.reason))
            throw new Error(messages.join('; '))
        }
    }
}

export type { Connector } from './types.js'
