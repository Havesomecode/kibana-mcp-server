# `configure`

Legacy tool that replaces the Kibana connection and the whole source catalog. Only exposed over stdio, on a server started without any configuration.

Input:

```json
{
  "kibana": {
    "baseUrl": "https://kibana.example.com",
    "username": "elastic",
    "password": "secret",
    "timeoutMs": 10000
  },
  "sources": [
    {
      "id": "app_logs",
      "name": "Application Logs",
      "tags": ["app", "logs", "production"],
      "timeField": "@timestamp",
      "backend": {
        "kind": "kibana_internal_search_es",
        "path": "/internal/search/es",
        "index": ["app-logs-*"]
      },
      "schema": {
        "kind": "kibana_data_views_fields",
        "index": ["app-logs-*"]
      },
      "fieldHints": [
        {
          "name": "traceId",
          "aliases": ["trace_id"]
        }
      ],
      "defaultTextFields": ["message"],
      "evidenceFields": ["traceId"]
    }
  ]
}
```

If you do not bootstrap via env vars and do not have a saved default profile, call `configure` before `discover` or `query`.
Calling `configure` also persists the provided sources to the runtime source-catalog file so later restarts can reload them automatically.
If you want `describe_fields`, exact-field auto-resolution in `query`, or nested-filter validation, configure `schema` for each relevant source.
In deployments where schema endpoints are routed indirectly or return `404`, prefer `schema.kind = "kibana_data_views_fields"` with `schema.index` set and omit `schema.path`.
