import type { runBootstrap } from "../bootstrap.js";
import type { startMcpServer } from "../mcp_runtime.js";
import type { SetupFlowResult, SetupPrompter } from "../setup_flow.js";
import type { CliIo } from "../utils/cli_io.js";

export interface CliCommandContext {
  io: CliIo;
  dependencies: {
    startMcpServerFn?: typeof startMcpServer;
    runSetupFlowFn?: (prompter: SetupPrompter) => Promise<SetupFlowResult>;
    runBootstrapFn?: typeof runBootstrap;
  };
  setExitCode: (code: number) => void;
}
