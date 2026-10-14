---
description: "Saved machine profiles and how to work with several Kibana environments."
---

# Profiles and environments

Run `npx -y @havesomecode/kibana-mcp-server bootstrap --client codex`.

Expected: `/api/status` verified without index access, an empty managed catalog on first install, saved profile metadata and secure credentials. Conflicting MCP registrations are rejected, not overwritten.

Call `discover`; if empty, ask for the exact index or pattern and wait. Never guess, list, or scan indexes. Use `configure_index` only for the user's selected value.

For hand-authored catalogs, run `npm run setup` or `node dist/src/bin/kibana-mcp-server.js setup`. Supply an explicit catalog path; type `example` only to opt into the bundled example. Setup imports the catalog into machine-local state, independent of the checkout.

Metadata lives in the machine-level app config directory. Credentials use macOS Keychain, Windows Credential Manager, or Linux Secret Service when available. Never put passwords in command arguments.

For direct startup, supply environment credentials and an explicit `KIBANA_SOURCE_CATALOG_PATH`, or a store in a [configuration file](./configuration-file). No implicit checkout catalog; no MCP tool accepts credentials.

Without a saved or explicit connection: `No saved Kibana connection is available. Run connection bootstrap first.`

## Machine profiles

Remove `KIBANA_BASE_URL`, `KIBANA_USERNAME`, and `KIBANA_PASSWORD` from the server environment to use saved profiles. All three together select direct startup and require an explicit catalog path or store.

The default saved profile loads automatically. To select another, set `KIBANA_PROFILE=<PROFILE_NAME>`:

```bash
KIBANA_PROFILE=staging npm run dev
```

## Multiple environments

1. Save each environment with `bootstrap --profile <name> --client codex`, or guided setup for hand-authored catalogs. Use `--no-default` to keep the current default.
2. Set `KIBANA_PROFILE` in extra MCP entries; no per-thread connection values or catalog paths are needed:

```bash
KIBANA_PROFILE=staging npm run dev
KIBANA_PROFILE=prod npm run dev
```

For direct startup instead, keep these distinct per environment:

- `KIBANA_BASE_URL`
- `KIBANA_USERNAME`
- `KIBANA_PASSWORD`
- `KIBANA_SOURCE_CATALOG_PATH`

Use separate catalog paths to avoid mixing persisted sources. `configure_index` does not overwrite operator-managed, hand-authored catalogs.
