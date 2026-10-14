---
description: "Reference of the query tool: search sources over a time window in six modes."
---

# `query`

Search one or more sources over an absolute time window.

Input:

```json
{
  "source_ids": ["app_logs", "workflow_metrics"],
  "start_time": "2026-04-02T12:00:00Z",
  "end_time": "2026-04-02T12:15:00Z",
  "text": "SERVICE_RELOAD",
  "filters": [
    { "field": "region", "value": "us-east-1" },
    { "field": "traceId", "value": "trace-12345" }
  ],
  "nested_filters": [
    {
      "path": "steps",
      "field": "name",
      "value": "CACHE_REFRESH"
    }
  ],
  "extract_nested": true,
  "mode": "hits",
  "sort_by": "total_duration_ms",
  "sort": "desc",
  "limit": 50
}
```

## Modes

| Mode | Required fields | Optional fields |
| --- | --- | --- |
| `hits` | | `sort_by` (sort on a chosen field) |
| `count` | | |
| `histogram` | `histogram_interval` | |
| `terms` | `group_by` | |
| `stats` | `stats_field` | `group_by` |
| `grouped_top_hits` | `group_by`, `sort_by` | `top_hits_size` |

## Field resolution

- Exact filters and grouped bucket fields use field-hint aliases and, with metadata, schema-aware exact-field preference.
- Rewriting `event` to safer exact field `event.keyword` returns an advisory.
- Without metadata, queries use the requested field and return `schema_unavailable`; exact-safe resolution is not claimed.
- Nested filters require working `schema` metadata; otherwise they fail early with a configuration error, not a backend 404.

Every response includes `query_echo`: sources, bounds, filters and mode actually used.

## Cursor pagination

For large hit sets, pass `cursor`. Supported only for **single-source `hits`** queries:

```json
{
  "source_ids": ["workflow_metrics"],
  "start_time": "2026-04-02T12:00:00Z",
  "end_time": "2026-04-02T12:15:00Z",
  "mode": "hits",
  "limit": 100,
  "cursor": "REPLACE_ME_NEXT_CURSOR"
}
```

## `stats` example

```json
{
  "source_ids": ["workflow_metrics"],
  "start_time": "2026-04-02T12:00:00Z",
  "end_time": "2026-04-02T12:15:00Z",
  "mode": "stats",
  "stats_field": "total_duration_ms",
  "group_by": "trace_id",
  "limit": 25
}
```

## `grouped_top_hits` example

```json
{
  "source_ids": ["workflow_metrics"],
  "start_time": "2026-04-02T12:00:00Z",
  "end_time": "2026-04-02T12:15:00Z",
  "mode": "grouped_top_hits",
  "group_by": "trace_id",
  "sort_by": "total_duration_ms",
  "top_hits_size": 1,
  "limit": 25
}
```
