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

Schema-aware features need a working schema backend. Some deployments return `404` for every supported kind, blocking `describe_fields` and schema-dependent query validation.

## Observed Attempts

Live checks against one proxied Kibana deployment and structured log source returned:

| Backend | Path | Result |
| --- | --- | --- |
| `kibana_data_views_fields` | `/api/data_views/fields_for_wildcard` | `404 Not Found` |
| `kibana_index_patterns_fields` | `/api/index_patterns/_fields_for_wildcard` | `404 Not Found` |
| `elasticsearch_field_caps` | `/<index>/_field_caps` | `404 Not Found` |

## What Works

In that deployment, `backend.kind = kibana_internal_search_es` with `backend.path = /internal/search/es` still supported source discovery and log queries without schema metadata.

## Recommended Guidance

1. Configure a supported schema backend. Kibana data-view and index-pattern backends try their known metadata endpoints.
2. If all those endpoints return `404`, use their configured-search-backend sampling fallback. Direct `elasticsearch_field_caps` errors never use it.
3. Treat sampled capabilities as heuristic: they can recover `.keyword` promotion and object paths, but cannot prove nested mappings.
4. If metadata and sampling both fail, use configured field hints and non-schema-dependent `discover`, `filter`, and `query` operations.

## Verification Checklist

1. Before re-enabling schema-dependent behavior, verify an end-to-end metadata path: Kibana data views, legacy index patterns, or direct Elasticsearch field capabilities.
2. If none respond, select a Kibana data-view/index-pattern backend and verify sampling through its search backend.
3. Inspect field capabilities and query advisories. Responses expose no sampling-provenance field; sampled fields are not authoritative mappings.
