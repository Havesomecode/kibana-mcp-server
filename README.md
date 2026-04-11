# Kibana Log Investigation MCP

Read-only MCP server for agent-driven log investigation against Kibana-backed search endpoints protected with basic auth.

The server is intentionally small:

- `setup` saves one or more machine-level Kibana profiles for later threads
- `configure` still exists for advanced MCP clients that want to drive credentials and source catalogs at runtime
- `describe_fields` exposes effective field capabilities for one configured source
- `discover` lists configured logical sources and field hints
- `filter` runs an exact-field filter when the field name is already known
- `query` searches one or more sources over an absolute time window in `hits`, `count`, `histogram`, `terms`, `stats`, or `grouped_top_hits` mode

It is designed as a general-purpose log investigation MCP for environments where operators can expose a small set of useful logical sources.

## Requirements

- Node.js 22+
- A Kibana-compatible read endpoint reachable with basic auth
- A source catalog JSON file describing the logical log sources to expose, or the bundled `config/sources.example.json`

## Project Status

This repo targets external adoption and AI-agent usability. It is safe for real investigations, but the install and release posture is still evolving.

- Guaranteed: repo-local Codex plugin install (see `INSTALL.md`)
- Guaranteed: guided machine setup through `npm run setup`
- Available: published package install via `npx -y @havesomecode/kibana-mcp-server`
- Active: semantic-release automation for tags, npm publish, and GitHub Releases
- Support posture and compatibility details live in `docs/project/support-policy.md`
- Contributing and security reporting live in `CONTRIBUTING.md` and `SECURITY.md`

## Support and Releases

- Distribution strategy: `docs/project/distribution-strategy.md`
- Compatibility matrix: `docs/project/compatibility-matrix.md`
- Release checklist: `docs/project/release-checklist.md`
- npm publishing setup: `docs/project/npm-publishing.md`
- GitHub Releases are the canonical release notes and version record
- The `version` field in `package.json` inside git is not the release source of truth

## Installation

```bash
npm install
npm run build
npm run setup
```

## Use In Codex

This repo includes a repo-scoped Codex plugin so a cloned checkout can install the MCP without any extra packaging or hosted infrastructure.

The packaged CLI surface is also prepared for a future public install path. Once npm publishing is enabled, AI agents will be able to run the server with `npx -y @havesomecode/kibana-mcp-server` instead of cloning the repo first.

### Quick path

1. Clone the repository.
2. Make sure Node.js 22+ is available.
   - if it is missing, ask Codex to use the plugin skill `ensure-node-runtime`
   - the repo pins Node major `22` in `.node-version`
3. From the repo root, run:

```bash
npm install
npm run build
npm run setup
```

4. Open the cloned repo in Codex.
5. Open the plugin directory in Codex and install `Kibana Log Investigation` from the repo marketplace.
   - if the current model cannot complete that install itself, do the Codex UI click manually and let the agent continue with configuration afterward
6. Restart Codex if the new MCP server does not appear immediately.
7. Run guided setup once:
   - `npm run setup`
   - provide the environment name, Kibana base URL, username, password, and a source catalog file to import
   - use the bundled `config/sources.example.json` unless you already have a better catalog JSON
8. Let later threads reuse the saved default profile automatically.
   - if you add more than one environment during setup, select non-default ones with `KIBANA_PROFILE=<PROFILE_NAME>`

Repo-scoped plugin files:

- `.agents/plugins/marketplace.json`
- `plugins/kibana-log-investigation/.codex-plugin/plugin.json`
- `plugins/kibana-log-investigation/.mcp.json`

### Minimal handoff prompt

If you are handing only the repo link to another Codex agent, this usually works:

```text
Clone this repo, ensure Node.js 22+ is installed at user level for the current OS, run npm install, npm run build, and npm run setup, install the repo plugin named "Kibana Log Investigation", import a source catalog during setup, and verify discover plus one query work in Codex without needing a later manual configure step.
```

## Configuration

The preferred path is guided machine setup:

