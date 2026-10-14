---
description: "Reference of the configure_index tool: configure one index or pattern as a logical source."
---

# `configure_index`

Configure **exactly the index or pattern explicitly named by the user**. Never guess, list or scan candidates; this tool accepts no credentials.

Input:

```json
{
  "index": "app-logs-*",
  "source_name": "Application logs"
}
```

The tool inspects fields, runs one bounded validation search for that index only, then persists the generated logical source in the managed catalog. Use optional `source_id`, `time_field` and `replace` for explicit collision or schema handling.
