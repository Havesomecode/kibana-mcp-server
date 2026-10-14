---
description: "Reference of the describe_fields tool: inspect the effective fields of a source."
---

# `describe_fields`

Inspect one source's effective fields for safe exact matching, grouping or sorting.

Requires a configured schema backend; missing configuration fails clearly, not by guessing. When direct schema endpoints are unavailable, fields are inferred from sample hits through the configured search backend.

Input:

```json
{
  "source_id": "workflow_metrics",
  "query": "event",
  "limit": 50
}
```

Output includes:

- field name
- field type
- `searchable`
- `aggregatable`
- available subfields
- `preferred_exact_field` when a safer exact-match variant exists, such as `.keyword`
