---
description: "Reference of the filter tool: exact-field filtering without alias resolution."
---

# `filter`

Filter a known backend field directly, without field-hint alias resolution.

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

- Returns the same structured output envelope as `query`, without field-hint alias rewrites.
- With schema metadata, a logical text field such as `event` may still promote to preferred exact field `event.keyword`. An exact backend field such as `event.keyword` is used as-is.
- `sort_by` supports `hits` and `grouped_top_hits`.
