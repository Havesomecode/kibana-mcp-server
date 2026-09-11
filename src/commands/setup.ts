import type { Command } from "commander";
import { PromptCancelledError, createPromptIo } from "../utils/cli_prompts.js";
import { runSetupFlow } from "../setup_flow.js";
import {
  type BootstrapCliOptions,
  addBootstrapOptions,
  hasCliOptions,
  runBootstrapCommand,
} from "./bootstrap.js";
import type { CliCommandContext } from "./context.js";

export default (program: Command, context: CliCommandContext): void => {
  addBootstrapOptions(
    program
      .command("setup")
      .description("Run guided machine setup")
      .addHelpText(
        "after",
        "\nWith options, setup is a compatible non-interactive alias for bootstrap.",
      ),
  ).action(async (options: BootstrapCliOptions, command: Command) => {
    if (hasCliOptions(command)) return runBootstrapCommand(options, context);
    const promptIo = await createPromptIo(context.io);
    try {
      const result = await (context.dependencies.runSetupFlowFn ?? runSetupFlow)(promptIo);
      context.io.stdout(
        `Saved ${result.profiles.length} environment${result.profiles.length === 1 ? "" : "s"}. Default environment: ${result.defaultProfileName}.`,
      );
    } catch (error) {
      if (error instanceof PromptCancelledError) context.setExitCode(130);
      else throw error;
    } finally {
      await promptIo.close();
    }
  });
};
