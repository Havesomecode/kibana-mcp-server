---
name: install-and-configure
description: Install the repo plugin with connection-only bootstrap.
---

# Install and Configure

Use this skill only when the repository has been cloned locally and Codex needs the repo-scoped plugin. For public installs, use the canonical `skills/kibana-log-investigation` skill and the published npm package instead.

## Version-matched README handoff

Read the README for the resolved installation ref before following installation instructions. For an explicitly selected master checkout, use exactly:

```text
https://raw.githubusercontent.com/Havesomecode/kibana-mcp-server/refs/heads/master/README.md
```

Other branches use `refs/heads/<branch>`, tags use `refs/tags/<tag>`, and detached installs use the full commit SHA directly in that URL. Use `INSTALL.md` and skills from the same ref. Do not infer a Git tag from an npm version or silently fall back to master. Confirm a branch/tag resolves to the actual checkout commit; otherwise use its full commit SHA.

From a maintained repository root containing the helper, run `node scripts/readme-handoff.mjs <resolved-installation-ref>`. Include its verified `url` and `commit` in agent handoffs. The helper resolves local refs and verifies the downloaded README against the selected Git object. Unknown refs, missing READMEs, or retrieval/content verification failures must be reported instead of presenting another version's instructions. The helper is repository-only; historical installations without it require explicit ref resolution and README retrieval verification.

## Workflow

1. Ensure Node.js 22+ is available. Use `ensure-node-runtime` when needed.
2. From the repository root:

```bash
npm install
npm run build
```

3. Confirm the build produced `plugins/kibana-log-investigation/dist/mcp_entry.mjs`. Install `Kibana Log Investigation` from the repo-local Codex marketplace only after building. The built plugin includes runtime dependencies and launches from its installed directory, not the checkout.
4. Restart Codex if the plugin directory does not refresh automatically.
5. Resolve the Kibana connection through `KIBANA_BASE_URL`, `KIBANA_USERNAME`, and `KIBANA_PASSWORD`, or safe CLI alternatives.
6. Bootstrap only the connection, without registering a duplicate global MCP:

```bash
node dist/src/bin/kibana-mcp-server.js bootstrap --client none
```

7. Confirm bootstrap reports an empty source catalog. It must not inspect or configure indexes.
8. In a fresh Codex session, call `discover`. When it reports no sources, ask the operator which exact index or index pattern to configure.
9. Only after the operator answers, call `configure_index` with exactly that value. Then run `discover` again.

## Rules

- Do not edit client configuration files.
- Separate saved configuration, process startup, tools in the current discussion, and real backend access. If startup fails, inspect sanitized stderr and repair/reinstall the plugin before requesting another discussion. Run `npm run verify:entrypoint` for the isolated packaged-plugin handshake; it is not a native Codex or real-backend check.
- Do not use the bundled example catalog unless the operator explicitly requests example data.
- Do not put passwords in command arguments or summaries.
- Do not guess, enumerate, scan, or auto-select Kibana indexes.
- Do not call `configure_index` until the operator explicitly names the index or pattern.
- Use `--profile NAME` for additional environments.
- Use `serve --profile NAME` when invoking a non-default profile outside the repo plugin.
- `KIBANA_BASE_URL` is a base prefix. Do not append `/internal/search/es`.
