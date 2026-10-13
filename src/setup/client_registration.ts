import { spawn } from "node:child_process";
import { createHash } from "node:crypto";

export interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export type CommandRunner = (command: string, args: string[]) => Promise<CommandResult>;

export interface ClientRegistrationPreflight {
  alreadyRegistered: boolean;
}

export interface ClientRegistrationResult {
  added: boolean;
}

export interface ClientRegistrar {
  preflight(): Promise<ClientRegistrationPreflight>;
  register(): Promise<ClientRegistrationResult>;
  rollback(): Promise<void>;
}

export interface CodexRegistrationOptions {
  mcpName: string;
  profileName: string;
  packageSpecifier: string;
}

export function deriveCodexRegistrationName(options: CodexRegistrationOptions): string {
  const transport = [
    "npx",
    "-y",
    options.packageSpecifier,
    "serve",
    "--profile",
    options.profileName,
  ];
  const suffix = createHash("sha256").update(JSON.stringify(transport)).digest("hex").slice(0, 12);
  return `${options.mcpName}-${suffix}`;
}

interface CodexMcpConfig {
  enabled?: unknown;
  transport?: {
    type?: unknown;
    command?: unknown;
    args?: unknown;
    cwd?: unknown;
    env?: unknown;
    env_vars?: unknown;
  };
}

export class CodexClientRegistrar implements ClientRegistrar {
  private preflightResult: ClientRegistrationPreflight | undefined;
  private rollbackEligible = false;

  constructor(
    private readonly options: CodexRegistrationOptions,
    private readonly runner: CommandRunner = runCommand,
  ) {}

  private get registrationName(): string {
    return deriveCodexRegistrationName(this.options);
  }

  async preflight(): Promise<ClientRegistrationPreflight> {
    const existing = await this.readRegistration();
    if (!existing) {
      this.preflightResult = { alreadyRegistered: false };
      return this.preflightResult;
    }

    if (!this.matchesExpectedTransport(existing)) {
      throw new Error(
        `Refusing to overwrite existing Codex MCP registration '${this.registrationName}' because its transport differs. Remove or rename it explicitly before retrying.`,
      );
    }

    this.preflightResult = { alreadyRegistered: true };
    return this.preflightResult;
  }

  async register(): Promise<ClientRegistrationResult> {
    const preflight = this.preflightResult ?? (await this.preflight());
    if (preflight.alreadyRegistered) {
      return { added: false };
    }

    let addResult: CommandResult;
    try {
      addResult = await this.runner("codex", [
        "mcp",
        "add",
        this.registrationName,
        "--",
        ...this.expectedCommand(),
      ]);
    } catch (error) {
      return await this.reconcileAmbiguousAdd(error);
    }
    if (addResult.exitCode !== 0) {
      return await this.reconcileAmbiguousAdd(
        new Error(
          `Codex MCP registration failed: ${addResult.stderr.trim() || addResult.stdout.trim() || `exit code ${addResult.exitCode}`}`,
        ),
      );
    }
    this.rollbackEligible = true;

    const registered = await this.readRegistration();
    if (!registered || !this.matchesExpectedTransport(registered)) {
      // A different registration could have won a race. Never remove a transport
      // whose exact ownership cannot be proven.
      this.rollbackEligible = Boolean(registered && this.matchesExpectedTransport(registered));
      throw new Error(
        `Codex MCP registration readback did not match the requested transport for '${this.registrationName}'. The mismatched registration was left untouched.`,
      );
    }

    return { added: true };
  }

  private async reconcileAmbiguousAdd(originalError: unknown): Promise<ClientRegistrationResult> {
    const registered = await this.readRegistration();
    if (registered && this.matchesExpectedTransport(registered)) {
      // The requested end-state exists, but another process may own it. Treat the
      // operation as converged and never claim rollback ownership.
      this.rollbackEligible = false;
      return { added: true };
    }
    this.rollbackEligible = false;
    if (registered) {
      throw new Error(
        `Codex MCP registration '${this.registrationName}' changed concurrently and does not match the requested transport.`,
        { cause: originalError },
      );
    }
    throw originalError;
  }

