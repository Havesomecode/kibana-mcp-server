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

For direct process startup, supply the connection through environment variables together with an explicit `KIBANA_SOURCE_CATALOG_PATH`, or declare a catalog store in a [configuration file](./configuration-file). There is no implicit checkout catalog and no MCP tool accepts connection credentials.

Without a saved or explicit connection, startup fails: `No saved Kibana connection is available. Run connection bootstrap first.`

## Machine profiles

After connection bootstrap or guided setup, the default saved profile loads automatically on startup. Do not leave `KIBANA_BASE_URL`, `KIBANA_USERNAME`, and `KIBANA_PASSWORD` set in the server environment when you intend to use saved credentials: supplying all three selects direct environment startup and requires an explicit catalog path or store.

If you saved more than one environment, select a non-default profile with:

- `KIBANA_PROFILE=<PROFILE_NAME>`

Example:

```bash
KIBANA_PROFILE=staging npm run dev
```

## Multiple environments

Save a separate profile per environment with `bootstrap --profile <name> --client codex`, or import hand-authored catalogs through guided setup. Use `--no-default` during bootstrap when the new profile must not replace the current default.

Then:

- the default profile loads automatically
- extra MCP entries can select another saved environment with `KIBANA_PROFILE`
- you do not need to redefine `KIBANA_BASE_URL`, credentials, or source-catalog paths per thread

Example:

```bash
KIBANA_PROFILE=staging npm run dev
KIBANA_PROFILE=prod npm run dev
```

For direct environment-based entries, keep these distinct per environment:

- `KIBANA_BASE_URL`
- `KIBANA_USERNAME`
- `KIBANA_PASSWORD`
- `KIBANA_SOURCE_CATALOG_PATH`

Use separate catalog paths because `configure_index` persists managed sources. Sharing a file would mix sources from different environments. Hand-authored catalogs remain operator-managed and are not overwritten by that tool.
