#!/usr/bin/env node

import { pathToFileURL } from "node:url";
import { Command, CommanderError } from "commander";

import type { CliCommandContext } from "../commands/context.js";
import registerServeCommand from "../commands/serve.js";
import registerSetupCommands from "../commands/setup.js";
import { startMcpServer } from "../mcp_runtime.js";
import { type CliIo, createCliIo } from "../utils/cli_io.js";
import { createCliUi } from "../utils/cli_ui.js";

export type CliDependencies = CliCommandContext["dependencies"];

export async function runCli(
  argv: string[] = process.argv.slice(2),
  overrides: Partial<CliIo> = {},
  dependencies: CliDependencies = {},
): Promise<number> {
  const io = createCliIo(overrides);
  let exitCode = 0;
  const context: CliCommandContext = {
    io,
    ui: createCliUi(io),
    dependencies,
    setExitCode: (code) => {
      exitCode = code;
    },
  };
  const program = new Command()
    .name("kibana-mcp-server")
    .description("Kibana Log Investigation")
    .showHelpAfterError()
    .exitOverride()
    .configureOutput({
      writeOut: (message) => io.stdout(message.trimEnd()),
      writeErr: (message) => io.stderr(message.trimEnd()),
    })
    .action(async () => {
      try {
        await (dependencies.startMcpServerFn ?? startMcpServer)(io.env);
      } catch (error) {
        context.ui.error(error instanceof Error ? error.message : String(error));
        exitCode = 1;
      }
    });

  registerSetupCommands(program, context);
  registerServeCommand(program, context);

  try {
    await program.parseAsync(["node", "kibana-mcp-server", ...argv], { from: "node" });
  } catch (error) {
    if (error instanceof CommanderError) return error.exitCode;
    io.stderr(error instanceof Error ? error.message : String(error));
    return 1;
  }
  return exitCode;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await runCli();
}
