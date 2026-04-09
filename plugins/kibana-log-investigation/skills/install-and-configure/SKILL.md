---
name: install-and-configure
description: Install the repo-scoped Kibana log investigation plugin and configure its MCP server for a local Kibana environment.
---

# Install and Configure

Use this skill when the repository has been cloned locally and Codex needs to finish setup for the Kibana Log Investigation plugin.

## Goals

- ensure the local MCP server can start from this repository
- install the repo-scoped plugin from the local marketplace
- run guided machine setup so later threads do not need manual `configure`

## Workflow

1. Ensure Node.js 22+ is available:
   - if `node --version` is missing or older than `22`, use the `ensure-node-runtime` skill first
2. Verify the repo has dependencies and build artifacts:
   - if `node_modules/` is missing, run `npm install`
   - if `dist/src/mcp_entry.js` is missing or stale, run `npm run build`
3. In Codex, open the plugin directory for this repo and install `Kibana Log Investigation` from the repo marketplace.
   - if the current model cannot complete the plugin install itself, guide the user through the manual Codex UI click path and continue after confirmation
4. Restart Codex if the plugin directory does not refresh automatically.
5. Run guided setup from the built CLI:
   - `node ./dist/src/index.js setup`
   - collect the environment name, Kibana base URL, username, password, and a source catalog import path
   - prefer the bundled `config/sources.example.json` unless the user already has a better catalog file to import
   - if the user wants more than one environment, use the built-in “add another environment” continuation instead of asking them to hand-edit env vars
6. Let setup save secrets to the OS credential store and import the source catalog into machine-local app state.
7. Verify the MCP is usable in Codex:
   - discover sources
   - run one simple query
   - confirm later threads no longer need a manual `configure` step for the default environment

## Notes

- This plugin is repo-scoped and intended to be installed from a cloned checkout.
- The human CLI runs through `node ./dist/src/index.js`.
- The MCP stdio server runs through `node ./dist/src/mcp_entry.js`.
- Guided setup stores non-secret profile metadata under the user’s machine-level app config directory and stores credentials in the platform credential store.
- New threads should reuse the saved default environment automatically.
- If operators need more than one environment in parallel, save multiple profiles during setup and select non-default ones with `KIBANA_PROFILE=<PROFILE_NAME>` on the MCP entry.
- `KIBANA_BASE_URL` is a base prefix. Keep endpoint paths such as `/internal/search/es` in the source config instead of appending them to the base URL.
- The repo pins Node major `22` in `.node-version`.
