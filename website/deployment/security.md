---
description: "What the HTTP transport trusts, the safeguards built in and how credentials are handled."
---

# Security model

Restrict HTTP access to an authenticated gateway. Bind to loopback or a private network; **overwrite the profile header** at the gateway, never forward a client-supplied value.

## Gateway trust

Over HTTP the server authenticates **the gateway**, not the end user.

| Element | Role | Trusted because |
| --- | --- | --- |
| `Authorization: Bearer <token>` | Proves the request comes from your gateway | It matches `KIBANA_HTTP_AUTH_TOKEN` |
| Profile header | Names the caller | The gateway set it after authenticating the caller |

The header is trusted as sent. Anyone with port access and the shared secret can act as **any profile**.

## Safeguards built in

- Non-loopback listening requires `KIBANA_HTTP_AUTH_TOKEN`.
- HTTP startup requires a profile header or explicitly named default profile. With a configured header, requests missing it get `401`.
- Profile path/key values contain lowercase letters, digits and dashes; other names get a digest suffix. `../../etc/passwd` becomes `etc-passwd-<digest>`.
- Profile names are exact: `Alice` and `alice` have separate catalogs.
- **MCP tools never accept connection credentials.** Supply saved platform credentials or explicit environment/configuration values at startup. `configure_index` changes only the caller’s managed source catalog.

## Kibana credentials

- Saved profiles use macOS Keychain, Windows Credential Manager or Linux Secret Service.
- Environment/configuration credentials live wherever you put them. In configuration files, read secrets from the environment; do not hard-code them.
- Prefer environment variables to secret flags: other machine users can see arguments.

## What a caller can do

Scope the shared service account to indexes you will expose. All shared-server callers can read what it can read: profiles isolate **catalogs**, not underlying data. Protect the gateway endpoint with a scope reserved for the intended audience.

`configure_index` can add any index pattern the service account can read to the caller's catalog. If too broad, exclude it at the gateway and manage catalogs yourself.

## Read-only

The server sends only search and field-metadata requests; it never writes to Elasticsearch or Kibana.

## Reporting a vulnerability

See `SECURITY.md` in the repository.
