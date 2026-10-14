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

Without connection options, runs guided setup for explicitly selected hand-authored source catalogs, even when connection environment variables are set.

With any explicitly supplied option from the `bootstrap` table above, `setup` uses the same connection-only bootstrap flow and options. It prompts only for missing connection values and never inspects or configures indexes. Flags override environment fallbacks; passwords are accepted only through stdin, an environment variable, or a secret prompt, never a password argument. `--password-stdin` and `--password-env` are mutually exclusive, and `--timeout` must be an integer from 1 to 120000 milliseconds.

```bash
npx -y @havesomecode/kibana-mcp-server setup --profile prod --client none
```

Bare `bootstrap` always remains connection-only; only bare `setup` starts guided catalog setup.
