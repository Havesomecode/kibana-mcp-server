---
name: install-and-configure
description: Install the repo plugin with connection-only bootstrap.
---

# Install and Configure

Use this skill only when the repository has been cloned locally and Codex needs the repo-scoped plugin. For public installs, use the canonical `skills/kibana-log-investigation` skill and the published npm package instead.

## Workflow

1. Ensure Node.js 22+ is available. Use `ensure-node-runtime` when needed.
2. From the repository root:

```bash
npm install
npm run build
```

3. Install `Kibana Log Investigation` from the repo-local Codex marketplace.
4. Restart Codex if the plugin directory does not refresh automatically.
5. Resolve the Kibana connection through `KIBANA_BASE_URL`, `KIBANA_USERNAME`, and `KIBANA_PASSWORD`, or safe CLI alternatives.
6. Bootstrap only the connection, without registering a duplicate global MCP:

```bash
node dist/src/index.js bootstrap --client none
```

7. Confirm bootstrap reports an empty source catalog. It must not inspect or configure indexes.
8. In a fresh Codex session, call `discover`. When it reports no sources, ask the operator which exact index or index pattern to configure.
9. Only after the operator answers, call `configure_index` with exactly that value. Then run `discover` again.

## Rules

- Do not edit client configuration files.
- Do not use the bundled example catalog unless the operator explicitly requests example data.
- Do not put passwords in command arguments or summaries.
- Do not guess, enumerate, scan, or auto-select Kibana indexes.
- Do not call `configure_index` until the operator explicitly names the index or pattern.
- Use `--profile NAME` for additional environments.
- Use `serve --profile NAME` when invoking a non-default profile outside the repo plugin.
- `KIBANA_BASE_URL` is a base prefix. Do not append `/internal/search/es`.
