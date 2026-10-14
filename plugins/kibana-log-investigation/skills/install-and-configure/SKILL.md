---
name: install-and-configure
description: Install the repo plugin with connection-only bootstrap.
---

# Install and Configure

Build the cloned checkout before installing its Codex plugin. Public npm installs use `skills/kibana-log-investigation` instead.

## Build and install

1. [Resolve the installation commit](#pin-the-handoff) and verify Node.js 22+. Use `ensure-node-runtime` if missing.
2. Run from the repository root:

   ```bash
   npm install
   npm run build
   ```

3. Confirm `plugins/kibana-log-investigation/dist/mcp_entry.mjs` exists. Install `Kibana Log Investigation` from the repo-local Codex marketplace. The built plugin includes its runtime dependencies; it runs from its installed directory, not the checkout.
4. Restart Codex only if the plugin directory does not refresh.

## Save the connection

1. Obtain `KIBANA_BASE_URL`, `KIBANA_USERNAME`, and `KIBANA_PASSWORD`, or safe CLI alternatives. Use the base URL prefix, without `/internal/search/es`. Never put passwords in arguments or summaries.
2. Bootstrap without duplicate registration; do not edit client files.

   ```bash
   node dist/src/bin/kibana-mcp-server.js bootstrap --client none
   ```

   First install creates an empty catalog without inspecting indexes. Do not import the bundled example unless requested. Use `--profile NAME` for additional environments; outside the plugin, select them with `serve --profile NAME`.

3. Clear connection variables from the plugin environment before reconnecting.

   Bash: `unset KIBANA_BASE_URL KIBANA_USERNAME KIBANA_PASSWORD`

   PowerShell: `Remove-Item Env:KIBANA_BASE_URL, Env:KIBANA_USERNAME, Env:KIBANA_PASSWORD -ErrorAction SilentlyContinue`

## Select an index

1. In a fresh session, call `discover`.
2. If empty, ask for the exact index or pattern and wait. Never guess, enumerate, scan, or auto-select.
3. Call `configure_index` with exactly that value, then `discover` again.

## Fix startup before restarting again

Inspect MCP startup status and sanitized stderr. Repair and reinstall a failing plugin first. Saved configuration, process startup, tools in a discussion, and backend access are separate checks.

`npm run verify:entrypoint` tests the isolated packaged plugin, not native Codex or a real backend.

## Pin the handoff

1. Resolve a full **commit SHA** using `git rev-parse <ref>^{commit}`, or `git rev-parse HEAD` for detached installs. Use README, INSTALL, and skills from this **resolved installation commit**.
2. Verify the commit-pinned README:

   ```text
   https://raw.githubusercontent.com/Havesomecode/kibana-mcp-server/<resolved-commit>/README.md
   ```

   In a maintained checkout: `node scripts/readme-handoff.mjs <resolved-installation-ref>`. Hand off the verified `url` and `commit`.

Do not infer a Git tag from an npm version. Never substitute master on missing refs, README, or retrieval failures. The helper compares fetched bytes with Git; historical installs without it need explicit resolution and retrieval verification. It is repository-only, not an npm command.
