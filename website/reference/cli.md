---
description: "Commands and options of the kibana-mcp-server command line: serve, bootstrap and setup."
---

# Command line

```bash
npx -y @havesomecode/kibana-mcp-server <command>
```

Without a command, the server starts over stdio.

## `serve`

Starts the MCP server, over stdio by default.

| Option | Description |
| --- | --- |
| `--profile <name>` | Profile to serve. Same as `KIBANA_PROFILE`. |
| `--config <path>` | [Configuration file](./config-file). Same as `KIBANA_MCP_CONFIG`. |
| `--http` | Serve over Streamable HTTP instead of stdio |
| `--host <host>` | HTTP listen host, default `127.0.0.1` |
| `--port <port>` | HTTP listen port, default `3000` |
| `--path <path>` | HTTP endpoint path, default `/mcp` |
| `--profile-header <name>` | HTTP header carrying the profile of the caller |

`--host`, `--port`, `--path` and `--profile-header` require `--http`. The shared secret has no flag on purpose: set `KIBANA_HTTP_AUTH_TOKEN`.

## `bootstrap`

Verifies the Kibana connection, creates an empty managed catalog, saves the credentials and optionally registers the server with a client. It never inspects or configures indexes. Supply connection values through flags or `KIBANA_BASE_URL`, `KIBANA_USERNAME` and `KIBANA_PASSWORD` for prompt-free operation; otherwise it prompts only for missing connection values.

| Option | Description |
| --- | --- |
| `--profile <name>` | Saved profile name |
| `--url <url>` | Kibana base URL |
| `--username <name>` | Kibana basic-auth username |
| `--password-stdin` | Read the password from stdin |
| `--password-env <name>` | Read the password from an environment variable |
| `--timeout <milliseconds>` | Kibana request timeout |
| `--client <codex\|none>` | Client registration mode |
| `--package <specifier>` | Package specifier used for client registration |
| `--mcp-name <name>` | MCP registration name |
| `--replace` | Replace an existing catalog |
| `--no-default` | Do not make this profile the default |

## `setup`

Runs guided setup for explicitly selected hand-authored source catalogs. This is a separate command, not an alias for `bootstrap`, and accepts no bootstrap flags.
