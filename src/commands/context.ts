import type { runBootstrap } from "../bootstrap.js";
import type { startMcpServer } from "../mcp_runtime.js";
import type { SetupFlowResult, SetupPrompter } from "../setup_flow.js";
import type { CliIo } from "../utils/cli_io.js";
import type { CliUi } from "../utils/cli_ui.js";

export interface CliCommandContext {
  io: CliIo;
  ui: CliUi;
  dependencies: {
    startMcpServerFn?: typeof startMcpServer;
    runSetupFlowFn?: (prompter: SetupPrompter) => Promise<SetupFlowResult>;
    runBootstrapFn?: typeof runBootstrap;
  };
  setExitCode: (code: number) => void;
}
