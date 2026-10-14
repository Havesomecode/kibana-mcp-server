---
description: "What Kibana MCP Server is, why it exists and what it deliberately does not do."
---

# What is Kibana MCP Server?

Read-only MCP server for agent-driven log investigation against Kibana-backed search endpoints protected with basic auth.

## Start an investigation

1. Run `bootstrap`: verify only the connection, save credentials, create an empty managed catalog, and register Codex without config-file edits. Supply all connection values for prompt-free use. For hand-authored catalogs, guided `setup` imports your explicit selection and saves machine profiles.
2. Call `discover` for configured logical sources and field hints. If empty, ask the user for an exact index or pattern and wait; `configure_index` validates and saves only that selection.
3. Call `describe_fields` for a source's effective field capabilities before filtering.
4. Use `query` over an absolute time window: `hits`, `count`, `histogram`, `terms`, `stats`, or `grouped_top_hits`. Use `filter` when the exact field name is known.

## Why it exists

Agents use a small operator-selected source catalog, field capabilities, and typed results over the Model Context Protocol—no UI scraping or cluster-wide index listing.

## Boundaries

- **Read-only by design.** The server searches and describes. It never writes to Elasticsearch or Kibana.
- **No index guessing.** Never guess, list, or scan indexes before a person names the exact index or pattern.
- **Schema-aware features depend on the deployment.** When Kibana does not expose field metadata, the server falls back to sampling fields through search, which is a heuristic.

## Where to go next

- [Getting started](./getting-started): install and investigate.
- [HTTP transport](../deployment/http): share a server across callers.
- [Tool reference](../reference/tools/query): inputs and outputs.
