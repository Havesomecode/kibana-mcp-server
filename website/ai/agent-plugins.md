---
description: "Install the Kibana log investigation plugin for Claude Code or Codex, or the skill with skills.sh, and connect any MCP client to the server."
---

# Agent plugins and skills

The repository ships an agent plugin that bundles two things:

- **the `kibana-log-investigation` skill**, which teaches the agent the investigation workflow and its safety rules;
- **the Kibana MCP server**, registered for you.

Pick the channel that matches your agent.

| Channel | Skill | MCP server | Agents |
| --- | --- | --- | --- |
| [Claude Code plugin marketplace](#claude-code) | Yes | Yes | Claude Code (CLI, desktop, IDE extensions) |
| [Codex](#codex) | Yes | Yes | Codex CLI and the Codex app |
| [skills.sh](#skills-sh-any-agent) | Yes | Manual | Cursor, Gemini CLI, Windsurf and others |

Whatever the channel, the server needs a Kibana connection before it can answer. See [Connect to Kibana](#connect-to-kibana).

## Claude Code

Add the marketplace, then install the plugin:

```bash
claude plugin marketplace add Havesomecode/kibana-mcp-server
claude plugin install kibana-log-investigation@kibana-mcp-server
```

Or from inside a Claude Code session:

```text
/plugin marketplace add Havesomecode/kibana-mcp-server
/plugin install kibana-log-investigation@kibana-mcp-server
```

To share the plugin with your team, declare it in the `.claude/settings.json` of your project:

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

The plugin registers the MCP server as `npx -y @havesomecode/kibana-mcp-server serve`. Claude loads the skill on its own when a task matches it.

## Codex

The recommended path for Codex is the bootstrap command, which verifies the connection and registers the server in one step:

```bash
npx -y @havesomecode/kibana-mcp-server bootstrap --client codex
```

Then add the skill:

```bash
npx skills add Havesomecode/kibana-mcp-server --skill kibana-log-investigation --agent codex --global --yes
```

### Codex plugin marketplace

The repository also declares a Codex marketplace in `.agents/plugins/marketplace.json`. It is meant for contributors working from a cloned checkout. Run `npm install` and `npm run build` before installing it: the build produces a self-contained runtime under `plugins/kibana-log-investigation/dist/`, and the installed plugin launches that local bundle without depending on the checkout or its `node_modules`.

Check Codex's MCP process startup status before restarting a discussion. If startup fails, inspect sanitized stderr, rebuild, and reinstall the plugin. `npm run verify:entrypoint` exercises a copied installed plugin with a synthetic connection; it does not verify native Codex startup or a real Kibana backend. See [Getting started](../guide/getting-started#use-in-codex).

### Version-matched handoff

Before handing a branch, tag, or package installation to another agent, resolve it to the full commit SHA. That SHA is the **resolved installation commit** used in the immutable README URL:

```text
https://raw.githubusercontent.com/Havesomecode/kibana-mcp-server/<resolved-commit>/README.md
```

Read `INSTALL.md` and the skills from that same commit. Branch and tag names are resolution inputs, not final handoff URLs. Do not infer a Git tag from an npm version; use the exact package's `gitHead`. In a maintained checkout, `node scripts/readme-handoff.mjs <resolved-installation-ref>` verifies the commit-pinned README before emitting the handoff.

## skills.sh (any agent)

The [`skills`](https://skills.sh/) CLI copies the skill into the directory your agent reads.

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

For any MCP client, the server is a stdio command. It requires Node.js 22 or newer.

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

A team that runs the server [over HTTP](../deployment/http) behind a gateway declares the URL of that gateway instead.

## Connect to Kibana

A plugin or a manual declaration only registers the server. Save the connection once per machine, without registering a client:

```bash
export KIBANA_BASE_URL='https://kibana.example.com'
export KIBANA_USERNAME='elastic'
export KIBANA_PASSWORD='use-a-secret-provider'

npx -y @havesomecode/kibana-mcp-server bootstrap --client none
```

Bootstrap verifies the connection, stores the credentials in the secret store of the operating system and creates an empty source catalog. Start the MCP server without direct connection variables so it uses the saved profile, then reconnect the client or start a new session: the agent asks which exact index or index pattern to use, and calls `configure_index` with your answer.

Without a saved connection the server fails at startup with `No saved Kibana connection is available. Run connection bootstrap first.` Direct environment-based startup requires an explicit `KIBANA_SOURCE_CATALOG_PATH` or configuration-file store, never an implicit checkout catalog.

You can also let the agent do it. The skill knows which mode fits the agent it runs in: `--client codex` in Codex, where bootstrap registers the server itself, and `--client none` in Claude Code and elsewhere, where a plugin or your own configuration does.
