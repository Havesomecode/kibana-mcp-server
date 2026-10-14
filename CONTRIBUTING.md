# Contributing

## Quick Start

1. Ensure Node.js 22+ (see `.node-version`).
2. Install dependencies:
   ```bash
   npm install
   ```
3. Run the full verification suite:
   ```bash
   npm run verify
   ```

## Development Scripts

- `npm run lint` - Biome lint
- `npm run format` - Biome format (writes)
- `npm run format:check` - Biome format check
- `npm run check:types` - TypeScript typecheck
- `npm test` - Vitest suite
- `npm run verify` - full CI equivalent (lint, types, tests, build, entrypoint check)

## Source Catalogs

1. Use connection bootstrap for an empty managed catalog saved with the machine profile. Add indexes through `configure_index` only with explicit user approval.
2. Use guided `setup` to import an operator-selected hand-authored catalog. Choose `config/sources.example.json` explicitly if needed as a template.
3. Set `KIBANA_SOURCE_CATALOG_PATH` for environment startup unless a configuration-file store supplies it. Saved profiles carry their catalog path; no checkout file loads implicitly.

Never commit real environment catalogs or credentials.

## Schema Endpoints

Report blocked schema endpoints when relevant: `describe_fields` can fail, and exact-field promotion or nested validation may be unavailable.

## Pull Requests

1. Keep changes focused; update docs when behavior changes.
2. Pass `npm run verify` before requesting review.

## Security

Report vulnerabilities via the process in `SECURITY.md`.
