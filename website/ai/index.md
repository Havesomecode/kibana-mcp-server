---
description: "How Kibana MCP Server supports AI agents - LLM-friendly documentation, agent plugins for Claude Code and Codex, and a skill installable with skills.sh."
---

# Built for agents

Choose how to give your agent the server, workflow, or documentation:

| | What you get | Where |
| --- | --- | --- |
| **Documentation for LLMs** | This whole site as plain Markdown, following the `llms.txt` standard | [LLM-friendly documentation](./llms) |
| **Agent plugins** | The MCP server and the investigation skill, installed together from a plugin marketplace | [Agent plugins and skills](./agent-plugins) |
| **A skill for any agent** | The investigation workflow, installable with [skills.sh](https://skills.sh/) | [Agent plugins and skills](./agent-plugins#skills-sh-any-agent) |

## What the skill teaches

The `kibana-log-investigation` skill follows this sequence:

1. Bootstrap with the agent's client mode. Do not hand-edit configuration files or put passwords in command arguments.
2. Call `discover`. If empty, ask the user for the exact Kibana index or pattern and wait. Never guess, enumerate, or scan indexes.
3. Call `configure_index` only with the user's value.
4. Inspect `describe_fields` before filtering. Query an absolute time window.

## Pointing an agent at this documentation

Send your agent this prompt:

```text
Read https://havesomecode.github.io/kibana-mcp-server/llms.txt and use it to answer questions about Kibana MCP Server.
```

For one page, add `.md` to its URL.
