---
description: "The investigation workflow step by step: configure a source, discover, describe fields, then query."
---

# Investigating with an agent

An investigation follows the same three moves every time: find the source, check its fields, then query. The agent drives them through MCP tools; this page shows what happens at each step.

## 1. Configure a source, once

A fresh profile has no source. The agent must not guess one: it asks which exact Kibana index or index pattern to use, then calls [`configure_index`](../reference/tools/configure-index) with that value.

```json
{ "index": "app-logs-*", "source_name": "Application logs", "source_id": "app-logs" }
```

The server checks that the pattern resolves to fields, picks a time field, runs one probe search and saves the source in the profile's catalog. Later conversations reuse it.

## 2. Discover the sources

[`discover`](../reference/tools/discover) lists the logical sources of the current profile, with their time field and field hints.

```json
{ "query": "application" }
```

## 3. Inspect the fields

Before filtering, the agent asks [`describe_fields`](../reference/tools/describe-fields) which fields exist and which ones support exact matching.

```json
{ "source_id": "app-logs", "query": "status" }
```

A text field with a keyword sub-field is reported with a preferred exact field, for example `event` and `event.keyword`. That is what makes later filters reliable.

## 4. Query

[`query`](../reference/tools/query) searches one or more sources over an absolute time window. Start broad, then narrow.

Count first:

```json
{
  "source_ids": ["app-logs"],
  "start_time": "2026-04-02T12:00:00Z",
  "end_time": "2026-04-02T13:00:00Z",
  "text": "timeout",
  "mode": "count"
}
```

Then group to see where the errors come from:

```json
{
  "source_ids": ["app-logs"],
  "start_time": "2026-04-02T12:00:00Z",
  "end_time": "2026-04-02T13:00:00Z",
  "text": "timeout",
  "mode": "terms",
  "group_by": "service.name"
}
```

Then read the hits of the service that stands out:

```json
{
  "source_ids": ["app-logs"],
  "start_time": "2026-04-02T12:00:00Z",
  "end_time": "2026-04-02T13:00:00Z",
  "filters": [{ "field": "service.name", "value": "checkout" }],
  "mode": "hits",
  "limit": 50
}
```

When the exact field name is already known, [`filter`](../reference/tools/filter) skips alias resolution and filters on it directly.

## Query modes

| Mode | Returns |
| --- | --- |
| `hits` | Matching documents, sorted, with a cursor for the next page |
| `count` | Number of matches per source |
| `histogram` | Matches over time, needs `histogram_interval` |
| `terms` | Top values of a field, needs `group_by` |
| `stats` | Count, min, max, average and percentiles of a numeric field, needs `stats_field` |
| `grouped_top_hits` | The first hits of each group, needs `group_by` |

## When something fails

Backend failures come back with a stable code such as `KIBANA_TIMEOUT` or `KIBANA_AUTHENTICATION`. See [Errors](../reference/errors).
