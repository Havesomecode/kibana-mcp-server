import { describe, expect, it } from "vitest";

import { type SecretStoreError, createSecretStore } from "../src/secret_store.js";

interface CommandCall {
  command: string;
  args: string[];
  stdin?: string;
}

describe("createSecretStore", () => {
  it("passes macOS Keychain secrets through stdin instead of process arguments", async () => {
    const calls: CommandCall[] = [];
    const store = createSecretStore(
      "darwin",
      async (command, args, options) => {
        calls.push({ command, args, stdin: options?.stdin });
        return {
          stdout:
            command === "security" && args[0] === "find-generic-password"
              ? '{"username":"elastic","password":"secret"}'
              : "",
          stderr: "",
          exitCode: 0,
        };
      },
      "com.example.kibana",
    );

    await store.save("prod", {
      username: "elastic",
      password: "secret",
    });
    const secret = await store.load("prod");

    expect(secret.username).toBe("elastic");
    expect(calls[0]).toEqual({
      command: "security",
      args: ["add-generic-password", "-U", "-s", "com.example.kibana", "-a", "prod", "-w"],
      stdin:
        '{"username":"elastic","password":"secret"}\n{"username":"elastic","password":"secret"}\n',
    });
    expect(calls[0]?.args.join(" ")).not.toContain("secret");
    expect(calls[1]?.args.slice(0, 5)).toEqual([
      "find-generic-password",
      "-s",
      "com.example.kibana",
      "-a",
      "prod",
    ]);
  });

  it("passes Windows Credential Manager secrets through stdin instead of process arguments", async () => {
    const calls: CommandCall[] = [];
    const store = createSecretStore(
      "win32",
      async (command, args, options) => {
        calls.push({ command, args, stdin: options?.stdin });
        return {
          stdout: args.join(" ").includes("[Console]::Out.Write")
            ? '{"username":"elastic","password":"secret"}'
            : "",
          stderr: "",
          exitCode: 0,
        };
      },
      "com.example.kibana",
    );

    await store.save("prod", { username: "elastic", password: "secret" });
    await expect(store.load("prod")).resolves.toEqual({
      username: "elastic",
      password: "secret",
    });

    expect(calls).toHaveLength(2);
    expect(calls[0]?.command).toBe("powershell.exe");
    expect(calls[0]?.args).not.toContain('{"username":"elastic","password":"secret"}');
    expect(calls[0]?.args).not.toContain("prod");
    expect(calls[0]?.args).not.toContain("com.example.kibana");
    expect(calls[0]?.args.join(" ")).not.toContain('"password":"secret"');
    expect(JSON.parse(calls[0]?.stdin ?? "{}")).toEqual({
      serviceName: "com.example.kibana",
      profileId: "prod",
      secret: '{"username":"elastic","password":"secret"}',
    });
    expect(JSON.parse(calls[1]?.stdin ?? "{}")).toEqual({
      serviceName: "com.example.kibana",
      profileId: "prod",
    });
    expect(calls[1]?.args).not.toContain("prod");
  });

  it("maps secret-tool exit 1 with empty stderr to a missing credential", async () => {
    const store = createSecretStore("linux", async (_command, args) => {
      expect(args[0]).toBe("lookup");
      return { stdout: "", stderr: "", exitCode: 1 };
    });

    await expect(store.load("prod")).rejects.toMatchObject({
      code: "NOT_FOUND",
    } satisfies Partial<SecretStoreError>);
  });

  it("surfaces unavailable credential stores clearly", async () => {
    const store = createSecretStore("linux", async () => {
      const error = new Error("missing");
      Object.assign(error, { code: "ENOENT" });
      throw error;
    });

    await expect(
      store.save("prod", { username: "elastic", password: "secret" }),
    ).rejects.toMatchObject({
      code: "UNAVAILABLE",
    } satisfies Partial<SecretStoreError>);
  });
});
