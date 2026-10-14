# Handoff

## Goal

Original design handoff: a minimal MCP for agents investigating runtime logs without direct Kibana access. Its scope was operational validation and incidents, not a specific business case. This is the initial design, not the current tool inventory.

## Minimum toolset

The proposed first version exposed `discover` and `query`; more tools were deferred until that model proved insufficient.

## `discover`

The design required source listing and keyword search so agents could select sources before querying. Each result included a source id, human-readable name, time field, and short description when available.

Short service, domain, event, or environment keywords were the intended inputs.

## `query`

The design required repeatable queries with:

| Input | Requirement |
| --- | --- |
| Sources | One or more source ids from `discover` |
| Time | Absolute start/end timestamps |
| Filters | Exact-match fields and free-text keywords |
| Ordering and size | Explicit sort order, time sorting, explicit limits |
| Output | Matching raw documents, clear hits without wrapper noise |

Count-only queries, simple aggregations, and grouped counts over time were optional if easy to add within the same tool—not first-version requirements.

## Intended investigation workflow

1. Find logs around a timestamp, rough keyword, or functional area.
2. Correlate execution logs with API/application behavior across sources in the same window.
3. Start broad, find candidate events, narrow the range, then inspect the exact execution span.
4. Extract timestamps, identifiers, event names, relevant fields, and durations/timing fields when present.
5. Compare log activity and request behavior before, during, and after the event.

## Success criteria

Success meant finding the right sources, querying precise ranges, correlating activity, and turning concrete runtime evidence into a compact validation or incident report.

## Non-goals

Dashboard management, visualization edits, saved-object mutations, administration, and business-specific workflow modeling were excluded. The goal was a focused agent query surface, not full Kibana management.
