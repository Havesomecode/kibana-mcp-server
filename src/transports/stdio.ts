import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";

import { DEFAULT_PROFILE_NAME, loadStartupConfiguration } from "../config/startup.js";
import { createApplication } from "../server.js";

export async function startMcpServer(envInput: NodeJS.ProcessEnv = process.env): Promise<void> {
  // stdio has one caller and serves the configured default profile.
  const { startupConfiguration } = await loadStartupConfiguration(envInput);
  let server: ReturnType<typeof createApplication>["server"] | undefined;
  let closing: Promise<void> | undefined;
  const close = () => {
    closing ??= Promise.resolve().then(async () => {
      process.stdin.off("end", onClose);
      process.stdin.off("close", onClose);
      try {
        await server?.close();
      } finally {
        await startupConfiguration.close();
      }
    });
    return closing;
  };
  const onClose = () => {
    void close().catch(() => {
      process.stderr.write("Failed to close the MCP server or its catalog store.\n");
      process.exitCode = 1;
    });
  };

  try {
    const defaultConfig =
      startupConfiguration.defaultConfig ??
      (await startupConfiguration.loadProfileConfig?.(DEFAULT_PROFILE_NAME));
    ({ server } = createApplication(defaultConfig));
    const transport = new StdioServerTransport();
    transport.onclose = onClose;
    // The SDK transport handles data/errors, but does not close itself on stdin EOF.
    process.stdin.once("end", onClose);
    process.stdin.once("close", onClose);
    await server.connect(transport);
    if (process.stdin.readableEnded || process.stdin.destroyed) await close();
  } catch (error) {
    await close().catch(() => {});
    throw error;
  }
}
