import { createInterface } from "node:readline/promises";
import { type Readable, Writable } from "node:stream";
import type { ReadStream } from "node:tty";

import { startMcpServer } from "./mcp_runtime.js";
import type { SetupFlowResult, SetupPrompter } from "./setup_flow.js";
import { runSetupFlow } from "./setup_flow.js";

function renderHelp(): string {
  return [
    "Kibana Log Investigation",
    "",
    "Usage:",
    "  kibana-mcp-server [command]",
    "",
    "Commands:",
    "  setup    Run guided machine setup",
    "  serve    Start the stdio MCP server",
    "  help     Show this help output",
  ].join("\n");
}

export async function runCli(
  argv: string[] = process.argv.slice(2),
  io: {
    stdout?: (text: string) => void;
    stderr?: (text: string) => void;
    stdin?: Readable;
    stdoutStream?: NodeJS.WriteStream;
    stdinIsTTY?: boolean;
  } = {},
  dependencies: {
    startMcpServerFn?: typeof startMcpServer;
    runSetupFlowFn?: (prompter: SetupPrompter) => Promise<SetupFlowResult>;
  } = {},
): Promise<number> {
  const stdout = io.stdout ?? ((text: string) => process.stdout.write(`${text}\n`));
  const stderr = io.stderr ?? ((text: string) => process.stderr.write(`${text}\n`));
  const stdin = io.stdin ?? process.stdin;
  const stdoutStream = io.stdoutStream ?? process.stdout;
  const [command, ...rest] = argv;

  switch (command) {
    case undefined:
    case "setup": {
      if (rest.length > 0) {
        stderr(`Unknown arguments for setup: ${rest.join(" ")}`);
        return 1;
      }

      const promptIo = await createPromptIo(stdout, {
        stdin,
        stdoutStream,
        stdinIsTTY: io.stdinIsTTY,
      });
      try {
        const result = await (dependencies.runSetupFlowFn ?? runSetupFlow)(promptIo);
        stdout(
          `Saved ${result.profiles.length} environment${result.profiles.length === 1 ? "" : "s"}. Default environment: ${result.defaultProfileName}.`,
        );
        return 0;
      } finally {
        await promptIo.close();
      }
    }
    case "help":
    case "--help":
    case "-h": {
      stdout(renderHelp());
      return 0;
    }
    case "serve": {
      if (rest.length > 0) {
        stderr(`Unknown arguments for serve: ${rest.join(" ")}`);
        return 1;
      }
      await (dependencies.startMcpServerFn ?? startMcpServer)();
      return 0;
    }
    default: {
      stderr(`Unknown command: ${command}`);
      stderr(renderHelp());
      return 1;
    }
  }
}

export interface PromptIo extends SetupPrompter {
  close(): Promise<void>;
}

export async function createPromptIo(
  stdout: (text: string) => void,
  options: {
    stdin?: Readable;
    stdoutStream?: NodeJS.WriteStream;
    stdinIsTTY?: boolean;
  } = {},
): Promise<PromptIo> {
  const stdin = options.stdin ?? process.stdin;
  const stdoutStream = options.stdoutStream ?? process.stdout;
  const stdinIsTTY = options.stdinIsTTY ?? Boolean((stdin as ReadStream).isTTY);

  if (!stdinIsTTY) {
    return createQueuedPromptIo(stdout, await readQueuedAnswers(stdin));
  }

  const maskingOutput = new MaskingWritable(stdoutStream);
  const readline = createInterface({
    input: stdin,
    output: maskingOutput,
  });

  return {
    info(message: string) {
      stdout(message);
    },
    async prompt(
      message: string,
      options: {
        defaultValue?: string;
        secret?: boolean;
      } = {},
    ): Promise<string> {
      const suffix = options.defaultValue ? ` [${options.defaultValue}]` : "";
      if (options.secret) {
        maskingOutput.muted = false;
        stdoutStream.write(`${message}: `);
        maskingOutput.muted = true;
        const answer = await readline.question("");
        maskingOutput.muted = false;
        stdoutStream.write("\n");
        return answer || options.defaultValue || "";
      }

      const answer = await readline.question(`${message}${suffix}: `);
      return answer || options.defaultValue || "";
    },
    async confirm(message: string, defaultValue = false): Promise<boolean> {
      const answer = await readline.question(`${message} ${defaultValue ? "[Y/n]" : "[y/N]"}: `);
      const normalized = answer.trim().toLowerCase();
      if (!normalized) {
        return defaultValue;
      }
      return normalized === "y" || normalized === "yes";
    },
    async close() {
      await readline.close();
    },
  };
}

function createQueuedPromptIo(stdout: (text: string) => void, answers: string[]): PromptIo {
  let answerIndex = 0;

  function consumeAnswer(promptLabel: string): string {
    const answer = answers[answerIndex];
    answerIndex += 1;

    if (answer === undefined) {
      throw new Error(`No stdin answer available for prompt '${promptLabel}'.`);
    }

    return answer;
  }

  return {
    info(message: string) {
      stdout(message);
    },
    async prompt(
      message: string,
      options: {
        defaultValue?: string;
        secret?: boolean;
      } = {},
    ): Promise<string> {
      const suffix = options.defaultValue ? ` [${options.defaultValue}]` : "";
      stdout(`${message}${suffix}:`);
      const answer = consumeAnswer(message);
      return answer || options.defaultValue || "";
    },
    async confirm(message: string, defaultValue = false): Promise<boolean> {
      stdout(`${message} ${defaultValue ? "[Y/n]" : "[y/N]"}:`);
      const normalized = consumeAnswer(message).trim().toLowerCase();
      if (!normalized) {
        return defaultValue;
      }
      return normalized === "y" || normalized === "yes";
    },
    async close() {},
  };
}

async function readQueuedAnswers(stdin: Readable): Promise<string[]> {
  let rawInput = "";

  for await (const chunk of stdin) {
    rawInput += typeof chunk === "string" ? chunk : chunk.toString("utf8");
  }

  return rawInput.replaceAll("\r\n", "\n").split("\n");
}

class MaskingWritable extends Writable {
  muted = false;

  constructor(private readonly target: NodeJS.WriteStream) {
    super();
  }

  _write(
    chunk: string | Uint8Array,
    encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ) {
    if (!this.muted) {
      this.target.write(chunk, encoding);
    }
    callback();
  }
}
