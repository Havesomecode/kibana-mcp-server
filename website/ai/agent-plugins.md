---
description: "Install the Kibana log investigation plugin for Claude Code or Codex, or the skill with skills.sh, and connect any MCP client to the server."
---

# Agent plugins and skills

Choose your agent below. Plugins install the `kibana-log-investigation` skill and register the MCP server; skills.sh installs only the skill.

| Channel | Skill | MCP server | Agents |
| --- | --- | --- | --- |
| [Claude Code plugin marketplace](#claude-code) | Yes | Yes | Claude Code (CLI, desktop, IDE extensions) |
| [Codex](#codex) | Yes | Yes | Codex CLI and the Codex app |
| [skills.sh](#skills-sh-any-agent) | Yes | Manual | Cursor, Gemini CLI, Windsurf and others |

Then [Connect to Kibana](#connect-to-kibana). Registration alone does not save a connection.

## Claude Code

Run:

```bash
claude plugin marketplace add Havesomecode/kibana-mcp-server
claude plugin install kibana-log-investigation@kibana-mcp-server
```

Or run inside Claude Code:

```text
/plugin marketplace add Havesomecode/kibana-mcp-server
/plugin install kibana-log-investigation@kibana-mcp-server
```

For team installation, add this to the project's `.claude/settings.json`:

```json
{
  "extraKnownMarketplaces": {
    "kibana-mcp-server": {
      "source": {
        "source": "github",
        "repo": "Havesomecode/kibana-mcp-server"
      }
    }
  },
  "enabledPlugins": {
    "kibana-log-investigation@kibana-mcp-server": true
  }
}
```

Expected: the plugin registers `npx -y @havesomecode/kibana-mcp-server serve`. Claude loads the skill for matching tasks.

## Codex

1. Run connection bootstrap. Supply credentials through a trusted environment or its secret prompt, never password arguments:

```bash
npx -y @havesomecode/kibana-mcp-server bootstrap --client codex
```

2. Install the skill:

```bash
npx skills add Havesomecode/kibana-mcp-server --skill kibana-log-investigation --agent codex --global --yes
```

### Codex plugin marketplace

For a cloned checkout, use `.agents/plugins/marketplace.json`:

1. Run `npm install` and `npm run build` before installing the plugin. The build creates `plugins/kibana-log-investigation/dist/`; the installed bundle needs neither the checkout nor its `node_modules`.
2. Check Codex's MCP startup status before restarting a discussion. On failure, inspect sanitized stderr; rebuild and reinstall a missing runtime.

`npm run verify:entrypoint` checks a copied plugin with a synthetic connection, not native Codex startup or a real Kibana backend. See [Getting started](../guide/getting-started#use-in-codex).

### Version-matched handoff

1. Resolve the branch, tag, or package installation to its full commit SHA: the **resolved installation commit**.
2. Hand off this immutable README URL:

```text
https://raw.githubusercontent.com/Havesomecode/kibana-mcp-server/<resolved-commit>/README.md
```

3. Read `INSTALL.md` and the skills from that same commit. Branches and tags are resolution inputs, not final URLs.

Do not infer a Git tag from an npm version; use the exact package's `gitHead`. In a maintained checkout, run `node scripts/readme-handoff.mjs <resolved-installation-ref>` to verify the commit-pinned README before handoff.

## skills.sh (any agent)

Run the [`skills`](https://skills.sh/) CLI:

```bash
# pick the agents interactively
npx skills add Havesomecode/kibana-mcp-server --skill kibana-log-investigation

# install for specific agents, without prompts
npx skills add Havesomecode/kibana-mcp-server --skill kibana-log-investigation -a claude-code -a cursor -y
```

Add `-g` to install the skill globally instead of in the current project.

::: warning
skills.sh installs the skill only. Declare the MCP server yourself with the snippet below.
:::

## Declare the MCP server manually

With Node.js 22+, add the stdio command to your MCP client:

::: code-group

```json [.mcp.json (Claude Code, VS Code)]
{
  "mcpServers": {
    "kibana-log-investigation": {
      "command": "npx",
      "args": ["-y", "@havesomecode/kibana-mcp-server", "serve"]
    }
  }
}
```

```json [Cursor (.cursor/mcp.json)]
{
  "mcpServers": {
    "kibana-log-investigation": {
      "command": "npx",
      "args": ["-y", "@havesomecode/kibana-mcp-server", "serve"]
    }
  }
}
```

```toml [Codex (~/.codex/config.toml)]
[mcp_servers.kibana-log-investigation]
command = "npx"
args = ["-y", "@havesomecode/kibana-mcp-server", "serve"]
```

:::

For a shared server [over HTTP](../deployment/http), declare the gateway URL instead.

## Connect to Kibana

1. Provision credentials through a secret provider, then save the connection once per machine. `--client none` avoids duplicate registration:

```bash
export KIBANA_BASE_URL='https://kibana.example.com'
export KIBANA_USERNAME='elastic'
export KIBANA_PASSWORD='use-a-secret-provider'

npx -y @havesomecode/kibana-mcp-server bootstrap --client none
```

Expected: a verified connection, credentials in the OS secret store, and an empty source catalog. Bootstrap does not inspect indexes.

2. Remove direct connection variables from the MCP server environment to use the saved profile. Reconnect the client or start a new session.
3. Call `discover`. If the catalog is empty, ask for the exact index or pattern and wait. Never guess, list, or scan indexes; call `configure_index` only with the user's answer.

Without a saved connection, startup fails: `No saved Kibana connection is available. Run connection bootstrap first.` Direct environment startup requires an explicit `KIBANA_SOURCE_CATALOG_PATH` or configuration-file store; no implicit checkout catalog.

For agent-run bootstrap, use `--client codex` in Codex; use `--client none` where a plugin or manual configuration already registers the server.
