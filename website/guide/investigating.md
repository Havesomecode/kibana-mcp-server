---
description: "The investigation workflow step by step: configure a source, discover, describe fields, then query."
---

# Investigating with an agent

Ask the agent to discover a source, inspect its fields, then query. Configure a source only if none exists.

## 1. Configure a source, once

For a fresh profile, call `discover` first. If empty, ask for the exact Kibana index or pattern and wait. Never guess, list, or scan indexes. Call [`configure_index`](../reference/tools/configure-index) only with the user's answer; this example assumes they selected `app-logs-*`:

```json
{ "index": "app-logs-*", "source_name": "Application logs", "source_id": "app-logs" }
```

Expected: fields checked, a time field selected, one probe search, and a saved source for later conversations.

## 2. Discover the sources

Call [`discover`](../reference/tools/discover):

```json
{ "query": "application" }
```

Expected: this profile's logical sources, time fields, and field hints.

## 3. Inspect the fields

Before filtering, call [`describe_fields`](../reference/tools/describe-fields):

```json
{ "source_id": "app-logs", "query": "status" }
```

Use the returned preferred exact field for matching, such as `event.keyword` for `event`.

## 4. Query

Call [`query`](../reference/tools/query) over an absolute time window. Count first:

```json
{
  "source_ids": ["app-logs"],
  "start_time": "2026-04-02T12:00:00Z",
  "end_time": "2026-04-02T13:00:00Z",
  "text": "timeout",
  "mode": "count"
}
```

Group to locate the errors:

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

Read hits for the service that stands out:

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

For a known exact field, use [`filter`](../reference/tools/filter) without alias resolution.

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

Look up stable failure codes such as `KIBANA_TIMEOUT` or `KIBANA_AUTHENTICATION` in [Errors](../reference/errors).
