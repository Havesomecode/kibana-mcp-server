import { type Command, InvalidArgumentError, Option } from "commander";

import { type BootstrapResult, runBootstrap as runBootstrapFlow } from "../bootstrap.js";
import { runSetupFlow } from "../setup_flow.js";
import { PromptCancelledError, createPromptIo } from "../utils/cli_prompts.js";
import type { CliCommandContext } from "./context.js";

interface SetupOptions {
  profile?: string;
  url?: string;
  username?: string;
  passwordStdin?: boolean;
  passwordEnv?: string;
  timeout?: number;
  client?: "codex" | "none";
  package?: string;
  mcpName?: string;
  replace?: boolean;
  default: boolean;
}

export default function registerSetup(program: Command, context: CliCommandContext): void {
  const setupCommand = addOptions(
    program
      .command("setup")
      .alias("bootstrap")
      .description("Run guided machine setup and connection bootstrap")
      .addHelpText(
        "after",
        "\nBootstrap is an alias for setup. Without options, setup is guided; with options, it verifies and saves only the Kibana connection and does not inspect or configure indexes.\n\nConnection options use KIBANA_BASE_URL, KIBANA_USERNAME, and KIBANA_PASSWORD as fallbacks. Passwords are accepted only through --password-stdin, --password-env <NAME>, or KIBANA_PASSWORD.",
      ),
  );
  setupCommand.action(async () => {
    const options = readOptions(context.argv);
    if (context.argv.some((argument) => argument.startsWith("-")))
      return runBootstrap(options, context);
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

function readOptions(argv: string[]): SetupOptions {
  const value = (flag: string) => {
    const index = argv.indexOf(flag);
    return index === -1 ? undefined : argv[index + 1];
  };
  return {
    profile: value("--profile"),
    url: value("--url"),
    username: value("--username"),
    passwordStdin: argv.includes("--password-stdin"),
    passwordEnv: value("--password-env"),
    timeout: value("--timeout") === undefined ? undefined : Number(value("--timeout")),
    client: value("--client") as SetupOptions["client"],
    package: value("--package"),
    mcpName: value("--mcp-name"),
    replace: argv.includes("--replace"),
    default: !argv.includes("--no-default"),
  };
}

function addOptions(command: Command): Command {
  return command
    .option("--profile <name>", "Saved profile name")
    .option("--url <url>", "Kibana base URL")
    .option("--username <name>", "Kibana basic-auth username")
    .addOption(
      new Option("--password-stdin", "Read the password from stdin").conflicts("passwordEnv"),
    )
    .option("--password-env <name>", "Read the password from an environment variable")
    .addOption(
      new Option("--timeout <milliseconds>", "Kibana request timeout").argParser(parseTimeout),
    )
    .addOption(
      new Option("--client <codex|none>", "Client registration mode").choices(["codex", "none"]),
    )
    .option("--package <specifier>", "Package specifier for client registration")
    .option("--mcp-name <name>", "MCP registration name")
    .option("--replace", "Replace an existing catalog")
    .option("--no-default", "Do not make this profile the default");
}

async function runBootstrap(options: SetupOptions, context: CliCommandContext): Promise<void> {
  const needsPrompt =
    !options.url ||
    !options.username ||
    (!options.passwordStdin && options.passwordEnv === undefined);
  const promptIo = needsPrompt ? await createPromptIo(context.io) : undefined;
  try {
    const result: BootstrapResult = await (context.dependencies.runBootstrapFn ?? runBootstrapFlow)(
      await resolveBootstrapOptions(options, context, promptIo),
    );
    context.ui.success(renderBootstrapResult(result));
  } catch (error) {
    context.ui.error(error instanceof Error ? error.message : String(error));
    context.setExitCode(1);
  } finally {
    await promptIo?.close();
  }
}

async function resolveBootstrapOptions(
  values: SetupOptions,
  context: CliCommandContext,
  prompter?: import("../setup_flow.js").SetupPrompter,
): Promise<Parameters<typeof runBootstrapFlow>[0]> {
  const { env, stdin } = context.io;
  const baseUrl = values.url?.trim() || (await prompter?.prompt("Kibana base URL"))?.trim();
  if (!baseUrl) throw new Error("Kibana base URL is required via --url or the associated prompt.");
  const username = values.username?.trim() || (await prompter?.prompt("Kibana username"))?.trim();
  if (!username)
    throw new Error("Kibana username is required via --username or the associated prompt.");

  const password = values.passwordStdin
    ? (await readAllInput(stdin)).replace(/\r?\n$/, "")
    : values.passwordEnv
      ? env[values.passwordEnv]
      : (await prompter?.prompt("Kibana password", { secret: true }))?.trim();
  if (!password)
    throw new Error("Kibana password is required via an option or the associated prompt.");

  return {
    profileName: values.profile?.trim() || env.KIBANA_PROFILE?.trim() || "default",
    baseUrl,
    username,
    password,
    client: values.client ?? "codex",
    packageSpecifier: values.package,
    mcpName: values.mcpName,
    makeDefault: values.default,
    replaceExisting: values.replace ?? false,
    timeoutMs: values.timeout,
  };
}

function parseTimeout(value: string): number {
  const timeout = Number(value);
  if (!Number.isFinite(timeout)) {
    throw new InvalidArgumentError("--timeout must be a number of milliseconds.");
  }
  return timeout;
}

function renderBootstrapResult(result: BootstrapResult): string {
  return [
    `Bootstrap verified for profile '${result.profileName}'.`,
    result.sourceCount === 0
      ? "Source catalog is empty. No Kibana indexes were inspected or configured. Ask the user which index or index pattern to configure before querying logs."
      : `Preserved ${result.sourceCount} explicitly configured source${result.sourceCount === 1 ? "" : "s"}; bootstrap did not inspect them.`,
    result.registered
      ? `Codex MCP registration is installed and verified for profile '${result.profileName}'.`
      : "Client registration was skipped by request.",
  ].join("\n");
}

async function readAllInput(stdin: import("node:stream").Readable): Promise<string> {
  let raw = "";
  for await (const chunk of stdin)
    raw += typeof chunk === "string" ? chunk : chunk.toString("utf8");
  return raw;
}
