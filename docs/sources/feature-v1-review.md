# Feature v1 Review — Historical Backend Evidence

This preserves the original live review's observations against a real Kibana deployment and a high-volume structured-log source. They have not been repeated against the current server or deployment and are not a statement of current failures. The obsolete checkout-catalog setup instructions are omitted.

## Observed successes

- A `filter` request in `hits` mode returned `next_cursor`; using it in the next request returned the next page.
- Filtering `event.keyword = WORKFLOW_RELOAD_STATS` and sorting by `total_duration_ms` produced the expected descending ranking.

## Observed failures

- `describe_fields` for the `event` and `steps` fields of `workflow_metrics` returned Kibana `404 Not Found`.
- Exact filtering `event = CACHE_REFRESH_PHASES` returned zero hits, while the equivalent `event.keyword` request returned the expected results.
- A nested request for path `steps`, field `name`, value `CACHE_REFRESH`, with `extract_nested = true`, returned Kibana `404 Not Found`.

These observations motivated field introspection, exact-match resolution and nested evidence extraction. Current schema sampling can recover some field capabilities but cannot establish actual nested mappings; see the [schema-endpoint investigation](../solutions/integration-issues/kibana-mcp-schema-endpoints-may-be-unavailable-2026-04-03.md).

Current supported request shapes are documented in the [tool reference](../../website/reference/tools/query.md). Local regression tests establish behavior against controlled responses, not a fresh successful replay of this historical deployment.
