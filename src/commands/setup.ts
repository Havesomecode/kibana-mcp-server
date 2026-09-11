import type { Command } from "commander";

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
  timeout?: string;
  client?: string;
  package?: string;
  mcpName?: string;
  replace?: boolean;
  default: boolean;
}

export default (program: Command, context: CliCommandContext): void => {
  registerBootstrap(program, context);
  registerSetup(program, context);
};

function registerBootstrap(program: Command, context: CliCommandContext): void {
  addOptions(
    program
      .command("bootstrap")
      .description("Verify, save, and register a profile without prompts")
      .addHelpText(
        "after",
        "\nBootstrap verifies and saves only the Kibana connection; it does not inspect or configure indexes.\nAfter installation, ask the agent to configure a specific index or index pattern.\n\nConnection options use KIBANA_BASE_URL, KIBANA_USERNAME, and KIBANA_PASSWORD as fallbacks.\nPasswords are accepted only through --password-stdin, --password-env <NAME>, or KIBANA_PASSWORD.",
      ),
  ).action(async (options: SetupOptions) => runBootstrap(options, context));
}

function registerSetup(program: Command, context: CliCommandContext): void {
  addOptions(
    program
      .command("setup")
      .description("Run guided machine setup")
      .addHelpText(
        "after",
        "\nWith options, setup is a compatible non-interactive alias for bootstrap.",
      ),
  ).action(async (options: SetupOptions, command: Command) => {
    if (hasOptions(command)) return runBootstrap(options, context);
    const promptIo = await createPromptIo(context.io);
    try {
      const result = await (context.dependencies.runSetupFlowFn ?? runSetupFlow)(promptIo);
      context.io.stdout(
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

function addOptions(command: Command): Command {
  return command
    .option("--profile <name>", "Saved profile name")
    .option("--url <url>", "Kibana base URL")
    .option("--username <name>", "Kibana basic-auth username")
    .option("--password-stdin", "Read the password from stdin")
    .option("--password-env <name>", "Read the password from an environment variable")
    .option("--timeout <milliseconds>", "Kibana request timeout")
    .option("--client <codex|none>", "Client registration mode")
    .option("--package <specifier>", "Package specifier for client registration")
    .option("--mcp-name <name>", "MCP registration name")
    .option("--replace", "Replace an existing catalog")
    .option("--no-default", "Do not make this profile the default");
}

function hasOptions(command: Command): boolean {
  return command.options.some(
    (option) => command.getOptionValueSource(option.attributeName()) === "cli",
  );
}

async function runBootstrap(options: SetupOptions, context: CliCommandContext): Promise<void> {
  try {
    const result: BootstrapResult = await (context.dependencies.runBootstrapFn ?? runBootstrapFlow)(
      await resolveBootstrapOptions(options, context),
    );
    context.io.stdout(renderBootstrapResult(result));
  } catch (error) {
    context.io.stderr(error instanceof Error ? error.message : String(error));
    context.setExitCode(1);
  }
}

async function resolveBootstrapOptions(
  values: SetupOptions,
  context: CliCommandContext,
): Promise<Parameters<typeof runBootstrapFlow>[0]> {
  const { env, stdin } = context.io;
  const baseUrl = values.url?.trim() || env.KIBANA_BASE_URL?.trim();
  if (!baseUrl) throw new Error("Kibana base URL is required via --url or KIBANA_BASE_URL.");
  const username = values.username?.trim() || env.KIBANA_USERNAME?.trim();
  if (!username) throw new Error("Kibana username is required via --username or KIBANA_USERNAME.");
  if (values.passwordStdin && values.passwordEnv)
    throw new Error("Use only one of --password-stdin or --password-env.");
  const password = values.passwordStdin
    ? (await readAllInput(stdin)).replace(/\r?\n$/, "")
    : values.passwordEnv
      ? env[values.passwordEnv]
      : env.KIBANA_PASSWORD;
  if (!password)
    throw new Error(
      "Kibana password is required via --password-stdin, --password-env, or KIBANA_PASSWORD.",
    );
  const client = values.client ?? "codex";
  if (client !== "codex" && client !== "none")
    throw new Error("--client must be either 'codex' or 'none'.");
  const timeoutMs = values.timeout === undefined ? undefined : Number(values.timeout);
  if (timeoutMs !== undefined && !Number.isFinite(timeoutMs))
    throw new Error("--timeout must be a number of milliseconds.");
  return {
    profileName: values.profile?.trim() || env.KIBANA_PROFILE?.trim() || "default",
    baseUrl,
    username,
    password,
    client,
    packageSpecifier: values.package,
    mcpName: values.mcpName,
    makeDefault: values.default,
    replaceExisting: values.replace ?? false,
    timeoutMs,
  };
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
