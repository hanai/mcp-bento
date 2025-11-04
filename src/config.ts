import fs from 'node:fs'
import path from 'node:path'

import { parse as parseYaml } from 'yaml'

import type { Config } from './types.js'
import { ConfigSchema } from './schema.js'
import { logger } from './logger.js'

const ENV_PATTERN = /\$\{([A-Z0-9_]+)\}/g

const isObject = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value)

type ConfigFormat = 'json' | 'yaml'

const SUPPORTED_EXTENSIONS = new Map<string, ConfigFormat>([
    ['.json', 'json'],
    ['.yaml', 'yaml'],
    ['.yml', 'yaml'],
])

const parseConfigSource = (
    raw: string,
    format: ConfigFormat,
    resolvedPath: string
): Record<string, unknown> => {
    try {
        const parsed = format === 'json' ? JSON.parse(raw) : parseYaml(raw)

        if (!isObject(parsed)) {
            const actualType = Array.isArray(parsed) ? 'array' : typeof parsed
            throw new Error(
                `Configuration root value must be an object, got ${actualType}`
            )
        }

        return parsed
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        const label = format === 'json' ? 'JSON' : 'YAML'
        throw new Error(
            `Failed to parse ${label} config at ${resolvedPath}: ${message}`
        )
    }
}

const expandValue = (value: unknown, missingEnvVars: Set<string>): unknown => {
    if (typeof value === 'string') {
        return value.replace(ENV_PATTERN, (_, name: string) => {
            const resolved = process.env[name]
            if (resolved === undefined) {
                missingEnvVars.add(name)
                return ''
            }
            return resolved
        })
    }

    if (Array.isArray(value)) {
        return value.map((nested) => expandValue(nested, missingEnvVars))
    }

    if (isObject(value)) {
        const result: Record<string, unknown> = {}
        for (const [key, nested] of Object.entries(value)) {
            result[key] = expandValue(nested, missingEnvVars)
        }
        return result
    }

    return value
}

export const loadConfig = (configPath: string): Config => {
    const resolvedPath = path.resolve(configPath)
    const extension = path.extname(resolvedPath).toLowerCase()
    const format = SUPPORTED_EXTENSIONS.get(extension)

    if (!format) {
        const extLabel = extension || '<none>'
        throw new Error(
            `Unsupported config file extension '${extLabel}'. Use .json, .yaml, or .yml`
        )
    }

    const raw = fs.readFileSync(resolvedPath, 'utf8')
    const parsed = parseConfigSource(raw, format, resolvedPath)
    const missingEnvVars = new Set<string>()
    const expanded = expandValue(parsed, missingEnvVars)

    for (const envVar of missingEnvVars) {
        logger.warn({ envVar }, `Missing environment variable ${envVar}`)
    }

    // Runtime validation with Zod (DRY: reuse schema for both validation and type safety)
    const validationResult = ConfigSchema.safeParse(expanded)

    if (!validationResult.success) {
        const errors = validationResult.error.issues
            .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
            .join('\n')
        throw new Error(`Configuration validation failed:\n${errors}`)
    }

    return validationResult.data
}
