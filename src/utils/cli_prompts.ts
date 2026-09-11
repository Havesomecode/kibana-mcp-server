import type { ReadStream } from "node:tty";
import { cancel, confirm, isCancel, log, password, text } from "@clack/prompts";

import type { SetupPrompter } from "../setup_flow.js";
import type { CliIo } from "./cli_io.js";

export interface PromptIo extends SetupPrompter {
  close(): Promise<void>;
}
export class PromptCancelledError extends Error {
  constructor() {
    super("Setup cancelled.");
  }
}

export async function createPromptIo(io: CliIo): Promise<PromptIo> {
  const stdinIsTTY = io.stdinIsTTY ?? Boolean((io.stdin as ReadStream).isTTY);
  if (!stdinIsTTY) return createQueuedPromptIo(io.stdout, await readQueuedAnswers(io.stdin));
  return {
    info: (message) => log.info(message, { output: io.stdoutStream }),
    async prompt(message, options = {}) {
      return unwrap(
        await (options.secret ? password : text)({
          message,
          defaultValue: options.defaultValue,
          input: io.stdin,
          output: io.stdoutStream,
        }),
        io.stdoutStream,
      );
    },
    async confirm(message, defaultValue = false) {
      return unwrap(
        await confirm({
          message,
          initialValue: defaultValue,
          input: io.stdin,
          output: io.stdoutStream,
        }),
        io.stdoutStream,
      );
    },
    async close() {},
  };
}

function unwrap<T>(answer: T | symbol, output: NodeJS.WriteStream): T {
  if (isCancel(answer)) {
    cancel("Setup cancelled.", { output });
    throw new PromptCancelledError();
  }
  return answer as T;
}
function createQueuedPromptIo(stdout: (text: string) => void, answers: string[]): PromptIo {
  let index = 0;
  const consume = (label: string) => {
    const answer = answers[index++];
    if (answer === undefined) throw new Error(`No stdin answer available for prompt '${label}'.`);
    return answer;
  };
  return {
    info: stdout,
    async prompt(message, options = {}) {
      const suffix = options.defaultValue ? ` [${options.defaultValue}]` : "";
      stdout(`${message}${suffix}:`);
      return consume(message) || options.defaultValue || "";
    },
    async confirm(message, defaultValue = false) {
      stdout(`${message} ${defaultValue ? "[Y/n]" : "[y/N]"}:`);
      const answer = consume(message).trim().toLowerCase();
      return answer ? answer === "y" || answer === "yes" : defaultValue;
    },
    async close() {},
  };
}
async function readQueuedAnswers(stdin: import("node:stream").Readable): Promise<string[]> {
  let raw = "";
  for await (const chunk of stdin)
    raw += typeof chunk === "string" ? chunk : chunk.toString("utf8");
  return raw.replaceAll("\r\n", "\n").split("\n");
}
