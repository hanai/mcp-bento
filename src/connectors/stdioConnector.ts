import { appendFile } from 'node:fs/promises'
import readline from 'node:readline'
import type { Readable } from 'node:stream'

import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'

import type { StdioServerConfig } from '../types.js'
import { BENTO_LOG_PATH, logger } from '../logger.js'
import { ClientConnector } from './base.js'

export class StdioConnector extends ClientConnector {
    constructor(
        id: string,
        private readonly config: StdioServerConfig
    ) {
        super(id, 'stdio')
    }

    private stderrInterface: readline.Interface | null = null
    private stderrWriteChain: Promise<void> = Promise.resolve()

    protected createTransport(): Transport {
        const transport = new StdioClientTransport({
            command: this.config.command,
            args: this.config.args,
            env: this.config.env ? { ...this.config.env } : undefined,
            stderr: 'pipe',
        })
        this.pipeStderrToLog(transport)
        return transport
    }

    override async dispose(): Promise<void> {
        if (this.stderrInterface) {
            this.stderrInterface.close()
            this.stderrInterface = null
        }
        try {
            await this.stderrWriteChain
        } catch (error) {
            logger.warn({ err: error, serverId: this.id }, 'Failed to flush stderr log queue')
        }
        await super.dispose()
    }

    private pipeStderrToLog(transport: StdioClientTransport): void {
        const stderrStream = transport.stderr
        if (!stderrStream) {
            return
        }

        const readable = stderrStream as Readable

        this.stderrInterface = readline.createInterface({
            input: readable,
        })

        stderrStream.on('error', (error) => {
            logger.warn({ err: error, serverId: this.id }, 'Stdio server stderr stream failed')
        })

        this.stderrInterface.on('line', (line) => {
            this.enqueueStderrLine(line)
        })
    }

    private enqueueStderrLine(rawLine: string): void {
        const line = rawLine.trimEnd()
        const record = `[${new Date().toISOString()}] [${this.id}] ${line}\n`
        this.stderrWriteChain = this.stderrWriteChain
            .catch(() => undefined)
            .then(() => appendFile(BENTO_LOG_PATH, record))
    }
}
