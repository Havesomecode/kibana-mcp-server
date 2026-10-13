# Kibana MCP Feature Additions v1

## Goal

Close the remaining gaps that prevented the Kibana MCP from fully covering a realistic log-investigation workflow without falling back to direct Elasticsearch calls or manual Kibana inspection.

## Additions

### 1. Field and Mapping Introspection

Add a tool that exposes the effective schema for a configured source.

Proposed tool:

- `describe_fields(source_id)`

Expected output:

- field name
- field type
- whether the field is searchable
- whether the field is aggregatable
- available subfields such as `.keyword`

Why this is needed:

- `event` and `event.keyword` behave differently.
- exact match on `event` can return false negatives
- aggregating on `event` can fail with fielddata errors
- the agent should not have to guess which field variant is safe

### 2. Exact-Match Field Resolution

Improve filtering so exact-match intent works without knowing the underlying mapping details.

Options:

- add `exact: true` to `query` and `filter`
- or automatically prefer `.keyword` when the requested field is text and a keyword subfield exists
- or return a structured warning with the suggested replacement field

Why this is needed:

- `event = CACHE_REFRESH_PHASES` returned `0` hits
- `event.keyword = CACHE_REFRESH_PHASES` returned the expected results

### 3. Nested Array Querying

Support filtering inside nested arrays in structured log documents.

Proposed capability:

- nested filter support for fields such as `steps.name`

Example use cases:

- find `WORKFLOW_RELOAD_STATS` where `steps.name = CACHE_REFRESH`
- find workflow stats where a nested step has `items_scanned = 0`

Why this is needed:

- critical investigation checks rely on inspecting specific steps inside `steps[]`
- current MCP only returns the whole parent document

### 4. Nested Projection / Extraction

When a nested match is found, allow returning only the matching nested object instead of the entire parent hit.

Proposed capability:

- `extract_nested` or equivalent result shaping for nested matches

Example output:

- parent identifiers: `@timestamp`, `trace_id`, `job_id`
- matching nested object:
  - `name`
  - `duration_ms`
  - `items_scanned`
  - `items_reloaded`
  - `items_changed`

Why this is needed:

- the current raw hit is too bulky for precise layer-level analysis
- investigation steps need compact evidence for one object at a time

### 5. Cursor-Based Pagination

Add pagination for large hit sets.

Proposed capability:

- cursor or `search_after` style pagination for `hits`
- pagination for `terms` results where applicable

Why this is needed:

- some correlated flows produce tens of thousands of hits
- one `trace_id` returned more than `80,000` documents
- the current MCP only exposes the first `limit` hits

### 6. Numeric Stats Aggregations

Add numeric summary aggregations on arbitrary fields.

Proposed capability:

- `stats(field)`
- optional `group_by`

Expected metrics:

- `min`
- `max`
- `avg`
- `sum`
- `count`
- `p50`
- `p95`
- `p99`

Example use cases:

- summarize `total_duration_ms` for `WORKFLOW_RELOAD_STATS`
- compare `duration_ms` by region or by trace id

Why this is needed:

- protocol decisions depend on cost and latency patterns, not only on raw hits

### 7. Grouped Top Hits

Add bucketed top-hit retrieval.

Proposed capability:

- group by one field, then return top hits sorted by another field

Example use cases:

- top `WORKFLOW_RELOAD_STATS` by `total_duration_ms` per `trace_id`
- latest `CACHE_REFRESH_PHASES` per `job_id`
- highest `total_duration_ms` per `region`

Why this is needed:

- global sorting is not enough when the workflow needs “worst per correlation key”

### 8. Correlation Timeline Helper

Add a higher-level timeline tool for reconstructing one execution flow.

Proposed capability:

- merged, chronologically sorted timeline over a source and a time window
- filterable by combinations of:
  - `trace_id`
  - `task_id`
  - `job_id`
  - `region`
  - `service`
  - `event`

Why this is needed:

- `trace_id` alone is not always a single-run correlation key
- investigation work often requires `trace_id + timestamp window + job_id/region/service`
- correlated workflow inspection is a common operator need

## Summary

The current MCP already covers:

- exact keyword filtering
- sorting hits by numeric fields
- grouping by `event.keyword`

The remaining gaps are:

- schema discovery
- exact-match safety
- nested layer analysis
- deep pagination
- numeric aggregation
- grouped top-hit retrieval
- timeline reconstruction
