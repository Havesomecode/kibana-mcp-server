---
description: "Complete setups for running Kibana MCP Server as a shared service."
---

# Integration examples

Choose a shared-service setup:

| Example | What it shows |
| --- | --- |
| [Behind an MCP gateway](./gateway) | Authenticate callers, overwrite the profile header with verified identity, send the shared secret. |
| [Ts.ED gateway](./tsed) | Use OIDC and the verified token subject as the profile. |
| [Docker image](./docker) | Run HTTP with a persistent catalog store. |

All use [HTTP transport](../deployment/http) and [catalog stores](../deployment/catalog-stores).
