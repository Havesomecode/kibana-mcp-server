import type { Command } from "commander";

import { runSetupFlow } from "../setup/setup_flow.js";
import { PromptCancelledError, createPromptIo } from "../utils/cli_prompts.js";
import type { CliCommandContext } from "./context.js";

export default function registerSetup(program: Command, context: CliCommandContext): void {
  program
    .command("setup")
    .description("Run guided catalog and profile setup")
    .action(async () => {
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
