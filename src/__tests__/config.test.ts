import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

import { stringify as stringifyYaml } from 'yaml'

import { loadConfig } from '../config.js'
import { logger } from '../logger.js'

describe('loadConfig', () => {
    let tempDir: string
    let configPath: string

    const setConfigExtension = (extension: '.json' | '.yaml' | '.yml') => {
        configPath = path.join(tempDir, `test-config${extension}`)
    }

    beforeEach(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'config-test-'))
        setConfigExtension('.json')
    })

    afterEach(() => {
        if (fs.existsSync(tempDir)) {
            fs.rmSync(tempDir, { recursive: true, force: true })
        }
        vi.restoreAllMocks()
        // Clean up any stubbed environment variables
        vi.unstubAllEnvs()
    })

    const writeConfig = (config: unknown) => {
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2))
    }

    const writeYamlConfig = (
        config: unknown,
        extension: '.yaml' | '.yml' = '.yaml'
    ) => {
        setConfigExtension(extension)
        fs.writeFileSync(configPath, stringifyYaml(config))
    }

    describe('Valid configurations', () => {
        it('loads a minimal valid config', () => {
            const config = {
                listen: 'localhost:3000',
                profiles: {},
                mcpServers: {},
            }
            writeConfig(config)

            const result = loadConfig(configPath)

            expect(result).toEqual(config)
        })

        it('loads config with HTTP server', () => {
            const config = {
                listen: 'localhost:3000',
                profiles: {},
                mcpServers: {
                    httpServer: {
                        type: 'http',
                        url: 'https://example.com/mcp',
                    },
                },
            }
            writeConfig(config)

            const result = loadConfig(configPath)

            expect(result.mcpServers.httpServer).toEqual({
                type: 'http',
                url: 'https://example.com/mcp',
            })
        })

        it('loads config with HTTP server and headers', () => {
            const config = {
                listen: 'localhost:3000',
                profiles: {},
                mcpServers: {
                    httpServer: {
                        type: 'http',
                        url: 'https://example.com/mcp',
                        headers: {
                            Authorization: 'Bearer token',
                            'X-Custom': 'value',
                        },
                    },
                },
            }
            writeConfig(config)

            const result = loadConfig(configPath)

            expect(result.mcpServers.httpServer).toEqual(
                config.mcpServers.httpServer
            )
        })

        it('loads config with stdio server', () => {
            const config = {
                listen: 'localhost:3000',
                profiles: {},
                mcpServers: {
                    stdioServer: {
                        type: 'stdio',
                        command: 'node',
                        args: ['server.js'],
                        env: {
                            NODE_ENV: 'production',
                        },
                    },
                },
            }
            writeConfig(config)

            const result = loadConfig(configPath)

            expect(result.mcpServers.stdioServer).toEqual(
                config.mcpServers.stdioServer
            )
        })

        it('loads config with profiles referencing servers', () => {
            const config = {
                listen: 'localhost:3000',
                profiles: {
                    default: {
                        server1: {
                            tools: ['tool1', 'tool2'],
                            prompts: ['prompt1'],
                            prefix: 'srv1__',
                        },
                    },
                },
                mcpServers: {
                    server1: {
                        type: 'http',
                        url: 'https://example.com',
                    },
                },
            }
            writeConfig(config)

            const result = loadConfig(configPath)

            expect(result.profiles.default.server1).toEqual({
                tools: ['tool1', 'tool2'],
                prompts: ['prompt1'],
                prefix: 'srv1__',
            })
        })

        it('loads config with profiles referencing other profiles', () => {
            const config = {
                listen: 'localhost:3000',
                profiles: {
                    base: {
                        server1: {},
                    },
                    extended: {
                        base: {
                            prefix: 'nested__',
                        },
                        server2: {},
                    },
                },
                mcpServers: {
                    server1: {
                        type: 'http',
                        url: 'https://example1.com',
                    },
                    server2: {
                        type: 'http',
                        url: 'https://example2.com',
                    },
                },
            }
            writeConfig(config)

            const result = loadConfig(configPath)

            expect(result.profiles.extended.base).toEqual({
                prefix: 'nested__',
            })
            expect(result.profiles.extended.server2).toEqual({})
        })

        it('accepts prefix: false', () => {
            const config = {
                listen: 'localhost:3000',
                profiles: {
                    default: {
                        server1: {
                            prefix: false,
                        },
                    },
                },
                mcpServers: {
                    server1: {
                        type: 'http',
                        url: 'https://example.com',
                    },
                },
            }
            writeConfig(config)

            const result = loadConfig(configPath)

            expect(result.profiles.default.server1.prefix).toBe(false)
        })

        it('accepts various listen address formats', () => {
            const testCases = [
                'localhost:3000',
                '0.0.0.0:8080',
                '127.0.0.1:9000',
                'example.com:443',
                'my-host.local:3000',
            ]

            for (const listen of testCases) {
                const config = {
                    listen,
                    profiles: {},
                    mcpServers: {},
                }
                writeConfig(config)

                const result = loadConfig(configPath)

                expect(result.listen).toBe(listen)
            }
        })
    })

    describe('Environment variable expansion', () => {
        it('expands environment variables in strings', () => {
            vi.stubEnv('TEST_TOKEN', 'secret-token')
            vi.stubEnv('TEST_URL', 'https://api.example.com')

            const config = {
                listen: 'localhost:3000',
                profiles: {},
                mcpServers: {
                    server1: {
                        type: 'http',
                        url: '${TEST_URL}',
                        headers: {
                            Authorization: 'Bearer ${TEST_TOKEN}',
                        },
                    },
                },
            }
            writeConfig(config)

            const result = loadConfig(configPath)

            expect(result.mcpServers.server1).toEqual({
                type: 'http',
                url: 'https://api.example.com',
                headers: {
                    Authorization: 'Bearer secret-token',
                },
            })
        })

        it('expands environment variables in arrays', () => {
            vi.stubEnv('ARG1', 'first')
            vi.stubEnv('ARG2', 'second')

            const config = {
                listen: 'localhost:3000',
                profiles: {},
                mcpServers: {
                    server1: {
                        type: 'stdio',
                        command: 'node',
                        args: ['${ARG1}', '${ARG2}'],
                    },
                },
            }
            writeConfig(config)

            const result = loadConfig(configPath)

            const server1 = result.mcpServers.server1
            expect(server1.type).toBe('stdio')
            if (server1.type === 'stdio') {
                expect(server1.args).toEqual(['first', 'second'])
            }
        })

        it('warns and leaves empty strings when environment variable is missing', () => {
            const warnSpy = vi
                .spyOn(logger, 'warn')
                .mockImplementation(() => undefined)

            const config = {
                listen: 'localhost:3000',
                profiles: {},
                mcpServers: {
                    server1: {
                        type: 'http',
                        headers: {
                            Authorization: 'Bearer ${MISSING_TOKEN}',
                            'X-Trace': '${MISSING_TRACE_ID}',
                        },
                        url: 'https://example.com',
                    },
                },
            }
            writeConfig(config)

            const result = loadConfig(configPath)

            const server1 = result.mcpServers.server1
            expect(server1.type).toBe('http')
            if (server1.type === 'http') {
                expect(server1.url).toBe('https://example.com')
                expect(server1.headers?.Authorization).toBe('Bearer ')
                expect(server1.headers?.['X-Trace']).toBe('')
            }

            expect(warnSpy).toHaveBeenCalledTimes(2)
            expect(warnSpy).toHaveBeenCalledWith(
                { envVar: 'MISSING_TOKEN' },
                'Missing environment variable MISSING_TOKEN'
            )
            expect(warnSpy).toHaveBeenCalledWith(
                { envVar: 'MISSING_TRACE_ID' },
                'Missing environment variable MISSING_TRACE_ID'
            )
        })
    })

    describe('YAML configurations', () => {
        it('loads config from a .yaml file', () => {
            const config = {
                listen: 'localhost:3001',
                profiles: {
                    default: {
                        server1: {},
                    },
                },
                mcpServers: {
                    server1: {
                        type: 'http',
                        url: 'https://example.com/mcp',
                    },
                },
            }

            writeYamlConfig(config, '.yaml')

            const result = loadConfig(configPath)

            expect(result).toEqual(config)
        })

        it('loads config from a .yml file', () => {
            const config = {
                listen: 'localhost:3002',
                profiles: {},
                mcpServers: {
                    stdioServer: {
                        type: 'stdio',
                        command: 'node',
                        args: ['server.js'],
                    },
                },
            }

            writeYamlConfig(config, '.yml')

            const result = loadConfig(configPath)

            expect(result).toEqual(config)
        })

        it('expands environment variables from YAML sources', () => {
            vi.stubEnv('YAML_URL', 'https://yaml.example.com')
            vi.stubEnv('YAML_TOKEN', 'yaml-token')

            const config = {
                listen: 'localhost:3003',
                profiles: {},
                mcpServers: {
                    yamlServer: {
                        type: 'http',
                        url: '${YAML_URL}',
                        headers: {
                            Authorization: 'Bearer ${YAML_TOKEN}',
                        },
                    },
                },
            }

            writeYamlConfig(config)

            const result = loadConfig(configPath)

            expect(result.mcpServers.yamlServer).toEqual({
                type: 'http',
                url: 'https://yaml.example.com',
                headers: { Authorization: 'Bearer yaml-token' },
            })
        })

        it('rejects unsupported file extensions', () => {
            configPath = path.join(tempDir, 'test-config.txt')
            fs.writeFileSync(configPath, 'listen: localhost:1234')

            expect(() => loadConfig(configPath)).toThrow(
                /Unsupported config file extension/
            )
        })
    })

    describe('Validation errors', () => {
        it('rejects invalid listen format', () => {
            const testCases = [
                'invalid',
                'localhost',
                ':3000',
                'localhost:',
                'localhost:abc',
                'http://localhost:3000',
            ]

            for (const listen of testCases) {
                const config = {
                    listen,
                    profiles: {},
                    mcpServers: {},
                }
                writeConfig(config)

                expect(() => loadConfig(configPath)).toThrow(
                    /Configuration validation failed/
                )
            }
        })

        it('rejects invalid HTTP server URL', () => {
            const config = {
                listen: 'localhost:3000',
                profiles: {},
                mcpServers: {
                    bad: {
                        type: 'http',
                        url: 'not-a-url',
                    },
                },
            }
            writeConfig(config)

            expect(() => loadConfig(configPath)).toThrow(/Invalid URL/)
        })

        it('rejects HTTP server without URL', () => {
            const config = {
                listen: 'localhost:3000',
                profiles: {},
                mcpServers: {
                    bad: {
                        type: 'http',
                    },
                },
            }
            writeConfig(config)

            expect(() => loadConfig(configPath)).toThrow(
                /Configuration validation failed/
            )
        })

        it('rejects stdio server with empty command', () => {
            const config = {
                listen: 'localhost:3000',
                profiles: {},
                mcpServers: {
                    bad: {
                        type: 'stdio',
                        command: '',
                    },
                },
            }
            writeConfig(config)

            expect(() => loadConfig(configPath)).toThrow(
                /Configuration validation failed/
            )
        })

        it('rejects stdio server without command', () => {
            const config = {
                listen: 'localhost:3000',
                profiles: {},
                mcpServers: {
                    bad: {
                        type: 'stdio',
                    },
                },
            }
            writeConfig(config)

            expect(() => loadConfig(configPath)).toThrow(
                /Configuration validation failed/
            )
        })

        it('rejects unknown server type', () => {
            const config = {
                listen: 'localhost:3000',
                profiles: {},
                mcpServers: {
                    bad: {
                        type: 'unknown',
                        url: 'https://example.com',
                    },
                },
            }
            writeConfig(config)

            expect(() => loadConfig(configPath)).toThrow(
                /Configuration validation failed/
            )
        })

        it('rejects profile referencing nonexistent server', () => {
            const config = {
                listen: 'localhost:3000',
                profiles: {
                    default: {
                        nonexistent: {},
                    },
                },
                mcpServers: {},
            }
            writeConfig(config)

            expect(() => loadConfig(configPath)).toThrow(
                /Unknown server or profile 'nonexistent'/
            )
        })

        it('rejects profile referencing nonexistent profile', () => {
            const config = {
                listen: 'localhost:3000',
                profiles: {
                    default: {
                        missingProfile: {},
                    },
                },
                mcpServers: {
                    realServer: {
                        type: 'http',
                        url: 'https://example.com',
                    },
                },
            }
            writeConfig(config)

            expect(() => loadConfig(configPath)).toThrow(
                /Unknown server or profile 'missingProfile'/
            )
        })

        it('reports multiple profile reference errors', () => {
            const config = {
                listen: 'localhost:3000',
                profiles: {
                    bad1: {
                        missing1: {},
                        missing2: {},
                    },
                    bad2: {
                        missing3: {},
                    },
                },
                mcpServers: {},
            }
            writeConfig(config)

            expect(() => loadConfig(configPath)).toThrow(/missing1/)
            expect(() => loadConfig(configPath)).toThrow(/missing2/)
            expect(() => loadConfig(configPath)).toThrow(/missing3/)
        })

        it('rejects invalid tools array type', () => {
            const config = {
                listen: 'localhost:3000',
                profiles: {
                    default: {
                        server1: {
                            tools: 'not-an-array',
                        },
                    },
                },
                mcpServers: {
                    server1: {
                        type: 'http',
                        url: 'https://example.com',
                    },
                },
            }
            writeConfig(config)

            expect(() => loadConfig(configPath)).toThrow(
                /Configuration validation failed/
            )
        })

        it('rejects invalid prompts array type', () => {
            const config = {
                listen: 'localhost:3000',
                profiles: {
                    default: {
                        server1: {
                            prompts: 123,
                        },
                    },
                },
                mcpServers: {
                    server1: {
                        type: 'http',
                        url: 'https://example.com',
                    },
                },
            }
            writeConfig(config)

            expect(() => loadConfig(configPath)).toThrow(
                /Configuration validation failed/
            )
        })

        it('rejects invalid prefix type', () => {
            const config = {
                listen: 'localhost:3000',
                profiles: {
                    default: {
                        server1: {
                            prefix: 123,
                        },
                    },
                },
                mcpServers: {
                    server1: {
                        type: 'http',
                        url: 'https://example.com',
                    },
                },
            }
            writeConfig(config)

            expect(() => loadConfig(configPath)).toThrow(
                /Configuration validation failed/
            )
        })

        it('rejects config missing required fields', () => {
            const config = {
                listen: 'localhost:3000',
            }
            writeConfig(config)

            expect(() => loadConfig(configPath)).toThrow(
                /Configuration validation failed/
            )
        })

        it('rejects invalid JSON', () => {
            fs.writeFileSync(configPath, '{ invalid json }')

            expect(() => loadConfig(configPath)).toThrow()
        })

        it('throws when config file does not exist', () => {
            expect(() => loadConfig('/nonexistent/config.json')).toThrow()
        })
    })

    describe('Type constraints', () => {
        it('accepts headers as Record<string, string>', () => {
            const config = {
                listen: 'localhost:3000',
                profiles: {},
                mcpServers: {
                    server1: {
                        type: 'http',
                        url: 'https://example.com',
                        headers: {
                            'X-Header-1': 'value1',
                            'X-Header-2': 'value2',
                        },
                    },
                },
            }
            writeConfig(config)

            const result = loadConfig(configPath)

            const server1 = result.mcpServers.server1
            expect(server1.type).toBe('http')
            if (server1.type === 'http') {
                expect(server1.headers).toEqual({
                    'X-Header-1': 'value1',
                    'X-Header-2': 'value2',
                })
            }
        })

        it('accepts env as Record<string, string>', () => {
            const config = {
                listen: 'localhost:3000',
                profiles: {},
                mcpServers: {
                    server1: {
                        type: 'stdio',
                        command: 'node',
                        env: {
                            VAR1: 'value1',
                            VAR2: 'value2',
                        },
                    },
                },
            }
            writeConfig(config)

            const result = loadConfig(configPath)

            const server1 = result.mcpServers.server1
            expect(server1.type).toBe('stdio')
            if (server1.type === 'stdio') {
                expect(server1.env).toEqual({
                    VAR1: 'value1',
                    VAR2: 'value2',
                })
            }
        })
    })

    describe('Complex scenarios', () => {
        it('loads config with multiple servers and profiles', () => {
            const config = {
                listen: '0.0.0.0:8080',
                profiles: {
                    readonly: {
                        server1: {
                            tools: ['read'],
                        },
                        server2: {
                            tools: ['list'],
                        },
                    },
                    admin: {
                        server1: {},
                        server2: {},
                        server3: {
                            prefix: 'admin__',
                        },
                    },
                },
                mcpServers: {
                    server1: {
                        type: 'http',
                        url: 'https://api1.example.com',
                    },
                    server2: {
                        type: 'http',
                        url: 'https://api2.example.com',
                        headers: {
                            Authorization: 'Bearer token',
                        },
                    },
                    server3: {
                        type: 'stdio',
                        command: 'docker',
                        args: ['run', '-i', 'image'],
                    },
                },
            }
            writeConfig(config)

            const result = loadConfig(configPath)

            expect(result.listen).toBe('0.0.0.0:8080')
            expect(Object.keys(result.profiles)).toHaveLength(2)
            expect(Object.keys(result.mcpServers)).toHaveLength(3)
        })

        it('handles deeply nested profile references', () => {
            const config = {
                listen: 'localhost:3000',
                profiles: {
                    base: {
                        server1: {},
                    },
                    level1: {
                        base: {},
                        server2: {},
                    },
                    level2: {
                        level1: {
                            prefix: 'nested__',
                        },
                    },
                },
                mcpServers: {
                    server1: {
                        type: 'http',
                        url: 'https://example1.com',
                    },
                    server2: {
                        type: 'http',
                        url: 'https://example2.com',
                    },
                },
            }
            writeConfig(config)

            const result = loadConfig(configPath)

            expect(result.profiles.level2.level1).toEqual({
                prefix: 'nested__',
            })
        })
    })
})
