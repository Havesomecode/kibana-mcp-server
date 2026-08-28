import { spawn } from "node:child_process";

import type { SavedSecret } from "./types.js";

const DEFAULT_SERVICE_NAME = "com.zacaria.kibana-mcp-server";

export class SecretStoreError extends Error {
  constructor(
    message: string,
    readonly code: "UNAVAILABLE" | "NOT_FOUND" | "OPERATION_FAILED",
  ) {
    super(message);
    this.name = "SecretStoreError";
  }
}

export interface SecretStore {
  load(profileId: string): Promise<SavedSecret>;
  save(profileId: string, secret: SavedSecret): Promise<void>;
  delete(profileId: string): Promise<void>;
}

interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

type CommandRunner = (
  command: string,
  args: string[],
  options?: {
    stdin?: string;
  },
) => Promise<CommandResult>;

export function createSecretStore(
  platform: NodeJS.Platform = process.platform,
  runner: CommandRunner = runCommand,
  serviceName: string = DEFAULT_SERVICE_NAME,
): SecretStore {
  switch (platform) {
    case "darwin":
      return new MacOsSecretStore(runner, serviceName);
    case "win32":
      return new WindowsSecretStore(runner, serviceName);
    default:
      return new LinuxSecretStore(runner, serviceName);
  }
}

class MacOsSecretStore implements SecretStore {
  constructor(
    private readonly runner: CommandRunner,
    private readonly serviceName: string,
  ) {}

  async load(profileId: string): Promise<SavedSecret> {
    const result = await this.execute("find-generic-password", [
      "-s",
      this.serviceName,
      "-a",
      profileId,
      "-w",
    ]);

    return parseStoredSecret(result.stdout);
  }

  async save(profileId: string, secret: SavedSecret): Promise<void> {
    const serialized = serializeSecret(secret);
    await this.execute(
      "add-generic-password",
      ["-U", "-s", this.serviceName, "-a", profileId, "-w"],
      `${serialized}\n${serialized}\n`,
    );
  }

  async delete(profileId: string): Promise<void> {
    try {
      await this.execute("delete-generic-password", ["-s", this.serviceName, "-a", profileId]);
    } catch (error) {
      if (error instanceof SecretStoreError && error.code === "NOT_FOUND") {
        return;
      }
      throw error;
    }
  }

  private async execute(
    subcommand: string,
    args: string[],
    stdin?: string,
  ): Promise<CommandResult> {
    try {
      const result = await this.runner("security", [subcommand, ...args], { stdin });
      if (result.exitCode === 44) {
        throw new SecretStoreError(
          `No saved credentials found for profile '${args.at(-1)}'.`,
          "NOT_FOUND",
        );
      }
      if (result.exitCode !== 0) {
        throw new SecretStoreError(
          result.stderr.trim() || "macOS Keychain command failed.",
          "OPERATION_FAILED",
        );
      }
      return result;
    } catch (error) {
      throw normalizeRunnerError(error, "macOS Keychain is unavailable.");
    }
  }
}

class LinuxSecretStore implements SecretStore {
  constructor(
    private readonly runner: CommandRunner,
    private readonly serviceName: string,
  ) {}

  async load(profileId: string): Promise<SavedSecret> {
    const result = await this.execute("lookup", this.attributes(profileId));
    const value = result.stdout.trim();
    if (!value) {
      throw new SecretStoreError(
        `No saved credentials found for profile '${profileId}'.`,
        "NOT_FOUND",
      );
    }
    return parseStoredSecret(value);
  }

  async save(profileId: string, secret: SavedSecret): Promise<void> {
    await this.execute(
      "store",
      ["--label", `Kibana MCP (${profileId})`, ...this.attributes(profileId)],
      serializeSecret(secret),
    );
  }

  async delete(profileId: string): Promise<void> {
    try {
      await this.execute("clear", this.attributes(profileId));
    } catch (error) {
      if (error instanceof SecretStoreError && error.code === "NOT_FOUND") {
        return;
      }
      throw error;
    }
  }

  private attributes(profileId: string): string[] {
    return ["service", this.serviceName, "profile", profileId];
  }

  private async execute(command: string, args: string[], stdin?: string): Promise<CommandResult> {
    try {
      const result = await this.runner("secret-tool", [command, ...args], { stdin });
      if (result.exitCode !== 0) {
        const stderr = result.stderr.trim().toLowerCase();
        const missingWithoutMessage =
          (command === "lookup" || command === "clear") &&
          result.exitCode === 1 &&
          stderr.length === 0;
        if (stderr.includes("not found") || missingWithoutMessage) {
          throw new SecretStoreError(
            `No saved credentials found for profile '${args.at(-1) ?? "unknown"}'.`,
            "NOT_FOUND",
          );
        }
        throw new SecretStoreError(
          result.stderr.trim() || "Secret Service command failed.",
          "OPERATION_FAILED",
        );
      }
      return result;
    } catch (error) {
      throw normalizeRunnerError(
        error,
        "Linux Secret Service is unavailable. Install and unlock a Secret Service-compatible keyring first.",
      );
    }
  }
}

