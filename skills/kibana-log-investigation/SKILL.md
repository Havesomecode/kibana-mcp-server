---
name: kibana-log-investigation
description: Bootstrap and use the Kibana log investigation MCP safely.
---

# Kibana Log Investigation

Use this skill when an operator wants to install, configure, or use the read-only Kibana MCP server from `@havesomecode/kibana-mcp-server`.

## Connection-only installation

Do not edit Codex or MCP configuration files by hand. Bootstrap establishes only the Kibana connection and an empty managed source catalog. It must not list, scan, infer, or configure indexes.

1. Verify Node.js 22 or newer is available.
2. Resolve connection values from `KIBANA_BASE_URL`, `KIBANA_USERNAME`, and `KIBANA_PASSWORD`, unless the operator supplied safe alternatives.
3. Run the prompt-free bootstrap:

```bash
npx -y @havesomecode/kibana-mcp-server bootstrap \
  --client codex
```

Bootstrap must:

- validate the Kibana base URL and verify the connection through Kibana status only
- write an empty managed catalog on first install
- preserve previously and explicitly configured generated sources on idempotent reruns
- save credentials in the operating-system credential store
- register the exact, version-pinned stdio command under a transport-hashed Codex name
- read the Codex registration back and reject conflicting entries
- restore prior profile state if registration fails

A successful command verifies installation, not an index. Do not claim an index is usable until the explicit configuration flow below succeeds.

## Supplying secrets safely

Never put a password directly in a command argument. Prefer a pre-provisioned `KIBANA_PASSWORD` environment variable. When a secret is available on stdin, use:

```bash
printf '%s\n' "$SECRET_VALUE" | npx -y @havesomecode/kibana-mcp-server bootstrap \
  --password-stdin \
  --client codex
```

If the password is stored under another environment variable, reference its name without exposing its value:

```bash
npx -y @havesomecode/kibana-mcp-server bootstrap \
  --password-env KIBANA_PROD_PASSWORD \
  --client codex
```

## Explicit index configuration

After bootstrap:

1. Call `discover`.
2. If no source is configured, ask the user which exact Kibana index or index pattern they want to use.
3. Wait for the user's answer. Never guess, enumerate, scan, or auto-select an index.
4. Call `configure_index` exactly once with the user's value in `index`.
5. Report the configured `source_id` and time field. If validation fails, preserve the empty catalog and report the error.
6. Call `discover` again before beginning an investigation.

`configure_index` contains no credential fields. It may inspect fields and perform one bounded validation search only for the exact user-approved index or pattern.

## Profiles and overrides

| Value | Flag | Environment fallback |
|---|---|---|
| Profile | `--profile prod` | `KIBANA_PROFILE`, then `default` |
| Base URL | `--url https://kibana.example.com` | `KIBANA_BASE_URL` |
| Username | `--username elastic` | `KIBANA_USERNAME` |
| Password | `--password-stdin` or `--password-env NAME` | `KIBANA_PASSWORD` |
| Client | `--client codex` or `--client none` | `codex` |

To select an existing non-default profile:

```bash
npx -y @havesomecode/kibana-mcp-server serve --profile prod
```

## Failure rules

- Never silently import the bundled example catalog.
- Never pass an index to bootstrap; bootstrap is connection-only.
- Never call `configure_index` until the user explicitly names the index or pattern.
- Never add `--replace` merely to make a failed install pass. It intentionally replaces an existing catalog with an empty managed catalog.
- Never overwrite a conflicting MCP client registration.
- Never expose a password in logs, summaries, shell history, generated catalogs, or MCP client configuration.
- If URL, username, or password is unavailable, report the exact missing prerequisite rather than inventing it.

## Using the MCP

After a source is explicitly configured:

1. Use `discover` to obtain the source id.
2. Use field description before constructing unfamiliar filters or aggregations.
3. Start with a bounded time range and a small result limit.
4. Keep investigations read-only and cite returned evidence rather than inferring unseen log content.
