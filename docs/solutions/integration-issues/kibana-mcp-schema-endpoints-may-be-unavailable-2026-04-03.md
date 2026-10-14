---
title: Kibana schema metadata endpoints may be unavailable behind a proxy
date: 2026-04-03
category: integration-issues
module: kibana-mcp-server
problem_type: integration_issue
component: tooling
symptoms:
  - `describe_fields` returned `404 Not Found` for `kibana_data_views_fields`
  - `describe_fields` returned `404 Not Found` for `kibana_index_patterns_fields`
  - `describe_fields` returned `404 Not Found` for `elasticsearch_field_caps`
  - nested queries stayed blocked because schema metadata could not be loaded
root_cause: environment_mismatch
resolution_type: guidance
severity: medium
tags: [mcp, kibana, schema, proxy, 404]
---

# Kibana schema metadata endpoints may be unavailable behind a proxy

## Problem

The Kibana MCP can expose schema-aware features only when the configured source has a working schema backend. In some deployments, all supported schema backend kinds return `404`, which makes `describe_fields` unusable and blocks schema-dependent query validation.

## Observed Attempts

Live checks were run against a proxied Kibana deployment and a structured log source:

- `kibana_data_views_fields` with `/api/data_views/fields_for_wildcard`
- `kibana_index_patterns_fields` with `/api/index_patterns/_fields_for_wildcard`
- `elasticsearch_field_caps` with `/<index>/_field_caps`

All three returned `404 Not Found`.

## What Works

The search backend itself still works through Kibana internal search:

- `backend.kind = kibana_internal_search_es`
- `backend.path = /internal/search/es`

So source discovery and log querying remain usable even when schema metadata is absent.

## Recommended Guidance

For deployments with this shape:

- configure the appropriate supported schema backend; Kibana data-view and index-pattern backends try their known metadata endpoints
- for a Kibana data-view or index-pattern schema backend, if all known metadata endpoints return `404`, the server falls back to sampling fields through the configured search backend; direct `elasticsearch_field_caps` errors do not use that fallback
- treat sampled capabilities as heuristic, not authoritative; they can recover `.keyword` promotion and object paths, but cannot prove nested mappings
- if schema loading and sampling both fail, use configured field hints and non-schema-dependent `discover`, `filter`, and `query` operations

## Verification Checklist

Before re-enabling schema-dependent behavior in a deployment, confirm one of the following works end to end:

- Kibana data views field metadata endpoint
- Kibana legacy index patterns field metadata endpoint
- direct Elasticsearch field capabilities endpoint

If none respond, select a Kibana data-view or index-pattern schema backend and verify its search-backend sampling fallback. Inspect the returned field capabilities and query advisories; the response does not expose a sampling-provenance field. Do not equate sampled fields with authoritative mapping metadata.
