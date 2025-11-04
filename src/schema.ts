import { z } from 'zod'

// Zod schemas for runtime validation (SSOT: single source of truth for config structure)
export const ProfileConfigSchema = z.object({
    tools: z.array(z.string()).optional(),
    prompts: z.array(z.string()).optional(),
    prefix: z.union([z.string(), z.literal(false)]).optional(),
})

export const HttpServerConfigSchema = z.object({
    type: z.literal('http'),
    url: z.url(),
    headers: z.record(z.string(), z.string()).optional(),
})

export const StdioServerConfigSchema = z.object({
    type: z.literal('stdio'),
    command: z.string().min(1),
    args: z.array(z.string()).optional(),
    env: z.record(z.string(), z.string()).optional(),
})

export const McpServerConfigSchema = z.discriminatedUnion('type', [
    HttpServerConfigSchema,
    StdioServerConfigSchema,
])

export const ConfigSchema = z
    .object({
        listen: z.string().regex(/^[\w.-]+:\d+$/),
        profiles: z.record(
            z.string(),
            z.record(z.string(), ProfileConfigSchema)
        ),
        mcpServers: z.record(z.string(), McpServerConfigSchema),
    })
    .superRefine((data, ctx) => {
        // Validate that profile keys reference either mcpServers or other profiles
        const serverKeys = new Set(Object.keys(data.mcpServers))
        const profileKeys = new Set(Object.keys(data.profiles))

        for (const [profileName, profileConfig] of Object.entries(
            data.profiles
        )) {
            for (const referencedKey of Object.keys(profileConfig)) {
                if (
                    !serverKeys.has(referencedKey) &&
                    !profileKeys.has(referencedKey)
                ) {
                    ctx.addIssue({
                        code: z.ZodIssueCode.custom,
                        path: ['profiles', profileName, referencedKey],
                        message: `Unknown server or profile '${referencedKey}'. Must reference a key from 'mcpServers' or 'profiles'`,
                    })
                }
            }
        }
    })