class WindowsSecretStore implements SecretStore {
  constructor(
    private readonly runner: CommandRunner,
    private readonly serviceName: string,
  ) {}

  async load(profileId: string): Promise<SavedSecret> {
    const result = await this.execute(
      `
[void][Windows.Security.Credentials.PasswordVault,Windows.Security.Credentials,ContentType=WindowsRuntime]
$vault = New-Object Windows.Security.Credentials.PasswordVault
$payload = ConvertFrom-Json ([Console]::In.ReadToEnd())
try {
  $credential = $vault.Retrieve($payload.serviceName, $payload.profileId)
  $credential.RetrievePassword()
  [Console]::Out.Write($credential.Password)
  exit 0
} catch {
  exit 3
}
      `,
      profileId,
    );

    return parseStoredSecret(result.stdout);
  }

  async save(profileId: string, secret: SavedSecret): Promise<void> {
    await this.execute(
      `
[void][Windows.Security.Credentials.PasswordVault,Windows.Security.Credentials,ContentType=WindowsRuntime]
$vault = New-Object Windows.Security.Credentials.PasswordVault
$payload = ConvertFrom-Json ([Console]::In.ReadToEnd())
try {
  $existing = $vault.Retrieve($payload.serviceName, $payload.profileId)
  $vault.Remove($existing)
} catch {}
$credential = New-Object Windows.Security.Credentials.PasswordCredential($payload.serviceName, $payload.profileId, $payload.secret)
$vault.Add($credential)
      `,
      profileId,
      secret,
    );
  }

  async delete(profileId: string): Promise<void> {
    try {
      await this.execute(
        `
[void][Windows.Security.Credentials.PasswordVault,Windows.Security.Credentials,ContentType=WindowsRuntime]
$vault = New-Object Windows.Security.Credentials.PasswordVault
$payload = ConvertFrom-Json ([Console]::In.ReadToEnd())
try {
  $credential = $vault.Retrieve($payload.serviceName, $payload.profileId)
  $vault.Remove($credential)
  exit 0
} catch {
  exit 3
}
        `,
        profileId,
      );
    } catch (error) {
      if (error instanceof SecretStoreError && error.code === "NOT_FOUND") {
        return;
      }
      throw error;
    }
  }

  private async execute(
    script: string,
    profileId: string,
    secret?: SavedSecret,
  ): Promise<CommandResult> {
    try {
      const stdin = JSON.stringify({
        serviceName: this.serviceName,
        profileId,
        ...(secret ? { secret: serializeSecret(secret) } : {}),
      });
      const result = await this.runner(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-Command", script.trim()],
        { stdin },
      );
      if (result.exitCode === 3) {
        throw new SecretStoreError(
          `No saved credentials found for profile '${profileId}'.`,
          "NOT_FOUND",
        );
      }
      if (result.exitCode !== 0) {
        throw new SecretStoreError(
          result.stderr.trim() || "Windows Credential Manager command failed.",
          "OPERATION_FAILED",
        );
      }
      return result;
    } catch (error) {
      throw normalizeRunnerError(error, "Windows Credential Manager is unavailable.");
    }
  }
}

function serializeSecret(secret: SavedSecret): string {
  return JSON.stringify(secret);
}

function parseStoredSecret(serializedSecret: string): SavedSecret {
  const parsed = JSON.parse(serializedSecret) as unknown;
  if (
    !parsed ||
    typeof parsed !== "object" ||
    !("username" in parsed) ||
    !("password" in parsed) ||
    typeof parsed.username !== "string" ||
    typeof parsed.password !== "string"
  ) {
    throw new SecretStoreError("Stored credentials are invalid.", "OPERATION_FAILED");
  }

  return {
    username: parsed.username,
    password: parsed.password,
  };
}

function normalizeRunnerError(error: unknown, unavailableMessage: string): SecretStoreError {
  if (error instanceof SecretStoreError) {
    return error;
  }
  if (
    error &&
    typeof error === "object" &&
    "code" in error &&
    typeof error.code === "string" &&
    error.code === "ENOENT"
  ) {
    return new SecretStoreError(unavailableMessage, "UNAVAILABLE");
  }

  return new SecretStoreError(
    error instanceof Error ? error.message : "Credential-store command failed.",
    "OPERATION_FAILED",
  );
}

async function runCommand(
  command: string,
  args: string[],
  options: {
    stdin?: string;
  } = {},
): Promise<CommandResult> {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: "pipe",
    });

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
      finish(() => reject(new Error("Credential-store command timed out after 30000ms.")));
    }, 30000);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");

    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", (error) => finish(() => reject(error)));
    child.stdin.on("error", (error) => finish(() => reject(error)));
    child.on("close", (exitCode) => {
      finish(() =>
        resolve({
          stdout,
          stderr,
          exitCode: exitCode ?? 1,
        }),
      );
    });

    if (options.stdin) {
      child.stdin.write(options.stdin);
    }
    child.stdin.end();
  });
}
