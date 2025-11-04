import fs from 'node:fs'
import path from 'node:path'

type LoadEnvFileFn = (path?: string) => void

type ProcessWithEnvLoad = NodeJS.Process & {
    loadEnvFile?: LoadEnvFileFn
}

const DOUBLE_QUOTE = '"'
const SINGLE_QUOTE = "'"

export function applyEnvFiles(envFiles: string[]): void {
    if (envFiles.length === 0) {
        return
    }

    const processWithEnv = process as ProcessWithEnvLoad
    const nativeLoader = processWithEnv.loadEnvFile
    const protectedKeys = new Set(Object.keys(process.env))

    for (const candidate of envFiles) {
        const absolutePath = path.resolve(candidate)
        try {
            if (nativeLoader) {
                nativeLoader(absolutePath)
            } else {
                loadEnvFileWithParser(absolutePath, protectedKeys)
            }
        } catch (error) {
            throw new Error(
                `Failed to load env file '${candidate}': ${formatLoaderError(error)}`
            )
        }
    }
}

function loadEnvFileWithParser(
    filePath: string,
    protectedKeys: ReadonlySet<string>
): void {
    const raw = readEnvFile(filePath)
    const entries = parseEnvVariables(raw)

    for (const [key, value] of entries) {
        if (protectedKeys.has(key)) {
            continue
        }
        process.env[key] = value
    }
}

function readEnvFile(filePath: string): string {
    try {
        return fs.readFileSync(filePath, 'utf8')
    } catch (error) {
        throw new Error(
            `Unable to read env file '${filePath}': ${formatLoaderError(error)}`
        )
    }
}

function parseEnvVariables(content: string): Array<[string, string]> {
    const entries: Array<[string, string]> = []
    const lines = content.split(/\r?\n/)

    for (const rawLine of lines) {
        if (!rawLine.trim()) {
            continue
        }

        const trimmedStart = rawLine.trimStart()
        if (trimmedStart.startsWith('#')) {
            continue
        }

        const match = rawLine.match(/^\s*(?:export\s+)?([\w.-]+)\s*=\s*(.*)?$/)
        if (!match) {
            continue
        }

        const key = match[1]
        const rawValue = match[2] ?? ''
        const value = normalizeEnvValue(rawValue)
        entries.push([key, value])
    }

    return entries
}

function normalizeEnvValue(rawValue: string): string {
    const withoutComment = stripInlineComment(rawValue)
    const trimmed = withoutComment.trim()

    if (!trimmed) {
        return ''
    }

    const first = trimmed[0]
    const last = trimmed[trimmed.length - 1]

    if (first === DOUBLE_QUOTE && last === DOUBLE_QUOTE) {
        return unescapeDoubleQuoted(trimmed.slice(1, -1))
    }

    if (first === SINGLE_QUOTE && last === SINGLE_QUOTE) {
        return trimmed.slice(1, -1)
    }

    return trimmed
}

function stripInlineComment(value: string): string {
    let result = ''
    let inSingle = false
    let inDouble = false
    let escapeNext = false

    for (let index = 0; index < value.length; index += 1) {
        const char = value[index]

        if (char === '\\' && !escapeNext) {
            escapeNext = true
            result += char
            continue
        }

        if (char === DOUBLE_QUOTE && !inSingle && !escapeNext) {
            inDouble = !inDouble
            result += char
            continue
        }

        if (char === SINGLE_QUOTE && !inDouble && !escapeNext) {
            inSingle = !inSingle
            result += char
            continue
        }

        if (char === '#' && !inSingle && !inDouble && !escapeNext) {
            const prev = index === 0 ? '' : value[index - 1]
            if (index === 0 || /\s/.test(prev)) {
                break
            }
        }

        result += char
        escapeNext = false
    }

    return result.trimEnd()
}

function unescapeDoubleQuoted(value: string): string {
    let result = ''

    for (let index = 0; index < value.length; index += 1) {
        const char = value[index]
        if (char !== '\\') {
            result += char
            continue
        }

        const next = value[index + 1]
        if (next === undefined) {
            result += char
            continue
        }

        index += 1
        switch (next) {
            case 'n':
                result += '\n'
                break
            case 'r':
                result += '\r'
                break
            case 't':
                result += '\t'
                break
            case 'f':
                result += '\f'
                break
            case 'v':
                result += '\v'
                break
            case '0':
                result += '\0'
                break
            case '"':
                result += '"'
                break
            case '\\':
                result += '\\'
                break
            default:
                result += next
                break
        }
    }

    return result
}

function formatLoaderError(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
}
