# Handoff: Kibana MCP startup failure on KIBANA_TIMEOUT_MS

## Context
The Codex MCP entries in `~/.codex/config.toml` were failing to start the Kibana MCP server when `KIBANA_TIMEOUT_MS` was present.

As a quick workaround, the `KIBANA_TIMEOUT_MS` lines were removed from the local Codex config entries on 2026-04-09.

## Reproduction
The environment values below are intentionally synthetic and portable.

This fails:

```bash
KIBANA_BASE_URL='https://kibana.example.com/logs' \
KIBANA_TIMEOUT_MS='10000' \
KIBANA_SOURCE_CATALOG_PATH='config/sources.example.json' \
node dist/src/index.js
```

Observed error:

```text
ZodError: Invalid input: expected string, received number
path: ["KIBANA_TIMEOUT_MS"]
```

This succeeds:

```bash
KIBANA_BASE_URL='https://kibana.example.com/logs' \
KIBANA_SOURCE_CATALOG_PATH='config/sources.example.json' \
node dist/src/index.js
```

## Root cause
`loadConfigFromEnvironment()` parses env with `envSchema.parse(envInput)`, where `KIBANA_TIMEOUT_MS` is transformed from string to number.

Later, after loading the source catalog, it calls `parseAppConfig(env, sourceCatalog)`. But `parseAppConfig()` parses the env again using the same schema, which still expects `KIBANA_TIMEOUT_MS` to be a string input.

That second parse crashes because the already-normalized value is now a number.

## Relevant files
- `src/config.ts`
- `dist/src/config.js`
- optional tests covering `loadConfigFromEnvironment()` with and without `KIBANA_TIMEOUT_MS`

## Requested follow-up
Implement a real fix so startup works when `KIBANA_TIMEOUT_MS` is set, then commit and push the change.

Constraints:
- Do not revert unrelated untracked dirs like `.codex/` or `openspec/`.
- Keep the fix minimal and add focused tests.
