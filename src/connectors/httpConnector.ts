import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'

import type { HttpServerConfig } from '../types.js'
import { ClientConnector } from './base.js'

export class HttpConnector extends ClientConnector {
    constructor(
        id: string,
        private readonly config: HttpServerConfig
    ) {
        super(id, 'http')
    }

    protected createTransport(): Transport {
        const url = new URL(this.config.url)
        const headers = this.config.headers
            ? { ...this.config.headers }
            : undefined
        return new StreamableHTTPClientTransport(
            url,
            headers ? { requestInit: { headers } } : undefined
        )
    }
}
