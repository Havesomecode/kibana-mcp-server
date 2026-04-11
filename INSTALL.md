# Install In Codex

Use this document when handing the repository to another Codex user or agent and you want setup to be as automatic as possible from a cloned checkout.

This is the canonical install path today. Public package distribution is planned but not yet the default path (see `docs/project/distribution-strategy.md`).

Repository:

- Name: `kibana-mcp-server`
- GitHub: `https://github.com/Havesomecode/kibana-mcp-server`
- Plugin name: `Kibana Log Investigation`

## Full-Auto Prompt

```text
Clone and set up the GitHub repository https://github.com/Havesomecode/kibana-mcp-server for Codex end to end.

Goals:
1. Clone the repo locally.
   - The repo name is `kibana-mcp-server`.
2. Detect the current OS.
3. Ensure Node.js 22+ is installed at user level.
   - If Node is missing or too old, use the repo plugin skill `ensure-node-runtime`.
   - Do not require admin/system-wide installation.
   - On Windows, prefer PowerShell-native setup.
4. From the repo root, run:
   - npm install
   - npm run build
   - npm run setup
5. Open the cloned repo in Codex.
6. Install the repo-scoped plugin named `Kibana Log Investigation` from the local marketplace in this repo.
   - If the current model cannot complete the plugin install itself, give me the exact Codex UI steps to click manually, then continue the rest of setup after I confirm.
7. Restart Codex if needed so the MCP appears.
8. Run the guided setup flow and ask me for a short environment name.
   - Examples: `staging`, `prod`, `preprod`, `qa`
   - Collect Kibana base URL, username, password, and a source catalog import path.
   - Prefer the bundled `config/sources.example.json` unless I provide a better catalog file.
   - Save the default environment at machine level so later threads do not need a manual `configure` step.
   - If I need both staging and production, use the setup flow's "add another environment" continuation instead of asking me to hand-define env vars.
9. Store secrets in the platform credential store and import the selected source catalog into machine-local app state.
10. Verify the MCP is usable by:
   - discovering sources
   - running one simple query
   - confirming the server is available in Codex
   - confirming a later thread can use the default environment without rerunning `configure`
11. If something is blocked, adapt the setup and continue instead of stopping early.

Important constraints:
- Prefer repo-local/plugin install plus machine-level saved profiles over hand-written per-thread env vars.
- Prefer user-level installs.
- Do not assume Scoop is available on Windows.
- Use the plugin skills in this repo when relevant.
- The repo contains a repo-scoped plugin under `plugins/kibana-log-investigation`.
- The local plugin marketplace file is `.agents/plugins/marketplace.json`.
- The human CLI is the built file `dist/src/index.js`.
- The MCP entrypoint is the built file `dist/src/mcp_entry.js`, referenced by `plugins/kibana-log-investigation/.mcp.json`.
- Ask for the environment name explicitly instead of inventing one.
- If more than one environment is saved, select non-default ones with `KIBANA_PROFILE=<PROFILE_NAME>` instead of asking the user to redefine credentials manually.
- `KIBANA_BASE_URL` is a base prefix, not a full Kibana API endpoint. Keep paths such as `/internal/search/es` in the source backend config.
- Do not stop just because plugin installation requires one manual Codex UI step.
- At the end, summarize exactly what was installed, configured, and verified.
```

## Short Prompt

```text
Clone https://github.com/Havesomecode/kibana-mcp-server, ensure Node.js 22+ at user level for the current OS, run npm install, npm run build, and npm run setup, install the repo plugin `Kibana Log Investigation`, ask me for the environment name plus Kibana credentials, import a source catalog during setup, save the default environment so later threads do not need manual configure, then verify discover + one query work in Codex.
```

## Repo Hints

- The repo pins Node major `22` in `.node-version`.
- The repo-scoped plugin marketplace is in `.agents/plugins/marketplace.json`.
- The plugin lives in `plugins/kibana-log-investigation`.
- The Node bootstrap skill is `plugins/kibana-log-investigation/skills/ensure-node-runtime/SKILL.md`.
- The setup skill is `plugins/kibana-log-investigation/skills/install-and-configure/SKILL.md`.

## Raw File Handoff

If a colleague receives only the raw `INSTALL.md` link, this file should still be enough context for an agent to proceed.

The agent should infer all of the following from this file alone:

- the GitHub repository to clone is `https://github.com/Havesomecode/kibana-mcp-server`
- the repo contains a repo-scoped Codex plugin named `Kibana Log Investigation`
- the plugin lives at `plugins/kibana-log-investigation`
- the repo must be built with `npm install` and `npm run build` before the MCP can start
- guided setup runs through `npm run setup`
- Node.js major `22` is required
- the agent should continue through manual Codex UI plugin installation if autonomous installation is blocked

When sharing this document, prefer sending the raw link plus the Kibana credentials and the source-catalog file the installer should import.

## Manual Plugin Install Fallback

Some Codex model variants are less reliable at completing repo-local plugin installation from prompting alone, especially on Windows.

If the agent stalls on plugin installation:

1. Open this repo in Codex.
2. Open the plugin directory `plugins/kibana-log-investigation`.
3. Install `Kibana Log Investigation` from the repo-local marketplace.
4. Restart Codex if the MCP list does not refresh automatically.
5. Let the agent continue with MCP configuration and verification.

Treat the manual click as a supported fallback, not as a setup failure.

## Base URL Rule

`KIBANA_BASE_URL` must be the base prefix that the server should join with each source backend path.

Use values such as:

- `https://kibana.example.com`
- `https://gateway.example.com/logs` when Kibana is mounted under `/logs`

Do not use values such as:

- `https://kibana.example.com/internal/search/es`
- `https://gateway.example.com/logs/internal/search/es`

The source catalog already carries endpoint paths such as `/internal/search/es`.

## Staging And Production Side By Side

If operators need both staging and production on the same machine, save both during guided setup.

Then:

- let the default profile load automatically
- select non-default saved environments with `KIBANA_PROFILE`, for example `KIBANA_PROFILE=staging`
- avoid redefining `KIBANA_BASE_URL`, credentials, or source-catalog paths per thread

If operators still prefer the advanced env-bootstrap path, keep these distinct per environment:

- `KIBANA_BASE_URL`
- `KIBANA_USERNAME`
- `KIBANA_PASSWORD`
- `KIBANA_SOURCE_CATALOG_PATH`
