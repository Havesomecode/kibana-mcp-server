---
description: "Kibana request error codes, catalog errors and HTTP transport statuses."
---

# Errors

## Kibana request errors

Read `_meta.kibana_request_error` on failed Kibana tool calls: `code`, `phase` (`queue`, `request` or `response`), `source_id`, `timeout_ms`, plus `status` or `cause_code` when available.

| Code | Meaning |
| --- | --- |
| `KIBANA_TIMEOUT` | The call exceeded its backend deadline (`KIBANA_TIMEOUT_MS`) |
| `KIBANA_CANCELLED` | The MCP client cancelled the tool call |
| `KIBANA_OVERLOADED` | Too many requests are already running and queued for this connection |
| `KIBANA_AUTHENTICATION` | Kibana rejected the credentials |
| `KIBANA_HTTP` | Kibana answered with another error status |
| `KIBANA_RESPONSE` | The response could not be read or parsed |
| `KIBANA_DNS` | The host name could not be resolved |
| `KIBANA_TLS` | The TLS handshake failed |
| `KIBANA_CONNECTION` | The connection was refused or reset |
| `KIBANA_NETWORK` | Another network failure |

## Concurrency limits

Each Kibana connection allows eight concurrent requests and thirty-two queued; excess calls fail immediately with `KIBANA_OVERLOADED`. Profiles sharing a connection share its budget.

## Startup errors

| Message or condition | Action |
| --- | --- |
| `No saved Kibana connection is available. Run connection bootstrap first.` | Run connection-only `bootstrap --client codex` (or `--client none` for an already registered server), then reconnect the client. |
| `KIBANA_SOURCE_CATALOG_PATH is required for an environment connection.` | Name the catalog explicitly, declare a store, or unset the connection variables to use a saved profile. |
| `Incomplete Kibana bootstrap environment. Provide KIBANA_BASE_URL, KIBANA_USERNAME, and KIBANA_PASSWORD together.` | Supply all three together for direct startup, or unset them to use saved credentials. |

## Catalog errors

| Message | Cause |
| --- | --- |
| `Source catalog '…' changed concurrently. Retry the operation.` | Another caller changed the catalog while `configure_index` was validating. Retry. |
| `configure_index can update only a managed generated catalog.` | The catalog was written or edited by hand. The server will not overwrite it. |
| `Source catalog '…' does not exist although sources are configured.` | The loaded catalog was removed while the server was running. Restore the configured file before retrying. |
| `Source id '…' already refers to a different index.` | Pass `replace: true` after the user approved the replacement. |

## HTTP transport

| Status | Cause |
| --- | --- |
| `401` | Missing or wrong bearer token, or missing profile header |
| `400` | Invalid profile header value |
| `404` | Unknown path |
| `413` | Request body larger than 4 MB |
