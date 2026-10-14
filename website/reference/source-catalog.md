---
description: "The format of a source definition, the supported backends and schema backends."
---

# Source catalog

Use `configure_index` to maintain a profile's JSON source catalog. Hand-authored catalogs remain supported for advanced setups.

## Source definition

Define each logical source with:

- stable `id`
- human-readable `name`
- `timeField`
- `tags` and optional `description`
- `fieldHints` so agents can form exact-match filters
- `defaultTextFields` for free-text search
- `evidenceFields` to elevate likely report-worthy fields
- `backend` describing how the source is queried
- optional `schema` describing how field introspection is performed for `describe_fields` and other schema-dependent features

## Search backends

- `kibana_internal_search_es`
  - POSTs to a Kibana endpoint like `/internal/search/es`
  - wraps the query body inside `{ "params": { "index": ..., "body": ... } }`
  - adds `kbn-xsrf`
- `elasticsearch_search`
  - POSTs the compiled Elasticsearch body directly to the configured path

## Schema backends

- `kibana_data_views_fields`: tries wildcard field-metadata endpoints, preferring `/internal/data_views/_fields_for_wildcard`.
- `kibana_index_patterns_fields`: tries legacy `/api/index_patterns/_fields_for_wildcard` and related fallbacks.
- `elasticsearch_field_caps`
  - GETs an Elasticsearch field capabilities endpoint such as `/<index-pattern>/_field_caps?fields=*`
  - uses `schema.path` when provided or derives the default from `schema.index`

Both Kibana schema backends add `pattern=...` from `schema.index` or `backend.index`. If all known metadata endpoints return `404`, they sample fields through the configured search backend. Some deployments expose only search transport; sampling is heuristic, not authoritative, but often recovers `.keyword` promotion and object-path discovery.

Direct `elasticsearch_field_caps` failures return without that fallback.

## Application log example

```json
{
  "id": "app_logs",
  "name": "Application Logs",
  "timeField": "@timestamp",
  "backend": {
    "kind": "kibana_internal_search_es",
    "path": "/internal/search/es",
    "index": "app-logs-*"
  },
  "schema": {
    "kind": "kibana_data_views_fields",
    "index": "app-logs-*"
  }
}
```

Omit `schema.path` here: try known Kibana metadata endpoints, then sample through search transport if all return `404`.
