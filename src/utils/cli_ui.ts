import { log } from "@clack/prompts";

import type { CliIo } from "./cli_io.js";

export interface CliUi {
  success: (message: string) => void;
  error: (message: string) => void;
}

export function createCliUi(io: CliIo): CliUi {
  return {
    success(message: string) {
      if (io.isStdoutOverridden) {
        io.stdout(message);
        return;
      }
      log.success(message, { output: io.stdoutStream });
    },
    error(message: string) {
      if (io.isStdoutOverridden) {
        io.stderr(message);
        return;
      }
      log.error(message, { output: io.stdoutStream });
    },
  };
}