- `npm run setup` or `node dist/src/index.js setup`
- saves non-secret profile metadata in the user’s machine-level app config directory
- saves credentials in the platform credential store
  - macOS Keychain
  - Windows Credential Manager
  - Linux Secret Service when available
- imports the selected source catalog into machine-local state so later threads do not depend on the repo checkout

The server also supports two advanced compatibility paths:

- bootstrap at process start through environment variables plus a JSON source catalog
- runtime from your MCP client through the `configure` tool

When `configure` is called, the source catalog is still persisted to disk so restarts do not wipe the logical source setup.

### Machine profiles

After guided setup, the default saved profile loads automatically on startup.

If you saved more than one environment, select a non-default profile with:

- `KIBANA_PROFILE=<PROFILE_NAME>`

Example:

```bash
KIBANA_PROFILE=staging npm run dev
```

### Bootstrap configuration

The server can still read connection details from environment variables and source definitions from a JSON file.

Environment variables:

- `KIBANA_BASE_URL`
- `KIBANA_USERNAME`
- `KIBANA_PASSWORD`
- `KIBANA_PROFILE` optional, selects a saved non-default machine profile
- `KIBANA_TIMEOUT_MS` optional, default `10000`
- `KIBANA_SOURCE_CATALOG_PATH` optional, default `config/sources.runtime.json`

`KIBANA_BASE_URL` is the Kibana base prefix that the server joins with each configured backend or schema path.

Use:

- `https://kibana.example.com`
- `https://gateway.example.com/logs` when Kibana is reverse-proxied under `/logs`

Do not use:

- `https://kibana.example.com/internal/search/es`
- `https://gateway.example.com/logs/internal/search/es`

The source definition already carries endpoint paths such as `/internal/search/es`, so including a full API path in `KIBANA_BASE_URL` usually produces a bad combined URL and a `404`.

For the env-bootstrap path, start from `config/sources.example.json` and copy it to `config/sources.json`.
If no explicit `KIBANA_SOURCE_CATALOG_PATH` is set, env bootstrap will try `config/sources.runtime.json` first and then fall back to `config/sources.json`.

### Multiple environments

The recommended path is to save multiple machine profiles during setup.

Then:

- the default profile loads automatically
- extra MCP entries can select another saved environment with `KIBANA_PROFILE`
- you do not need to redefine `KIBANA_BASE_URL`, credentials, or source-catalog paths per thread

Example:

```bash
KIBANA_PROFILE=staging npm run dev
KIBANA_PROFILE=prod npm run dev
```

If you still prefer env-bootstrap entries, keep these distinct per environment:

- `KIBANA_BASE_URL`
- `KIBANA_USERNAME`
- `KIBANA_PASSWORD`
- `KIBANA_SOURCE_CATALOG_PATH`

Using separate source-catalog paths matters because the `configure` tool persists sources to disk, and one shared runtime file would cause the environments to overwrite each other.

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

## Running

```bash
KIBANA_BASE_URL=https://kibana.example.com \
KIBANA_USERNAME=elastic \
KIBANA_PASSWORD=secret \
KIBANA_SOURCE_CATALOG_PATH=config/sources.json \
npm run dev
```

Or, after guided setup:

```bash
npm run dev
```

## Tool Shapes

### `configure`

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

### `discover`

Input:

```json
{
  "query": "application",
  "limit": 10
}
```

Output includes:

- source id
- source name
- time field
- tags
- configured field hints

### `describe_fields`

Use `describe_fields` when the agent needs to know whether a field is safe for exact term matching, grouping, or sorting.
If the source does not configure a schema backend, `describe_fields` fails clearly instead of guessing.
When direct schema endpoints are unavailable, the server will infer fields from sample hits via the configured search backend.

Input:

```json
{
  "source_id": "workflow_metrics",
  "query": "event",
  "limit": 50
}
```

Output includes:

- field name
- field type
- `searchable`
- `aggregatable`
- available subfields
- `preferred_exact_field` when a safer exact-match variant exists, such as `.keyword`

### `query`

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

### `filter`

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

## Development

```bash
npm run lint
npm run format:check
npm run check:types
npm test
npm run verify
```
