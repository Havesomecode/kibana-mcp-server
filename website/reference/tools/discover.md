---
description: "Reference of the discover tool: list the logical sources of the current profile."
---

# `discover`

List the current profile's configured logical sources and field hints.

Input:

```json
{
  "query": "application",
  "limit": 10
}
```

Output includes:

- source id
- source name
- time field
- tags
- configured field hints
