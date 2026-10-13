---
description: "Reference of the configure_index tool: configure one index or pattern as a logical source."
---

# `configure_index`

Configures exactly one index or index pattern as a logical source, after the user has named it.

Use this tool only after the user explicitly names the exact index or index pattern to configure. It accepts no credentials and never lists or scans for candidate indexes.

Input:

```json
{
  "index": "app-logs-*",
  "source_name": "Application logs"
}
```

The tool inspects fields and runs one bounded validation search only for that index. It then persists the generated source in the managed catalog. Optional `source_id`, `time_field`, and `replace` fields support explicit collision or schema handling.
