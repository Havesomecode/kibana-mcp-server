---
description: "How Kibana MCP Server supports AI agents - LLM-friendly documentation, agent plugins for Claude Code and Codex, and a skill installable with skills.sh."
---

# Built for agents

Kibana MCP Server exists so that an agent can investigate logs. The project treats agents as first-class readers and users, in three ways.

| | What you get | Where |
| --- | --- | --- |
| **Documentation for LLMs** | This whole site as plain Markdown, following the `llms.txt` standard | [LLM-friendly documentation](./llms) |
| **Agent plugins** | The MCP server and the investigation skill, installed together from a plugin marketplace | [Agent plugins and skills](./agent-plugins) |
| **A skill for any agent** | The investigation workflow, installable with [skills.sh](https://skills.sh/) | [Agent plugins and skills](./agent-plugins#skills-sh-any-agent) |

## What the skill teaches

The `kibana-log-investigation` skill tells an agent how to behave around this server:

- bootstrap the connection with the mode that fits the agent (Codex, Claude Code or another one), without editing configuration files by hand, and never put a password in a command argument;
- call `discover` first, and when no source exists, ask the user which exact Kibana index or index pattern to use;
- call `configure_index` only with the value the user gave, never a guessed or enumerated one;
- inspect fields with `describe_fields` before filtering, then query over an absolute time window.

## Pointing an agent at this documentation

Give your agent the index of the documentation and let it fetch the pages it needs:

```text
Read https://havesomecode.github.io/kibana-mcp-server/llms.txt and use it to answer questions about Kibana MCP Server.
```

Every page also has a Markdown twin: add `.md` to its URL.
