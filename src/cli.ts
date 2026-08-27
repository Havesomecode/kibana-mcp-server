import { createInterface } from "node:readline/promises";
import { type Readable, Writable } from "node:stream";
import type { ReadStream } from "node:tty";
import { parseArgs } from "node:util";

import { type BootstrapResult, runBootstrap } from "./bootstrap.js";
import { PROFILE_NAME_ENV } from "./config.js";
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
    "  setup      Run guided machine setup",
    "  bootstrap  Verify, save, and register a profile without prompts",
    "  serve      Start the stdio MCP server",
    "  help       Show this help output",
  ].join("\n");
}

function renderBootstrapHelp(): string {
  return [
    "Usage:",
    "  kibana-mcp-server bootstrap --index <pattern> [options]",
    "  kibana-mcp-server setup --index <pattern> [options]  # compatible alias",
    "",
    "Connection options use KIBANA_BASE_URL, KIBANA_USERNAME, and KIBANA_PASSWORD as fallbacks.",
    "Passwords are accepted only through --password-stdin, --password-env <NAME>, or KIBANA_PASSWORD.",
    "",
    "Options:",
    "  --index <pattern>       Elasticsearch index pattern; repeatable and required",
    "  --profile <name>        Saved profile name (default: KIBANA_PROFILE or default)",
    "  --url <url>             Kibana base URL",
    "  --username <name>       Kibana basic-auth username",
    "  --password-stdin        Read the password from stdin",
    "  --password-env <name>   Read the password from a named environment variable",
    "  --time-field <field>    Override automatic date-field selection",
    "  --client <codex|none>   Register Codex or skip client registration (default: codex)",
    "  --replace               Explicitly replace an existing hand-authored profile catalog",
    "  --no-default            Do not make this profile the default",
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
    env?: NodeJS.ProcessEnv;
  } = {},
  dependencies: {
    startMcpServerFn?: typeof startMcpServer;
    runSetupFlowFn?: (prompter: SetupPrompter) => Promise<SetupFlowResult>;
    runBootstrapFn?: typeof runBootstrap;
  } = {},
): Promise<number> {
  const stdout = io.stdout ?? ((text: string) => process.stdout.write(`${text}\n`));
  const stderr = io.stderr ?? ((text: string) => process.stderr.write(`${text}\n`));
  const stdin = io.stdin ?? process.stdin;
  const stdoutStream = io.stdoutStream ?? process.stdout;
  const env = io.env ?? process.env;
  const [command, ...rest] = argv;

  switch (command) {
    case undefined: {
      try {
        await (dependencies.startMcpServerFn ?? startMcpServer)(env);
        return 0;
      } catch (error) {
        stderr(error instanceof Error ? error.message : String(error));
        return 1;
      }
    }
    case "setup": {
      if (rest.length > 0) {
        if (rest.includes("--help") || rest.includes("-h")) {
          stdout(renderBootstrapHelp());
          return 0;
        }
        try {
          const options = await parseBootstrapOptions(rest, stdin, env);
          const result: BootstrapResult = await (dependencies.runBootstrapFn ?? runBootstrap)(
            options,
          );
          stdout(renderBootstrapResult(result));
          return 0;
        } catch (error) {
          stderr(error instanceof Error ? error.message : String(error));
          return 1;
        }
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
    case "bootstrap": {
      if (rest.includes("--help") || rest.includes("-h")) {
        stdout(renderBootstrapHelp());
        return 0;
      }
      try {
        const options = await parseBootstrapOptions(rest, stdin, env);
        const result: BootstrapResult = await (dependencies.runBootstrapFn ?? runBootstrap)(
          options,
        );
        stdout(renderBootstrapResult(result));
        return 0;
      } catch (error) {
        stderr(error instanceof Error ? error.message : String(error));
        return 1;
      }
    }
    case "serve": {
      try {
        const { values } = parseArgs({
          args: rest,
          allowPositionals: false,
          strict: true,
          options: {
            profile: { type: "string" },
          },
        });
        const serveEnv = values.profile ? { ...env, [PROFILE_NAME_ENV]: values.profile } : env;
        await (dependencies.startMcpServerFn ?? startMcpServer)(serveEnv);
      } catch (error) {
        stderr(error instanceof Error ? error.message : String(error));
        return 1;
      }
      return 0;
    }
    default: {
      stderr(`Unknown command: ${command}`);
      stderr(renderHelp());
      return 1;
    }
  }
}

async function parseBootstrapOptions(
  args: string[],
  stdin: Readable,
  env: NodeJS.ProcessEnv,
): Promise<Parameters<typeof runBootstrap>[0]> {
  const { values } = parseArgs({
    args,
    allowPositionals: false,
    strict: true,
    options: {
      index: { type: "string", multiple: true },
      profile: { type: "string" },
      url: { type: "string" },
      username: { type: "string" },
      "password-stdin": { type: "boolean" },
      "password-env": { type: "string" },
      "source-name": { type: "string" },
      "source-id": { type: "string" },
      "time-field": { type: "string" },
      timeout: { type: "string" },
      client: { type: "string" },
      replace: { type: "boolean" },
      "no-default": { type: "boolean" },
    },
  });

  const baseUrl = values.url?.trim() || env.KIBANA_BASE_URL?.trim();
  if (!baseUrl) {
    throw new Error("Kibana base URL is required via --url or KIBANA_BASE_URL.");
  }
  const username = values.username?.trim() || env.KIBANA_USERNAME?.trim();
  if (!username) {
    throw new Error("Kibana username is required via --username or KIBANA_USERNAME.");
  }
  if (values["password-stdin"] && values["password-env"]) {
    throw new Error("Use only one of --password-stdin or --password-env.");
  }

  let password: string | undefined;
  if (values["password-stdin"]) {
    password = (await readAllInput(stdin)).replace(/\r?\n$/, "");
  } else if (values["password-env"]) {
    password = env[values["password-env"]];
    if (password === undefined) {
      throw new Error(`Password environment variable '${values["password-env"]}' is not set.`);
    }
  } else {
    password = env.KIBANA_PASSWORD;
  }
  if (!password) {
    throw new Error(
      "Kibana password is required via --password-stdin, --password-env, or KIBANA_PASSWORD.",
    );
  }

  const client = values.client ?? "codex";
  if (client !== "codex" && client !== "none") {
    throw new Error("--client must be either 'codex' or 'none'.");
  }
  const timeoutMs = values.timeout === undefined ? undefined : Number(values.timeout);
  if (timeoutMs !== undefined && !Number.isFinite(timeoutMs)) {
    throw new Error("--timeout must be a number of milliseconds.");
  }

  return {
    profileName: values.profile?.trim() || env[PROFILE_NAME_ENV]?.trim() || "default",
    baseUrl,
    username,
    password,
    indexes: values.index ?? [],
    client,
    makeDefault: !values["no-default"],
    replaceExisting: values.replace ?? false,
    sourceName: values["source-name"],
    sourceId: values["source-id"],
    timeField: values["time-field"],
    timeoutMs,
  };
}

function renderBootstrapResult(result: BootstrapResult): string {
  return [
    `Bootstrap verified for profile '${result.profileName}'.`,
    `Source '${result.sourceId}' uses index pattern${result.indexes.length === 1 ? "" : "s"}: ${result.indexes.join(", ")}.`,
    result.registered
      ? `Codex MCP registration is installed and verified for profile '${result.profileName}'.`
      : "Client registration was skipped by request.",
  ].join("\n");
}

async function readAllInput(stdin: Readable): Promise<string> {
  let rawInput = "";
  for await (const chunk of stdin) {
    rawInput += typeof chunk === "string" ? chunk : chunk.toString("utf8");
  }
  return rawInput;
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
