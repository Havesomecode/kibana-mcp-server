---
description: "What Kibana MCP Server is, why it exists and what it deliberately does not do."
---

# What is Kibana MCP Server?

Read-only MCP server for agent-driven log investigation against Kibana-backed search endpoints protected with basic auth.

The server is intentionally small:

- `setup` saves one or more machine-level Kibana profiles for later threads
- `bootstrap` verifies only the Kibana connection, creates an empty managed catalog, saves credentials, and registers Codex without prompts or config-file edits
- `configure_index` validates and persists exactly one index or pattern after the user explicitly names it
- `configure` still exists for advanced MCP clients that want to drive credentials and source catalogs at runtime
- `describe_fields` exposes effective field capabilities for one configured source
- `discover` lists configured logical sources and field hints
- `filter` runs an exact-field filter when the field name is already known
- `query` searches one or more sources over an absolute time window in `hits`, `count`, `histogram`, `terms`, `stats`, or `grouped_top_hits` mode

It is designed as a general-purpose log investigation MCP for environments where operators can expose a small set of useful logical sources.

## Why it exists

Kibana is built for people: dashboards, saved searches, a query bar. An agent investigating an incident needs something else: a short list of sources it can trust, the fields it may filter on, and results it can read without scraping a UI.

This server gives an agent exactly that, over the Model Context Protocol:

- **Logical sources instead of raw indexes.** Operators expose a small catalog of named sources. The agent starts from those, never from a list of every index in the cluster.
- **Fields before filters.** The agent can inspect the effective fields of a source, including which ones support exact matching, before it tightens a query.
- **Structured output.** Hits, counts, histograms, term buckets and statistics come back as typed results.

## Boundaries

- **Read-only by design.** The server searches and describes. It never writes to Elasticsearch or Kibana.
- **No index guessing.** A source is configured only after a person has named the exact index or index pattern.
- **Schema-aware features depend on the deployment.** When Kibana does not expose field metadata, the server falls back to sampling fields through search, which is a heuristic.

## Where to go next

- [Getting started](./getting-started) installs the server and runs a first investigation.
- [HTTP transport](../deployment/http) covers running one shared server for many callers.
- The [tool reference](../reference/tools/query) documents every input and output.
