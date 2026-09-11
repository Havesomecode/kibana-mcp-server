import type { Command } from "commander";
import { PROFILE_NAME_ENV } from "../config.js";
import { startMcpServer } from "../mcp_runtime.js";
import type { CliCommandContext } from "./context.js";

export default (program: Command, context: CliCommandContext): void => {
  program
    .command("serve")
    .description("Start the stdio MCP server")
    .option("--profile <name>", "Saved profile name")
    .action(async (options: { profile?: string }) => {
      try {
        await (context.dependencies.startMcpServerFn ?? startMcpServer)(
          options.profile
            ? { ...context.io.env, [PROFILE_NAME_ENV]: options.profile }
            : context.io.env,
        );
      } catch (error) {
        context.ui.error(error instanceof Error ? error.message : String(error));
        context.setExitCode(1);
      }
    });
};
