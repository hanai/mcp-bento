# MCP Gateway Server Design

## Scope
This document captures the design for the first version of a TypeScript-based MCP gateway server. The gateway exposes a single HTTP endpoint and fan-outs requests to upstream MCP servers while respecting per-profile tool and prompt allowlists.

## Runtime Overview
- The gateway listens on the `listen` address declared in the config file (JSON or YAML, e.g., `localhost:3000`).
- Clients connect over HTTP to `/mcp` and must pass a `profile` query parameter (e.g., `/mcp?profile=github_readonly`).
- On each connection the server loads the configured profile, builds an in-memory view of the allowed MCP surface, and proxies requests accordingly.
- If a client omits the `profile` parameter or references an unknown profile, the gateway returns a standard MCP error (`InvalidRequest`). A future `defaultProfile` config entry can provide a fallback, but is out of scope now.

## Configuration Model
- Configuration is a single YAML or JSON file (extension must be `.json`, `.yaml`, or `.yml`) loaded once at startup; if parsing fails the process exits. There is no runtime validation beyond structural parsing and no live reload in this version. The parsed object is treated directly as the runtime `Config`; any normalization (such as turning allowlists into lookup sets) happens lazily when profiles are resolved. Sample files live at `config.example.json` and `config.example.yaml`.
- `profiles` map profile names to the upstream MCP servers they expose. For each upstream entry:
  - `tools`: optional array of tool names to allow. If omitted, every tool from that upstream server is exposed.
  - `prompts`: optional array of prompt identifiers to allow. If omitted, every prompt from that upstream server is exposed.
- `mcpServers` map server identifiers to transport definitions. Supported transports:
  - `http`: contains `url` plus optional `headers`. The gateway forwards requests over HTTP and supports streaming responses.
  - `stdio`: contains `command`, `args`, and optional `env`. The gateway spawns the process and pipes MCP traffic through stdin/stdout.
- Environment variable substitution uses literal `${VAR}` tokens expanded at startup. Any missing variables cause startup failure.

## Connector Abstraction
- Each upstream entry is instantiated as a `Connector` implementation with a minimal interface: `initialize`, `listTools`, `listPrompts`, `callTool`, `getPrompt`, and `dispose`.
- Implementations:
  - `HttpConnector`: wraps the MCP HTTP transport with streaming support and forwards configured headers. There are no retries or warm-up logic; failures surface immediately.
  - `StdioConnector`: launches the configured command, wires stdio streams, and fails fast if the child exits or reports errors. No automatic restarts are attempted.
- The gateway keeps a singleton connector instance per upstream server ID. Profiles reference these instances directly; there is no preheating or reference counting beyond basic cleanup on process exit. Both HTTP and stdio transports reuse that single connector; the stdio connector multiplexes requests over its child process streams and assumes the upstream server can handle concurrent calls. Stdio connectors honor per-server `env` overrides from config.

## Request Routing
1. Accept connection, parse the `profile` query parameter, and resolve the profile definition. The HTTP layer is implemented with Hono, using `@hono/node-server` to bind the app to Node's HTTP server runtime while keeping routing terse.
2. Build a `Profile` object containing the allowed connectors and their tool/prompt allowlists. Profile resolution eagerly calls `listTools` and `listPrompts` on each connector to populate routing maps up front; failures during this step abort the connection setup.
3. MCP lifecycle methods proxy as follows:
   - `listTools` / `listPrompts`: return the precomputed maps, filtered by allowlists when present.
   - `callTool` / `callPrompt`: locate the owning connector via the routing map and forward the request. Responses stream transparently back to the client.
4. When multiple upstream servers expose the same tool or prompt identifier, the first occurrence wins and subsequent duplicates are ignored. Any disallowed tool/prompt request or missing connector results in the same MCP error the SDK emits for unknown tools/prompts, keeping behavior consistent with existing servers.

## SDK Integration
- MCP payload types (`Tool`, `Prompt`, request/response envelopes, etc.) are imported from `@modelcontextprotocol/sdk`; no local protocol typings are duplicated.
- The built-in HTTP server helper does not support per-request profile switching, so the gateway wraps the SDK transport primitives with a thin custom handler that inspects the query string, selects the appropriate profile, and then delegates framing to the SDK utilities.
- Each config entry under `mcpServers` is instantiated once at startup into a `Connector` (HTTP entries wrap the SDK HTTP client transport; stdio entries wrap the SDK stdio client transport).
- Hono runs via `@hono/node-server` with `serve({ fetch: app.fetch, hostname, port })`, matching the official Node adapter guidance.
- Graceful shutdown hooks (`SIGINT`, `SIGTERM`) are registered immediately after the connector registry is created, ensuring every connector’s `dispose` method runs before process exit.

## Error Handling Philosophy
- The gateway adheres to “fail first”: no automatic retries, no exponential backoff, and no fallback transports. Any upstream or transport failure propagates directly to the client.
- When configuration or environment setup is invalid, the process exits during startup rather than attempting partial operation.

## Future Extensions (Out of Scope Now)
- Manual reload triggered by a control-plane API that swaps in a new configuration snapshot.
- Profile inheritance or shared fragments to reduce duplication.
- Observability features such as structured logging, metrics, or tracing.
- Rich validation (JSON Schema, upstream capability checks) beyond basic parsing.
