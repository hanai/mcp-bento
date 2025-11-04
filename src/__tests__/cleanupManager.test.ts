import { EventEmitter } from 'node:events'

import { describe, expect, it, vi } from 'vitest'

import { CleanupManager, type CleanupLogger } from '../cleanupManager.js'

const flushPromises = () => new Promise((resolve) => setTimeout(resolve, 0))

const createMockLogger = () => {
    const warn = vi.fn()
    const logger: CleanupLogger = {
        warn: warn as CleanupLogger['warn'],
    }
    return { warn, logger }
}

describe('CleanupManager', () => {
    it('runs registered callbacks only once', async () => {
        const { warn, logger } = createMockLogger()
        const callback = vi.fn()
        const cleanup = new CleanupManager({
            profileName: 'test-profile',
            logger,
        })

        cleanup.register(callback)

        cleanup.run()
        cleanup.run()

        await flushPromises()

        expect(callback).toHaveBeenCalledTimes(1)
        expect(warn).not.toHaveBeenCalled()
    })

    it('detaches watched emitters after cleanup and triggers callbacks', async () => {
        const { warn, logger } = createMockLogger()
        const emitter = new EventEmitter()
        const callback = vi.fn()
        const cleanup = new CleanupManager({
            profileName: 'test-profile',
            logger,
        })

        cleanup.register(callback)
        cleanup.watchEmitter(emitter, ['close'])

        emitter.emit('close')
        emitter.emit('close')

        await flushPromises()

        expect(callback).toHaveBeenCalledTimes(1)
        expect(warn).not.toHaveBeenCalled()
    })

    it('logs errors originating from emitters', () => {
        const { warn, logger } = createMockLogger()
        const emitter = new EventEmitter()
        const cleanup = new CleanupManager({
            profileName: 'test-profile',
            logger,
        })

        cleanup.watchEmitter(emitter, ['error'])

        const error = new Error('boom')
        emitter.emit('error', error)

        expect(warn).toHaveBeenCalledWith(
            expect.objectContaining({ err: error, profile: 'test-profile' }),
            'Stream terminated with error'
        )
    })
})
