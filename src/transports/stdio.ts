import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";

import { DEFAULT_PROFILE_NAME, loadStartupConfiguration } from "../config/startup.js";
import { createApplication } from "../server.js";

export async function startMcpServer(envInput: NodeJS.ProcessEnv = process.env): Promise<void> {
  // stdio serves one global configuration: the default profile, or the legacy 'configure' flow.
  // It has a single caller, so per-profile catalogs fall back to one well-known profile.
  const { startupConfiguration } = await loadStartupConfiguration(envInput);
  const defaultConfig =
    startupConfiguration.defaultConfig ??
    (await startupConfiguration.loadProfileConfig?.(DEFAULT_PROFILE_NAME));
  const { server } = createApplication(defaultConfig);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
