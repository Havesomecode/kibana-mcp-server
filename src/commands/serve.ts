import type { Command } from "commander";
import { CONFIG_FILE_ENV } from "../config/config_file.js";
import { PROFILE_NAME_ENV } from "../config/environment.js";
import { parsePort, startHttpMcpServer } from "../transports/http.js";
import { startMcpServer } from "../transports/stdio.js";
import type { CliCommandContext } from "./context.js";

interface ServeOptions {
  profile?: string;
  config?: string;
  http?: boolean;
  host?: string;
  port?: string;
  path?: string;
  profileHeader?: string;
}

export default (program: Command, context: CliCommandContext): void => {
  program
    .command("serve")
    .description("Start the MCP server over stdio, or over Streamable HTTP with --http")
    .option("--profile <name>", "Saved profile name")
    .option("--config <path>", "Configuration file, e.g. kibana.mcp.config.ts")
    .option("--http", "Serve over Streamable HTTP instead of stdio")
    .option("--host <host>", "HTTP listen host (default 127.0.0.1)")
    .option("--port <port>", "HTTP listen port (default 3000)")
    .option("--path <path>", "HTTP endpoint path (default /mcp)")
    .option("--profile-header <name>", "HTTP header carrying the caller's profile")
    .action(async (options: ServeOptions) => {
      try {
        const env = {
          ...context.io.env,
          ...(options.profile ? { [PROFILE_NAME_ENV]: options.profile } : {}),
          ...(options.config ? { [CONFIG_FILE_ENV]: options.config } : {}),
        };
        if (!options.http) {
          if (options.host || options.port || options.path || options.profileHeader) {
            throw new Error("--host, --port, --path and --profile-header require --http.");
          }
          await (context.dependencies.startMcpServerFn ?? startMcpServer)(env);
          return;
        }

        const { url } = await (context.dependencies.startHttpMcpServerFn ?? startHttpMcpServer)(
          env,
          {
            host: options.host,
            port: parsePort(options.port),
            path: options.path,
            profileHeader: options.profileHeader,
          },
        );
        context.ui.success(`MCP server listening on ${url}`);
      } catch (error) {
        context.ui.error(error instanceof Error ? error.message : String(error));
        context.setExitCode(1);
      }
    });
};
