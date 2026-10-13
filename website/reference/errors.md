# Errors

## Kibana request errors

A tool call that fails while talking to Kibana returns an error result whose `_meta.kibana_request_error` carries diagnostic fields: `code`, `phase` (`queue`, `request` or `response`), `source_id`, `timeout_ms`, and `status` or `cause_code` when available.

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

Each Kibana connection allows eight concurrent requests and thirty-two queued ones. Beyond that, calls fail immediately with `KIBANA_OVERLOADED`. Profiles that share a connection share that budget.

## Catalog errors

| Message | Cause |
| --- | --- |
| `Source catalog '…' changed concurrently. Retry the operation.` | Another caller changed the catalog while `configure_index` was validating. Retry. |
| `configure_index can update only a managed generated catalog.` | The catalog was written or edited by hand. The server will not overwrite it. |
| `Source catalog '…' does not exist although sources are configured.` | The sources were loaded from another location, such as the static fallback catalog. |
| `Source id '…' already refers to a different index.` | Pass `replace: true` after the user approved the replacement. |

## HTTP transport

| Status | Cause |
| --- | --- |
| `401` | Missing or wrong bearer token, or missing profile header |
| `400` | Invalid profile header value |
| `404` | Unknown path |
| `413` | Request body larger than 4 MB |
