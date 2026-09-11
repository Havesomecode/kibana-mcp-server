import type { Readable } from "node:stream";

export interface CliIo {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  stdin: Readable;
  stdoutStream: NodeJS.WriteStream;
  stdinIsTTY?: boolean;
  env: NodeJS.ProcessEnv;
  isStdoutOverridden: boolean;
}

export function createCliIo(overrides: Partial<CliIo> = {}): CliIo {
  return {
    stdout: overrides.stdout ?? ((text) => process.stdout.write(`${text}\n`)),
    stderr: overrides.stderr ?? ((text) => process.stderr.write(`${text}\n`)),
    stdin: overrides.stdin ?? process.stdin,
    stdoutStream: overrides.stdoutStream ?? process.stdout,
    stdinIsTTY: overrides.stdinIsTTY,
    env: overrides.env ?? process.env,
    isStdoutOverridden: overrides.stdout !== undefined,
  };
}