  async rollback(): Promise<void> {
    if (!this.rollbackEligible) {
      return;
    }

    const current = await this.readRegistration();
    if (!current) {
      this.rollbackEligible = false;
      return;
    }
    if (!this.matchesExpectedTransport(current)) {
      this.rollbackEligible = false;
      throw new Error(
        `Refusing to roll back Codex MCP registration '${this.registrationName}' because its transport no longer matches this bootstrap.`,
      );
    }

    const removeResult = await this.runner("codex", ["mcp", "remove", this.registrationName]);
    if (removeResult.exitCode !== 0) {
      throw new Error(
        `Could not roll back Codex MCP registration '${this.registrationName}': ${removeResult.stderr.trim() || removeResult.stdout.trim() || `exit code ${removeResult.exitCode}`}`,
      );
    }

    const remaining = await this.readRegistration();
    if (!remaining || !this.matchesExpectedTransport(remaining)) {
      this.rollbackEligible = false;
      return;
    }
    throw new Error(
      `Could not confirm removal of Codex MCP registration '${this.registrationName}'.`,
    );
  }

  private expectedCommand(): string[] {
    return [
      "npx",
      "-y",
      this.options.packageSpecifier,
      "serve",
      "--profile",
      this.options.profileName,
    ];
  }

  private matchesExpectedTransport(config: CodexMcpConfig): boolean {
    const [command, ...args] = this.expectedCommand();
    return (
      config.enabled === true &&
      config.transport?.type === "stdio" &&
      config.transport.command === command &&
      Array.isArray(config.transport.args) &&
      config.transport.args.every((value) => typeof value === "string") &&
      JSON.stringify(config.transport.args) === JSON.stringify(args) &&
      isEmptyValue(config.transport.cwd) &&
      isEmptyEnvironment(config.transport.env) &&
      isEmptyStringArray(config.transport.env_vars) &&
      hasOnlyKeys(config.transport, ["type", "command", "args", "cwd", "env", "env_vars"])
    );
  }

  private async readRegistration(): Promise<CodexMcpConfig | null> {
    const result = await this.runner("codex", ["mcp", "get", this.registrationName, "--json"]);
    if (result.exitCode !== 0) {
      const message = `${result.stderr}\n${result.stdout}`.toLowerCase();
      if (message.includes("not found") || message.includes("no mcp server")) {
        return null;
      }
      throw new Error(
        `Could not inspect Codex MCP registration '${this.registrationName}': ${result.stderr.trim() || result.stdout.trim() || `exit code ${result.exitCode}`}`,
      );
    }

    try {
      return JSON.parse(result.stdout) as CodexMcpConfig;
    } catch {
      throw new Error(
        `Codex MCP registration '${this.registrationName}' returned invalid JSON during readback.`,
      );
    }
  }
}

function isEmptyValue(value: unknown): boolean {
  return value === undefined || value === null;
}

function isEmptyEnvironment(value: unknown): boolean {
  return (
    isEmptyValue(value) ||
    (typeof value === "object" && value !== null && Object.keys(value).length === 0)
  );
}

function isEmptyStringArray(value: unknown): boolean {
  return isEmptyValue(value) || (Array.isArray(value) && value.length === 0);
}

function hasOnlyKeys(value: object, allowedKeys: string[]): boolean {
  const allowed = new Set(allowedKeys);
  return Object.keys(value).every((key) => allowed.has(key));
}

async function runCommand(command: string, args: string[]): Promise<CommandResult> {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "pipe" });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      callback();
    };
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      finish(() => reject(new Error(`Command '${command}' timed out after 30000ms.`)));
    }, 30000);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      finish(() =>
        reject(
          new Error(
            error && typeof error === "object" && "code" in error && error.code === "ENOENT"
              ? `Required command '${command}' is not installed or not available on PATH.`
              : `Could not run '${command}': ${error.message}`,
          ),
        ),
      );
    });
    child.on("close", (exitCode) => {
      finish(() => resolve({ stdout, stderr, exitCode: exitCode ?? 1 }));
    });
    child.stdin.end();
  });
}
