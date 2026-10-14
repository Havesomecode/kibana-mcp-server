import type { Command } from "commander";

import { runSetupFlow } from "../setup/setup_flow.js";
import { PromptCancelledError, createPromptIo } from "../utils/cli_prompts.js";
import { type BootstrapOptions, addBootstrapOptions, runBootstrapCommand } from "./bootstrap.js";
import type { CliCommandContext } from "./context.js";

export default function registerSetup(program: Command, context: CliCommandContext): void {
  addBootstrapOptions(
    program
      .command("setup")
      .description("Run guided setup, or connection-only bootstrap with options")
      .addHelpText(
        "after",
        "\nWithout connection options, setup is guided even when connection environment values exist. With any connection option, setup uses bootstrap: it does not inspect or configure indexes and prompts only for missing connection values.",
      ),
  ).action(async (options: BootstrapOptions, command: Command) => {
    if (
      command.options.some(
        (option) => command.getOptionValueSource(option.attributeName()) === "cli",
      )
    ) {
      return runBootstrapCommand(options, context);
    }
    const promptIo = await createPromptIo(context.io);
    try {
      const result = await (context.dependencies.runSetupFlowFn ?? runSetupFlow)(promptIo);
      context.ui.success(
        `Saved ${result.profiles.length} environment${result.profiles.length === 1 ? "" : "s"}. Default environment: ${result.defaultProfileName}.`,
      );
    } catch (error) {
      if (error instanceof PromptCancelledError) context.setExitCode(130);
      else throw error;
    } finally {
      await promptIo.close();
    }
  });
}
