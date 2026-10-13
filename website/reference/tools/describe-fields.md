# `describe_fields`

Describes the effective fields of one source, including which ones support exact matching.

Use `describe_fields` when the agent needs to know whether a field is safe for exact term matching, grouping, or sorting.
If the source does not configure a schema backend, `describe_fields` fails clearly instead of guessing.
When direct schema endpoints are unavailable, the server will infer fields from sample hits via the configured search backend.

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
