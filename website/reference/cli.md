---
description: "Commands and options of the kibana-mcp-server command line: serve, bootstrap and setup."
---

# Command line

```bash
npx -y @havesomecode/kibana-mcp-server <command>
```

Without a command, the server starts over stdio.

## `serve`

Start the MCP server; stdio is the default.

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

Bootstrap the connection only, even without options: verify Kibana, create an empty managed catalog, save credentials and optionally register a client. **Never inspects or configures indexes.**

Supply flags or `KIBANA_BASE_URL`, `KIBANA_USERNAME` and `KIBANA_PASSWORD` for prompt-free operation; otherwise only missing connection values are prompted.

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

Choose the setup flow:

- **Bare `setup`:** guided setup for explicitly selected hand-authored catalogs, even with connection environment variables set.
- **Any explicit option from the `bootstrap` table:** connection-only bootstrap, with the same options. Prompts only for missing connection values; never inspects or configures indexes.

```bash
npx -y @havesomecode/kibana-mcp-server setup --profile prod --client none
```

## Connection-option rules

- Flags override environment fallbacks.
- Passwords: stdin, environment variable or secret prompt only; never a password argument.
- `--password-stdin` and `--password-env` are mutually exclusive.
- `--timeout` must be an integer from 1 to 120000 milliseconds.
