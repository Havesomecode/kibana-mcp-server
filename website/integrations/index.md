# Integration examples

These pages show complete, copyable setups for running the server as a shared service.

| Example | What it shows |
| --- | --- |
| [Behind an MCP gateway](./gateway) | The contract any gateway or reverse proxy must fulfil: authenticate the caller, forward its identity in a header. |
| [Ts.ED gateway](./tsed) | A concrete gateway built with Ts.ED, protected by OIDC, forwarding the token subject as the profile. |
| [Docker image](./docker) | A container image that runs the server over HTTP with a catalog store. |

All three rely on the [HTTP transport](../deployment/http) and on [catalog stores](../deployment/catalog-stores).
