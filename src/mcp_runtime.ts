import { StdioServerTransport } from "@modelcontextprotocol/server";

import { NoSavedProfileError, PROFILE_NAME_ENV, loadConfigFromEnvironment } from "./config.js";
import { createApplication } from "./server.js";

function hasBootstrapConfig(env: NodeJS.ProcessEnv): boolean {
  return Boolean(env.KIBANA_BASE_URL && env.KIBANA_USERNAME && env.KIBANA_PASSWORD);
}

export async function startMcpServer(envInput: NodeJS.ProcessEnv = process.env): Promise<void> {
  let config = undefined;
  try {
    config = await loadConfigFromEnvironment(envInput);
  } catch (error) {
    if (hasBootstrapConfig(envInput) || envInput[PROFILE_NAME_ENV]?.trim()) {
      throw error;
    }
    if (!(error instanceof NoSavedProfileError)) {
      throw error;
    }
  }

  const { server } = createApplication(config);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
