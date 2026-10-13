# `query`

Searches one or more sources over an absolute time window, in hits, count, histogram, terms, stats or grouped mode.

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

Supported modes:

- `hits`
- `count`
- `histogram`
  - requires `histogram_interval`
- `terms`
  - requires `group_by`
- `stats`
  - requires `stats_field`
  - can also take `group_by`
- `grouped_top_hits`
  - requires `group_by`
  - requires `sort_by`
  - accepts `top_hits_size`

Every response includes a `query_echo` section so the investigating agent can explain which sources, bounds, filters, and mode were actually used.
For `hits` mode, you can also pass `sort_by` to sort on a chosen field. In `query`, exact filters and grouped bucket fields use field-hint alias resolution plus schema-aware exact-field preference when metadata is available. When the server rewrites a logical field such as `event` to a safer exact field such as `event.keyword`, the response includes an advisory. If schema metadata is unavailable, the query proceeds with the requested field and returns a `schema_unavailable` advisory instead of silently pretending exact-safe resolution happened.

For very large single-source hit sets, `query` also supports cursor pagination:

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

Cursor pagination is currently supported only for single-source `hits` queries.

Nested filtering also depends on schema metadata. If a source does not expose a working `schema` backend, nested requests fail early with a clear configuration error instead of reaching Kibana and failing with a backend 404.

Example `stats` query:

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

Example `grouped_top_hits` query:

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
