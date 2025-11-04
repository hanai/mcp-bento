import { logger as defaultLogger } from './logger.js'

export type ListenerEmitter = {
    on?: (event: string, listener: (...args: unknown[]) => void) => void
    off?: (event: string, listener: (...args: unknown[]) => void) => void
    removeListener?: (
        event: string,
        listener: (...args: unknown[]) => void
    ) => void
}

export type CleanupLogger = Pick<typeof defaultLogger, 'warn'>

export interface CleanupManagerOptions {
    profileName: string
    logger?: CleanupLogger
}

export class CleanupManager {
    private readonly logger: CleanupLogger
    private readonly profileName: string
    private cleanedUp = false
    private callbacks: Array<() => Promise<void> | void> = []
    private listeners: Array<{
        emitter?: ListenerEmitter
        event: string
        listener: (...args: unknown[]) => void
    }> = []

    constructor({ profileName, logger }: CleanupManagerOptions) {
        this.profileName = profileName
        this.logger = logger ?? defaultLogger
    }

    register(callback: () => Promise<void> | void) {
        this.callbacks.push(callback)
    }

    watchEmitter(emitter: ListenerEmitter | undefined, events: string[]) {
        if (!emitter || typeof emitter.on !== 'function') {
            return
        }

        for (const event of events) {
            const listener = (...args: unknown[]) => {
                const [first] = args
                this.run({ cause: first instanceof Error ? first : undefined })
            }
            emitter.on(event, listener)
            this.listeners.push({ emitter, event, listener })
        }
    }

    run({ cause }: { cause?: unknown } = {}) {
        if (this.cleanedUp) {
            return
        }
        this.cleanedUp = true

        if (cause instanceof Error) {
            this.logger.warn(
                { err: cause, profile: this.profileName },
                'Stream terminated with error'
            )
        }

        for (const { emitter, event, listener } of this.listeners) {
            if (emitter && typeof emitter.off === 'function') {
                emitter.off(event, listener)
            } else {
                emitter?.removeListener?.(event, listener)
            }
        }
        this.listeners = []

        for (const callback of this.callbacks) {
            void Promise.resolve()
                .then(() => callback())
                .catch((error) => {
                    this.logger.warn(
                        { err: error, profile: this.profileName },
                        'Cleanup callback failed'
                    )
                })
        }
    }
}
