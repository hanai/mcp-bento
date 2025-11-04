import { z } from 'zod'
import {
    ProfileConfigSchema,
    HttpServerConfigSchema,
    StdioServerConfigSchema,
    McpServerConfigSchema,
    ConfigSchema,
} from './schema.js'

// TypeScript types derived from Zod schemas (DRY: single source of truth)
export type ProfileConfig = z.infer<typeof ProfileConfigSchema>

export type ProfilesConfig = Record<string, Record<string, ProfileConfig>>

export type HttpServerConfig = z.infer<typeof HttpServerConfigSchema>

export type StdioServerConfig = z.infer<typeof StdioServerConfigSchema>

export type McpServerConfig = z.infer<typeof McpServerConfigSchema>

export type Config = z.infer<typeof ConfigSchema>
