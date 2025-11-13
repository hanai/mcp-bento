import path from 'node:path'

import pino, { type Level } from 'pino'

const resolveLevel = (): Level => {
    const envLevel = process.env.LOG_LEVEL
    if (!envLevel) {
        return 'info'
    }
    const lower = envLevel.toLowerCase()
    if (pino.levels.values[lower] !== undefined) {
        return lower as Level
    }
    return 'info'
}

export const BENTO_LOG_PATH = path.resolve(process.cwd(), 'bento.log')

export const logger = pino({
    level: resolveLevel(),
    base: undefined,
    transport: {
        targets: [
            {
                target: 'pino/file',
                options: { destination: 1 },
            },
            {
                target: 'pino/file',
                options: {
                    destination: BENTO_LOG_PATH,
                    mkdir: true,
                },
            },
        ],
    },
})
