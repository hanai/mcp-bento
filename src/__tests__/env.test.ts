import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, test, vi } from 'vitest'

import { applyEnvFiles } from '../env.js'

type ProcessWithEnvLoad = NodeJS.Process & {
    loadEnvFile?: (file?: string) => void
}

describe('applyEnvFiles', () => {
    test('delegates to process.loadEnvFile when available', () => {
        const processWithEnv = process as ProcessWithEnvLoad
        const originalLoader = processWithEnv.loadEnvFile
        const loader = vi.fn()
        processWithEnv.loadEnvFile = loader

        const envPath = './test.env'
        const resolved = path.resolve(envPath)
        applyEnvFiles([envPath])

        expect(loader).toHaveBeenCalledTimes(1)
        expect(loader).toHaveBeenCalledWith(resolved)

        processWithEnv.loadEnvFile = originalLoader
    })

    test('loads env files with parser fallback and respects precedence rules', () => {
        const processWithEnv = process as ProcessWithEnvLoad
        const originalLoader = processWithEnv.loadEnvFile
        delete processWithEnv.loadEnvFile

        const cleanup = recordEnv(['EXISTING', 'FROM_FILE', 'FROM_SECOND', 'QUOTED'])
        process.env.EXISTING = 'from-os'

        const firstEnv = writeEnvFile('EXISTING=from-first\nFROM_FILE=one\nQUOTED="hello world"\n')
        const secondEnv = writeEnvFile('FROM_FILE=two\nFROM_SECOND="line 1\\nline 2"\n')

        applyEnvFiles([firstEnv, secondEnv])

        expect(process.env.EXISTING).toBe('from-os')
        expect(process.env.FROM_FILE).toBe('two')
        expect(process.env.QUOTED).toBe('hello world')
        expect(process.env.FROM_SECOND).toBe('line 1\nline 2')

        cleanup()
        removeEnvFile(firstEnv)
        removeEnvFile(secondEnv)
        processWithEnv.loadEnvFile = originalLoader
    })
})

function recordEnv(keys: string[]): () => void {
    const snapshot = new Map<string, string | undefined>()
    for (const key of keys) {
        snapshot.set(key, process.env[key])
    }

    return () => {
        for (const [key, value] of snapshot.entries()) {
            if (value === undefined) {
                delete process.env[key]
            } else {
                process.env[key] = value
            }
        }
    }
}

function writeEnvFile(contents: string): string {
    const filePath = path.join(
        fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-bento-env-')),
        '.env'
    )
    fs.writeFileSync(filePath, contents, 'utf8')
    return filePath
}

function removeEnvFile(filePath: string): void {
    try {
        fs.rmSync(filePath, { force: true })
        const dirPath = path.dirname(filePath)
        fs.rmSync(dirPath, { recursive: true, force: true })
    } catch {
        // Best-effort cleanup.
    }
}
