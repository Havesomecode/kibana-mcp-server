# Contributing

Thanks for contributing to Kibana Log Investigation MCP.

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

- Connection bootstrap saves an empty managed catalog with the machine profile; `configure_index` adds only indexes explicitly approved by the user.
- Guided `setup` imports a hand-authored catalog selected by the operator. Use `config/sources.example.json` only as an explicitly chosen template.
- Environment-based startup requires `KIBANA_SOURCE_CATALOG_PATH` unless a configuration-file store supplies the catalog. Saved profiles carry their own catalog path; no checkout file is loaded implicitly.
- Do not commit real environment source catalogs or credentials.

## Schema Endpoints

Some Kibana deployments block schema metadata endpoints. When that happens:

- `describe_fields` can return errors
- exact-field promotion and nested validation may be unavailable

Please include this detail in bug reports when relevant.

## Pull Requests

- Keep changes focused.
- Update docs when behavior changes.
- Ensure `npm run verify` passes before requesting review.

## Security

Report vulnerabilities via the process in `SECURITY.md`.
