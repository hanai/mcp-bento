# Repository Guidelines

## Project Structure & Module Organization
TypeScript sources live in `src/`, with `src/index.ts` bootstrapping configuration loading, connector registration, and server startup. Connector implementations reside under `src/connectors/` alongside shared types, while HTTP entrypoints and OAuth helpers sit in `src/server.ts` and `src/oauth/`. Unit tests belong in `src/__tests__`, mirroring the source tree with `*.test.ts` files. Build artifacts are emitted to `dist/` by the TypeScript compiler. Use `config.example.json` as the starting point for runtime configuration committed outside the repo.

## Build, Test, and Development Commands
Run `pnpm install` before development to sync dependencies with `pnpm-lock.yaml`. Use `pnpm dev` for watch-mode TypeScript execution via `tsx`, and `pnpm build` to emit production JavaScript into `dist/`. Start the compiled service with `pnpm start <path-to-config.json>`, mirroring production boot. Execute `pnpm test` for the Vitest suite; append `--runInBand` when diagnosing race-prone tests locally.

## Coding Style & Naming Conventions
Follow the existing two-space indentation and double-quoted imports seen in `src/index.ts`. Keep modules focused: default exports for entrypoints, named exports for reusable helpers. Favour `camelCase` for variables and functions, `PascalCase` for classes and types, and `UPPER_SNAKE_CASE` for constants. Prefer async/await over raw promises, and centralise shared types in `src/types.ts` to avoid circular imports. Run `pnpm build` before submitting to surface TypeScript diagnostics.

## Testing Guidelines
Vitest is configured in `vitest.config.ts` to scan `src/__tests__/**/*.test.ts`; keep new tests in that tree with clear `describe` scopes. Mock external services through connector abstractions instead of network calls. Strive to cover new logic paths and document complex setups in test names (e.g., `profile.oauth2.test.ts`). Use `pnpm test -- --coverage` when validating broader changes.

## Commit & Pull Request Guidelines
Current history is minimal; adopt concise, imperative commits such as `Add OAuth token refresh flow`. Group related changes per commit and reference issue IDs when available. Pull requests should describe functional intent, list test evidence (commands and outcomes), and note configuration updates like new connector fields. Include screenshots or log excerpts when behaviour is user-facing or operational. Request at least one review before merging.

## Configuration & Environment
Copy `config.example.json` to an environment-specific file (e.g., `config.dev.json`) and supply the path when running `pnpm start`. Keep credentials out of version control and document secrets handling in the PR description. Ensure connectors that open network sockets are configured to shut down cleanly, matching the signal handling implemented in `src/index.ts`.
