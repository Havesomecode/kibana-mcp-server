---
description: "Source layout, the path of a tool call, the profile registry and catalog stores."
---

# Architecture

## Source layout

| Folder | Content |
| --- | --- |
| `src/bin/` | The executable and CLI wiring |
| `src/commands/` | One Commander command per file: `serve`, `setup`, `bootstrap` |
| `src/config/` | Environment parsing, configuration file loading, startup resolution |
| `src/kibana/` | Kibana client, schema and source catalogs |
| `src/profiles/` | Profile runtimes, saved profiles, secrets, state lock |
| `src/query/` | Query compilation, cursors, result normalization |
| `src/setup/` | Bootstrap, guided setup, client registration |
| `src/stores/` | The catalog store contract and its implementations |
| `src/tools/` | One MCP tool per file |
| `src/transports/` | stdio and HTTP transports |
| `src/server.ts` | Builds the MCP server and registers the tools |

## A tool call

1. The transport receives the request. Over HTTP it validates the shared secret and reads the profile header.
2. `createApplication` builds an MCP server. Over HTTP there is one per request; state lives outside it.
3. The tool handler asks the **profile registry** for the runtime of the profile. A runtime holds the configuration, the source catalog, the Kibana client and the schema cache.
4. The runtime is bound to the call through `AsyncLocalStorage`, so deeper code reads it without receiving it as an argument.
5. The tool runs against that runtime only.

## Profile registry

- Runtimes are created on demand and cached, with a least-recently-used limit.
- Profiles sharing a Kibana connection share one client, hence one concurrency budget.
- A store-backed catalog is read again on every call. The parsed catalog and the schema cache are kept while its content is unchanged.

## Catalog stores

Every catalog write goes through one contract: read the content, compute the next one, replace it only if it is unchanged. Files, Redis, PostgreSQL, MongoDB and SQLite all implement it. See [Custom store](../deployment/stores/custom).

## Startup modes

| Configuration | Result |
| --- | --- |
| Connection plus a store, or `{profile}` in the catalog path | One connection, one catalog per profile |
| Connection plus a plain catalog path | One connection, one catalog |
| Saved profiles | One connection and one catalog per saved profile |
| Connection without a catalog path or store | Startup fails; an explicit catalog is required |
| Nothing | Startup fails: `No saved Kibana connection is available. Run connection bootstrap first.` |
