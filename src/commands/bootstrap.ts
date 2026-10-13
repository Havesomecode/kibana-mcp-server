import { type Command, InvalidArgumentError, Option } from "commander";

import { type BootstrapResult, runBootstrap } from "../setup/bootstrap.js";
import { type PromptIo, createPromptIo } from "../utils/cli_prompts.js";
import type { CliCommandContext } from "./context.js";

interface BootstrapOptions {
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

export default function registerBootstrap(program: Command, context: CliCommandContext): void {
  program
    .command("bootstrap")
    .description("Verify and save only the Kibana connection")
    .addHelpText(
      "after",
      "\nBootstrap does not inspect or configure indexes. Missing connection values are prompted for.\n\nConnection options use KIBANA_BASE_URL, KIBANA_USERNAME, and KIBANA_PASSWORD as fallbacks. Passwords are accepted only through --password-stdin, --password-env <NAME>, KIBANA_PASSWORD, or a secret prompt. Profile defaults to KIBANA_PROFILE, then default.",
    )
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
    .option("--no-default", "Do not make this profile the default")
    .action(async (options: BootstrapOptions) => {
      const { env, stdin } = context.io;
      let promptIo: PromptIo | undefined;
      try {
        let baseUrl = options.url?.trim() || env.KIBANA_BASE_URL?.trim();
        let username = options.username?.trim() || env.KIBANA_USERNAME?.trim();
        let password = options.passwordStdin
          ? (await readAllInput(stdin)).replace(/\r?\n$/, "")
          : options.passwordEnv !== undefined
            ? env[options.passwordEnv]
            : env.KIBANA_PASSWORD;
        const promptForPassword =
          !password && !options.passwordStdin && options.passwordEnv === undefined;
        if (!baseUrl || !username || promptForPassword) {
          promptIo = await createPromptIo(context.io);
        }
        baseUrl ||= (await promptIo?.prompt("Kibana base URL"))?.trim();
        if (!baseUrl) {
          throw new Error(
            "Kibana base URL is required via --url, KIBANA_BASE_URL, or the associated prompt.",
          );
        }
        username ||= (await promptIo?.prompt("Kibana username"))?.trim();
        if (!username) {
          throw new Error(
            "Kibana username is required via --username, KIBANA_USERNAME, or the associated prompt.",
          );
        }
        if (promptForPassword) {
          password = (await promptIo?.prompt("Kibana password", { secret: true }))?.trim();
        }
        if (!password) {
          throw new Error(
            "Kibana password is required via an option, KIBANA_PASSWORD, or the associated prompt.",
          );
        }
        const result = await (context.dependencies.runBootstrapFn ?? runBootstrap)({
          profileName: options.profile?.trim() || env.KIBANA_PROFILE?.trim() || "default",
          baseUrl,
          username,
          password,
          client: options.client ?? "codex",
          packageSpecifier: options.package,
          mcpName: options.mcpName,
          makeDefault: options.default,
          replaceExisting: options.replace ?? false,
          timeoutMs: options.timeout,
        });
        context.ui.success(renderBootstrapResult(result));
      } catch (error) {
        context.ui.error(error instanceof Error ? error.message : String(error));
        context.setExitCode(1);
      } finally {
        await promptIo?.close();
      }
    });
}

function parseTimeout(value: string): number {
  const timeout = Number(value);
  if (!Number.isInteger(timeout) || timeout <= 0 || timeout > 120000) {
    throw new InvalidArgumentError(
      "--timeout must be a positive integer no greater than 120000 milliseconds.",
    );
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
