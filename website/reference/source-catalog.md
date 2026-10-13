# Source catalog

A source catalog is a JSON document listing the logical sources a profile can query. `configure_index` generates and maintains it; hand-authored catalogs remain supported for advanced setups.

## Source definition

Each source definition should provide:

- stable `id`
- human-readable `name`
- `timeField`
- `tags` and optional `description`
- `fieldHints` so agents can form exact-match filters
- `defaultTextFields` for free-text search
- `evidenceFields` to elevate likely report-worthy fields
- `backend` describing how the source is queried
- optional `schema` describing how field introspection is performed for `describe_fields` and other schema-dependent features

Supported backend kinds:

- `kibana_internal_search_es`
  - POSTs to a Kibana endpoint like `/internal/search/es`
  - wraps the query body inside `{ "params": { "index": ..., "body": ... } }`
  - adds `kbn-xsrf`
- `elasticsearch_search`
  - POSTs the compiled Elasticsearch body directly to the configured path

Supported schema backend kinds:

- `kibana_data_views_fields`
  - tries Kibana wildcard field-metadata endpoints, preferring `/internal/data_views/_fields_for_wildcard`
  - adds `pattern=...` from `schema.index` or `backend.index`
  - if all known field-metadata endpoints return `404`, falls back to sampling fields through the configured search backend
- `kibana_index_patterns_fields`
  - tries the legacy wildcard field-metadata endpoint `/api/index_patterns/_fields_for_wildcard` and related fallbacks
  - adds `pattern=...` from `schema.index` or `backend.index`
  - if all known field-metadata endpoints return `404`, falls back to sampling fields through the configured search backend
- `elasticsearch_field_caps`
  - GETs an Elasticsearch field capabilities endpoint such as `/<index-pattern>/_field_caps?fields=*`
  - uses `schema.path` when provided or derives the default from `schema.index`

Deployment note:

- some Kibana deployments expose search transport but not field-metadata endpoints
- when direct schema endpoints such as `/api/data_views/fields_for_wildcard`, `/api/index_patterns/_fields_for_wildcard`, or `/<index>/_field_caps` return `404`, the server falls back to sampling fields through the configured search backend
- this fallback is heuristic rather than authoritative, but it is often sufficient to recover `.keyword` promotion and object-path discovery in search-only environments

Example source shape for an application log stream:

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

Keep `schema.path` omitted for this setup. The server will try the known Kibana metadata endpoints first and then fall back to search-transport sampling if those endpoints still return `404`.
