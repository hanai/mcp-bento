# mcp-bento

mcp-bento is a composable Model Context Protocol (MCP) gateway that lets you hydrate a single HTTP endpoint with tools and prompts coming from many upstream MCP servers. It ships as a CLI, runs anywhere Node.js 20+ is available, and is built on top of the official MCP TypeScript SDK for first-class Streamable HTTP and stdio support.

## Highlights
- Aggregate any mix of HTTP and stdio MCP servers behind one gateway.
- Curate named *profiles* that filter, prefix, and re-export tools/prompts.
- Introspect what the gateway exposes with `listTools` / `listPrompts` commands.
- Validate JSON or YAML configs with strong Zod schemas (env variables supported).
- Serve a production-ready `/mcp` endpoint powered by Hono + Streamable HTTP.
- Enjoy graceful shutdown, deterministic cleanup, and structured logging via Pino.

## Usage
Run the CLI directly with `npx` (no global install required):
```bash
npx mcp-bento serve ./config.json
```

## Quick Start
1. Create a config file (for example `config.local.json`) using the baseline template below, and adjust it to match your MCP servers.
2. Provide any required secrets either via the environment or env files (see below).
3. Run the gateway:
   ```bash
   npx mcp-bento serve config.local.json
   # equivalent: npx mcp-bento -c config.local.json
   ```
4. Point your MCP-compatible client at `http://localhost:3003/mcp?profile=default`.

### Baseline config example
```json
{
  "listen": "localhost:3003",
  "mcpServers": {
    "context7": {
      "type": "http",
      "url": "https://mcp.context7.com/mcp"
    },
    "github": {
      "type": "http",
      "url": "https://api.githubcopilot.com/mcp/",
      "headers": {
        "Authorization": "Bearer ${GITHUB_MCP_PAT}"
      }
    },
    "time": {
      "type": "stdio",
      "command": "docker",
      "args": ["run", "-i", "--rm", "mcp/time"]
    }
  },
  "profiles": {
    "default": {
      "context7": { "tools": ["resolve-library-id"] },
      "time": { "prefix": false, "tools": ["get_current_time"] },
      "github-profile": { "prefix": "gh__", "tools": ["github__list_commits"] }
    },
    "github-profile": {
      "github": { "prefix": "github__", "tools": ["list_commits"] }
    }
  }
}
```

## Configuration cookbook

### Case 1: HTTP-only fan-in with selective exports
Route two remote MCP servers through one gateway while renaming the documentation tools to avoid collisions.

```json
{
  "listen": "0.0.0.0:8080",
  "mcpServers": {
    "search": { "type": "http", "url": "https://mcp.search.example/mcp" },
    "docs": { "type": "http", "url": "https://mcp.docs.example/mcp" }
  },
  "profiles": {
    "default": {
      "search": { "tools": ["web_search", "news_search"] },
      "docs": { "prefix": "docs__", "tools": ["read_article"] }
    }
  }
}
```

### Case 2: Stdio sidecar with custom environment
Expose a local Dockerized MCP server via stdio, keeping the upstream tool names untouched.

```json
{
  "listen": "localhost:3004",
  "mcpServers": {
    "shell-tools": {
      "type": "stdio",
      "command": "docker",
      "args": ["run", "-i", "--rm", "mcp/shell-tools"],
      "env": { "SHELL_TOOLS_MODE": "safe" }
    }
  },
  "profiles": {
    "default": {
      "shell-tools": {
        "prefix": false
      }
    }
  }
}
```

### Case 3: Profiles as reusable building blocks
Compose a read-only GitHub profile and reuse it inside an analytics profile with a different prefix.

```json
{
  "listen": "localhost:3005",
  "mcpServers": {
    "github": { "type": "http", "url": "https://api.githubcopilot.com/mcp/" },
    "analytics": { "type": "http", "url": "https://analytics.example.com/mcp" }
  },
  "profiles": {
    "github-readonly": {
      "github": {
        "tools": ["list_commits", "list_pull_requests"]
      }
    },
    "analytics-suite": {
      "github-readonly": { "prefix": "gh__" },
      "analytics": { "prefix": "ops__", "tools": ["list_dashboards"] }
    }
  }
}
```

