import type { runBootstrap } from "../setup/bootstrap.js";
import type { SetupFlowResult, SetupPrompter } from "../setup/setup_flow.js";
import type { startHttpMcpServer } from "../transports/http.js";
import type { startMcpServer } from "../transports/stdio.js";
import type { CliIo } from "../utils/cli_io.js";
import type { CliUi } from "../utils/cli_ui.js";

export interface CliCommandContext {
  argv: string[];
  io: CliIo;
  ui: CliUi;
  dependencies: {
    startMcpServerFn?: typeof startMcpServer;
    startHttpMcpServerFn?: typeof startHttpMcpServer;
    runSetupFlowFn?: (prompter: SetupPrompter) => Promise<SetupFlowResult>;
    runBootstrapFn?: typeof runBootstrap;
  };
  setExitCode: (code: number) => void;
}
