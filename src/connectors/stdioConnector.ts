import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'

import type { StdioServerConfig } from '../types.js'
import { ClientConnector } from './base.js'

export class StdioConnector extends ClientConnector {
    constructor(
        id: string,
        private readonly config: StdioServerConfig
    ) {
        super(id, 'stdio')
    }

    protected createTransport(): Transport {
        return new StdioClientTransport({
            command: this.config.command,
            args: this.config.args,
            env: this.config.env ? { ...this.config.env } : undefined,
        })
    }
}
