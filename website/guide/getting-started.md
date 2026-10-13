---
description: "Requirements, prompt-free bootstrap, agent skill installation and use in Codex."
---

# Getting started

## Requirements

- Node.js 22+
- A Kibana-compatible read endpoint reachable with basic auth
- One or more Elasticsearch index patterns. `bootstrap` generates the source catalog; hand-authored catalogs remain supported for advanced setups.

## Installation

### Prompt-free connection bootstrap

Pre-provision the connection values in the environment:

```bash
export KIBANA_BASE_URL='https://kibana.example.com'
export KIBANA_USERNAME='elastic'
export KIBANA_PASSWORD='use-a-secret-provider'

npx -y @havesomecode/kibana-mcp-server bootstrap \
  --client codex
```

This command performs no prompts and does not edit Codex configuration files directly. It verifies only the Kibana connection, writes an empty managed source catalog on first install, stores credentials securely, and registers the exact running package transport. It does not list, scan, infer, or configure indexes.

After bootstrap, call `discover`. When no source is configured, the agent must ask the user which exact Kibana index or index pattern to use. Only after the user answers may the agent call `configure_index` with that value. That tool validates only the approved index and persists it without accepting credentials.

Bootstrap reruns preserve sources that were configured through this explicit flow. It refuses to replace a hand-authored or modified catalog unless `--replace` is supplied explicitly; `--replace` creates an empty managed catalog.

Never pass passwords as command-line arguments. Use `KIBANA_PASSWORD`, `--password-env NAME`, or `--password-stdin`.

### Install the agent skill

The repository contains a standard Agent Skill discoverable by the `skills` CLI and skills.sh:

```bash
npx skills add Havesomecode/kibana-mcp-server \
  --skill kibana-log-investigation \
  --agent codex \
  --global \
  --yes
```

The skill teaches compatible agents to run the same verified bootstrap instead of editing MCP config files. Its source is `skills/kibana-log-investigation/SKILL.md`.

## Use in Codex

The prompt-free package bootstrap above is the primary Codex path. The repo-scoped plugin remains available for contributors working from a cloned checkout.

### Quick path

1. Clone the repository.
2. Make sure Node.js 22+ is available.
   - if it is missing, ask Codex to use the plugin skill `ensure-node-runtime`
   - the repo pins Node major `22` in `.node-version`
3. From the repo root, run:

```bash
npm install
npm run build
```

4. Open the cloned repo in Codex.
5. Open the plugin directory in Codex and install `Kibana Log Investigation` from the repo marketplace.
   - if the current model cannot complete that install itself, do the Codex UI click manually and let the agent continue with configuration afterward
6. Check the plugin's MCP process startup status. If startup fails, inspect sanitized stderr, rebuild and reinstall the plugin. Restart once only after startup succeeds if the tools still need refreshing.
7. Run `node dist/src/bin/kibana-mcp-server.js bootstrap --client none` to verify the connection and save an empty profile. The repo plugin already supplies the client registration.
8. In a fresh thread, call `discover`, ask the user for the exact index or pattern, then call `configure_index` only after they answer.

Repo-scoped plugin files:

- `.agents/plugins/marketplace.json`
- `plugins/kibana-log-investigation/.codex-plugin/plugin.json`
- `plugins/kibana-log-investigation/.mcp.json`
- `plugins/kibana-log-investigation/mcp-launcher.mjs`
- `plugins/kibana-log-investigation/dist/` (generated self-contained runtime and notices)

### Minimal handoff prompt

If you are handing only the repo link to another Codex agent, this usually works:

```text
Install the `kibana-log-investigation` skill from Havesomecode/kibana-mcp-server, then run its connection-only bootstrap with the provisioned KIBANA_BASE_URL, KIBANA_USERNAME, and KIBANA_PASSWORD values. Do not edit Codex config files, import the example catalog, or inspect indexes. After install, ask me which exact index or pattern to configure before calling configure_index.
```
