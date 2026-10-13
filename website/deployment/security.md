---
description: "What the HTTP transport trusts, the safeguards built in and how credentials are handled."
---

# Security model

## What the server trusts

Over HTTP the server authenticates **the gateway**, not the end user.

| Element | Role | Trusted because |
| --- | --- | --- |
| `Authorization: Bearer <token>` | Proves the request comes from your gateway | It matches `KIBANA_HTTP_AUTH_TOKEN` |
| Profile header | Names the caller | The gateway set it after authenticating the caller |

The profile header is taken as sent. Anyone who can reach the port and knows the shared secret can act as any profile. Two consequences:

- **Only the gateway should reach the server.** Bind it to the loopback interface or a private network.
- **The gateway must overwrite the profile header**, never forward a client-supplied value.

## Safeguards built in

- **No public listening without a secret.** The server refuses to start on a non-loopback host unless `KIBANA_HTTP_AUTH_TOKEN` is set.
- **No accidental shared catalog.** Over HTTP, the server refuses to start with neither a profile header nor an explicitly named default profile.
- **A missing profile is refused.** With a profile header configured, a request without it gets `401`.
- **Profile names never reach a path or key as is.** They are turned into a key of lowercase letters, digits and dashes; anything else gets a digest suffix. `../../etc/passwd` becomes `etc-passwd-<digest>`.
- **Profiles are compared exactly.** `Alice` and `alice` are two profiles with two catalogs.
- **The legacy `configure` tool is not exposed over HTTP.** It accepts credentials as tool input and would replace the connection for everyone.

## Kibana credentials

- With saved profiles, credentials live in the secret store of the operating system: macOS Keychain, Windows Credential Manager, or the Secret Service on Linux.
- With environment variables or a configuration file, they live wherever you put them. Read them from the environment in the configuration file rather than writing them in it.
- Prefer environment variables over command-line flags for secrets: arguments are visible to other users of the machine.

## What a caller can do

Every caller of a shared server queries Kibana with the same service account, so they can all read what that account can read. A profile isolates the **catalog** of a caller, the sources it configured, not the underlying data. Scope the service account to the indexes you are willing to expose, and protect the gateway endpoint with a scope reserved for the right audience.

`configure_index` lets a caller add any index pattern the service account can read to its own catalog. If that is too broad, exclude the tool at the gateway and manage catalogs yourself.

## Read-only

The server issues search and field-metadata requests only. It never writes to Elasticsearch or Kibana.

## Reporting a vulnerability

See `SECURITY.md` in the repository.
