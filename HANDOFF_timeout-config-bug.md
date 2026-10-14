# Handoff: Kibana MCP startup failure on KIBANA_TIMEOUT_MS

## Recorded issue — 2026-04-09

Codex MCP entries in `~/.codex/config.toml` failed to start with `KIBANA_TIMEOUT_MS`. The local workaround removed those lines on 2026-04-09; this is historical evidence, not a current startup check.

## Reproduction
The environment values below are intentionally synthetic and portable.

Recorded failing command:

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

Recorded successful command:

```bash
KIBANA_BASE_URL='https://kibana.example.com/logs' \
KIBANA_SOURCE_CATALOG_PATH='config/sources.example.json' \
node dist/src/index.js
```

## Root cause
1. `loadConfigFromEnvironment()` calls `envSchema.parse(envInput)`, converting `KIBANA_TIMEOUT_MS` from string to number.
2. After catalog loading, `parseAppConfig(env, sourceCatalog)` parses that env with the same schema.
3. The second parse expects a string and crashes on the normalized number.

## Relevant files
- `src/config.ts`
- `dist/src/config.js`
- optional tests covering `loadConfigFromEnvironment()` with and without `KIBANA_TIMEOUT_MS`

## Original requested follow-up

1. Fix startup with `KIBANA_TIMEOUT_MS`; keep the fix minimal and add focused tests. Do not revert unrelated untracked dirs such as `.codex/` or `openspec/`.
2. Commit and push the fix.

This records the original request; it does not authorize changes or publishing in later documentation tasks.