### Case 4: Secrets via env file
Reference environment variables directly inside the config and load them via `--env-file`.

```json
{
  "listen": "localhost:3006",
  "mcpServers": {
    "github": {
      "type": "http",
      "url": "https://api.githubcopilot.com/mcp/",
      "headers": { "Authorization": "Bearer ${GITHUB_MCP_PAT}" }
    }
  },
  "profiles": {
    "default": {
      "github": { "tools": ["list_commits"] }
    }
  }
}
```

```
# .env.mcp
GITHUB_MCP_PAT=ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

```bash
npx mcp-bento --env-file .env.mcp serve config.secret.json
```

## CLI reference
- `npx mcp-bento serve [configPath]` – start the HTTP gateway. Pass `-c/--config` to point at JSON/YAML.
- `npx mcp-bento listTools [profileOrServer] -c <config>` – list the tools exported by a specific profile/server (or every profile when omitted).
- `npx mcp-bento listPrompts [profileOrServer] -c <config>` – same for prompts.
- `--env-file <path>` (repeatable) – load key/value pairs before config parsing, mirroring `node --env-file` semantics.

Every command validates the config file before doing work, so typos or schema violations fail fast.

## HTTP gateway contract
- Endpoint: `POST|GET|DELETE /mcp?profile=<name>`.
- Body: raw MCP JSON-RPC messages (Streamable HTTP transport).
- Response: passthrough JSON-RPC responses from the active profile.

Because the gateway spins up a dedicated MCP server per request, multiple clients can connect in parallel without sharing state.

### Example invocation
```bash
curl \
  -X POST "http://localhost:3003/mcp?profile=default" \
  -H "content-type: application/json" \
  -d '{"jsonrpc":"2.0","id":"1","method":"tools/list"}'
```

## Configuration deep dive
mcp-bento reads JSON, YAML, or YML files. Top-level keys:

| Key | Description |
| --- | --- |
| `listen` | `host:port` pair consumed by the embedded Hono server (e.g. `0.0.0.0:8080`). |
| `mcpServers` | Dictionary of upstream connectors the gateway can talk to. |
| `profiles` | Dictionary of exported profiles that remix servers and other profiles. |

### MCP servers
Each entry under `mcpServers` must be either `http` or `stdio`:

```jsonc
"my-http-server": {
  "type": "http",
  "url": "https://example.com/mcp",
  "headers": { "Authorization": "Bearer ${TOKEN}" }
}

"my-stdio-server": {
  "type": "stdio",
  "command": "python",
  "args": ["./server.py"],
  "env": { "PYTHONUNBUFFERED": "1" }
}
```
- HTTP connectors reuse `StreamableHTTPClientTransport` and accept optional static headers.
- stdio connectors spawn the declared command (plus args/env) via `StdioClientTransport` and keep a persistent subprocess alive.

### Profiles
Profiles describe what a client can see.

| Field | Meaning |
| --- | --- |
| `tools` / `prompts` | Optional allowlists. Omit to export everything from the referenced server/profile. |
| `prefix` | String prepended to exported names (default: `<serverId>__`). Set to `false` to keep original names. |
| Nesting | Profiles may import other profiles, enabling reusable building blocks (cycles are rejected). |

Collisions are automatically skipped, so the first matching tool/prompt wins.

### Environment variables & secrets
- Any `${ENV_VAR}` token inside the config is replaced at runtime. Missing variables log a warning and fall back to an empty string.
- Supply secrets via the shell or via repeatable `--env-file` flags (supports `export FOO=` syntax, comments, and quoted values).

## Observability & lifecycle
- Logs default to `info` level, stream to stdout, and are mirrored to `./bento.log` (set `LOG_LEVEL=debug` for more detail).
- Connectors are cached and torn down gracefully on `SIGINT`/`SIGTERM`. The HTTP server also enforces a fail-safe timeout during shutdown to avoid hanging processes.

## License
ISC © mcp-bento contributors
