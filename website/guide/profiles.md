---
description: "Saved machine profiles and how to work with several Kibana environments."
---

# Profiles and environments

The preferred path is deterministic connection-only bootstrap:

- `npx -y @havesomecode/kibana-mcp-server bootstrap --client codex`
- verifies `/api/status` without touching an index endpoint
- creates an empty managed source catalog on first install
- rejects conflicting MCP registrations instead of overwriting them
- saves non-secret profile metadata and credentials for later threads
- exposes `configure_index` for one user-approved index or pattern at a time

Guided setup remains available for hand-authored source catalogs:

- `npm run setup` or `node dist/src/bin/kibana-mcp-server.js setup`
- saves non-secret profile metadata in the user’s machine-level app config directory
- saves credentials in the platform credential store
  - macOS Keychain
  - Windows Credential Manager
  - Linux Secret Service when available
- imports the selected source catalog into machine-local state so later threads do not depend on the repo checkout
- requires an explicit catalog path; type `example` to opt into the bundled example deliberately

The server also supports two advanced compatibility paths:

- bootstrap at process start through environment variables plus a JSON source catalog
- runtime from your MCP client through the `configure` tool

When `configure` is called, the source catalog is still persisted to disk so restarts do not wipe the logical source setup.

## Machine profiles

After guided setup, the default saved profile loads automatically on startup.

If you saved more than one environment, select a non-default profile with:

- `KIBANA_PROFILE=<PROFILE_NAME>`

Example:

```bash
KIBANA_PROFILE=staging npm run dev
```

## Multiple environments

The recommended path is to save multiple machine profiles during setup.

Then:

- the default profile loads automatically
- extra MCP entries can select another saved environment with `KIBANA_PROFILE`
- you do not need to redefine `KIBANA_BASE_URL`, credentials, or source-catalog paths per thread

Example:

```bash
KIBANA_PROFILE=staging npm run dev
KIBANA_PROFILE=prod npm run dev
```

If you still prefer env-bootstrap entries, keep these distinct per environment:

- `KIBANA_BASE_URL`
- `KIBANA_USERNAME`
- `KIBANA_PASSWORD`
- `KIBANA_SOURCE_CATALOG_PATH`

Using separate source-catalog paths matters because the `configure` tool persists sources to disk, and one shared runtime file would cause the environments to overwrite each other.
