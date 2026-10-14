---
description: "Requirements, prompt-free bootstrap, agent skill installation and use in Codex."
---

# Getting started

## Requirements

- Node.js 22+
- A Kibana-compatible read endpoint reachable with basic auth
- No index for bootstrap. Select the exact index or pattern later with `configure_index`; hand-authored catalogs remain an advanced option.

## Installation

### Prompt-free connection bootstrap

1. Provision the connection through a trusted environment, then run:

Never pass passwords as command-line arguments. Use `KIBANA_PASSWORD`, `--password-env NAME`, or `--password-stdin`.

```bash
export KIBANA_BASE_URL='https://kibana.example.com'
export KIBANA_USERNAME='elastic'
export KIBANA_PASSWORD='use-a-secret-provider'

npx -y @havesomecode/kibana-mcp-server bootstrap \
  --client codex
```

Expected: no prompts with these values supplied; a verified connection, secure credentials, an empty managed catalog on first install, and registration of the exact running package transport. No direct Codex config edits or index listing, scanning, inference, or configuration.

2. Start the server without `KIBANA_BASE_URL`, `KIBANA_USERNAME`, and `KIBANA_PASSWORD` to use the saved profile. Direct startup requires an explicit `KIBANA_SOURCE_CATALOG_PATH` or configuration-file store; no implicit checkout catalog.
3. Reconnect the client and call `discover`. If empty, ask the user for the exact Kibana index or pattern and wait. Never guess, list, or scan indexes. Call `configure_index` only with their answer; it validates and saves only that index and accepts no credentials.

Reruns preserve explicitly configured sources. Bootstrap refuses to replace hand-authored or modified catalogs without `--replace`. Use that flag only with operator approval: it creates an empty managed catalog.

### Install the agent skill

Run:

```bash
npx skills add Havesomecode/kibana-mcp-server \
  --skill kibana-log-investigation \
  --agent codex \
  --global \
  --yes
```

Expected: the skill at `skills/kibana-log-investigation/SKILL.md` teaches bootstrap instead of manual MCP config edits.

## Use in Codex

Use package bootstrap above for Codex. Use the repo plugin below only from a cloned checkout.

### Quick path

1. Clone the repository.
2. Check Node.js 22+ (pinned in `.node-version`). If missing, ask Codex to use `ensure-node-runtime`.
3. From the repo root, run:

```bash
npm install
npm run build
```

### Install the built plugin

1. Open the cloned repo in Codex.
2. Install `Kibana Log Investigation` from the repo marketplace in Codex's plugin directory. If the model cannot install it, click in the UI yourself, then let the agent continue.
3. Run `node dist/src/bin/kibana-mcp-server.js bootstrap --client none`. This verifies the connection and creates an empty catalog on first install; the plugin already registers the server.
4. Reconnect the MCP process and check startup status. On failure, inspect sanitized stderr; rebuild and reinstall a missing runtime. After startup succeeds, restart once if tools need refreshing.
5. In a fresh thread, call `discover`. If empty, ask for the exact index or pattern and wait; only then call `configure_index`.

Repo-scoped plugin files:

- `.agents/plugins/marketplace.json`
- `plugins/kibana-log-investigation/.codex-plugin/plugin.json`
- `plugins/kibana-log-investigation/.mcp.json`
- `plugins/kibana-log-investigation/mcp-launcher.mjs`
- `plugins/kibana-log-investigation/dist/` (generated self-contained runtime and notices)

### Minimal handoff prompt

Send this prompt with the repo link:

```text
Install the `kibana-log-investigation` skill from Havesomecode/kibana-mcp-server, then run its connection-only bootstrap with the provisioned KIBANA_BASE_URL, KIBANA_USERNAME, and KIBANA_PASSWORD values. Do not edit Codex config files, import the example catalog, or inspect indexes. After install, ask me which exact index or pattern to configure before calling configure_index.
```
