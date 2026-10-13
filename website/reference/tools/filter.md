---
description: "Reference of the filter tool: exact-field filtering without alias resolution."
---

# `filter`

Runs an exact-field filter when the field name is already known, bypassing alias resolution.

Use `filter` when you already know the backend field you want to target and want to avoid alias resolution.

Input:

```json
{
  "source_ids": ["workflow_metrics"],
  "start_time": "2026-04-02T12:00:00Z",
  "end_time": "2026-04-02T12:15:00Z",
  "field": "eventName.keyword",
  "value": "WORKFLOW_RELOAD_STATS",
  "nested_filters": [
    {
      "path": "steps",
      "field": "steps.name.keyword",
      "value": "CACHE_REFRESH"
    }
  ],
  "extract_nested": true,
  "mode": "hits",
  "sort_by": "total_duration_ms",
  "limit": 50
}
```

`filter` returns the same structured output envelope as `query`, but it does not apply field-hint alias rewrites.
If schema metadata is available and you pass a logical text field such as `event`, the server may still promote it to a preferred exact field such as `event.keyword` for exact term matching. If you pass an exact backend field like `event.keyword`, it is used as-is.
`sort_by` is supported for `hits` and `grouped_top_hits`.
