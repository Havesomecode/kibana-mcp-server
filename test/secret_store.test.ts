import { describe, expect, it } from "vitest";

import { type SecretStoreError, createSecretStore } from "../src/profiles/secret_store.js";

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
      args: ["-i"],
      stdin: `add-generic-password -U -s "com.example.kibana" -a "prod" -X ${Buffer.from(JSON.stringify({ username: "elastic", password: "secret" })).toString("hex")}\n`,
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

  it("encodes special characters and Unicode without changing stored JSON", async () => {
    const secret = { username: "élastic 雪", password: "a\"'\\\n\r\t\0😀 $()`;" };
    const store = createSecretStore("darwin", async (_command, args, options) => {
      expect(args).toEqual(["-i"]);
      const line = options?.stdin ?? "";
      expect(line.split("\n")).toHaveLength(2);
      expect(line).toContain('-a "a\\"\\\\b"');
      const hex = line.match(/-X ([0-9a-f]+)\n$/)?.[1] ?? "";
      expect(JSON.parse(Buffer.from(hex, "hex").toString("utf8"))).toEqual(secret);
      return { stdout: "", stderr: "", exitCode: 0 };
    });
    await store.save('a"\\b', secret);
  });

  it("reads the hex output security uses for stored UTF-8 credentials", async () => {
    const secret = { username: "élastic 雪", password: "😀" };
    const store = createSecretStore("darwin", async () => ({
      stdout: `${Buffer.from(JSON.stringify(secret)).toString("hex")}\n`,
      stderr: "",
      exitCode: 0,
    }));
    await expect(store.load("prod")).resolves.toEqual(secret);
  });

  it("rejects oversized commands and identifier injection before running security", async () => {
    let calls = 0;
    const store = createSecretStore("darwin", async () => {
      calls += 1;
      return { stdout: "", stderr: "", exitCode: 0 };
    });
    for (const profile of ["prod\nhelp", "prod\rhelp", "prod\0help"]) {
      await expect(store.save(profile, { username: "user", password: "test" })).rejects.toThrow();
    }
    await expect(
      store.save("prod", { username: "user", password: "雪".repeat(1000) }),
    ).rejects.toThrow("too long");
    expect(calls).toBe(0);
  });

  it("bounds the complete UTF-8 command including its newline before Apple's buffer limit", async () => {
    const secret = { username: "u", password: "p" };
    const hex = Buffer.from(JSON.stringify(secret)).toString("hex");
    const overhead = Buffer.byteLength(`add-generic-password -U -s "" -a "p" -X ${hex}\n`);
    let calls = 0;
    const runner = async (_command: string, _args: string[], options?: { stdin?: string }) => {
      calls += 1;
      expect(Buffer.byteLength(options?.stdin ?? "")).toBe(4095);
      return { stdout: "", stderr: "", exitCode: 0 };
    };
    const service = `é${"s".repeat(4095 - overhead - 2)}`;
    await createSecretStore("darwin", runner, service).save("p", secret);
    await expect(
      createSecretStore("darwin", runner, `${service}s`).save("p", secret),
    ).rejects.toThrow("too long");
    expect(calls).toBe(1);
  });

  it("does not expose native output or malformed stored credentials in errors", async () => {
    const marker = "sensitive-test-marker";
    const failing = createSecretStore("darwin", async () => ({
      stdout: marker,
      stderr: marker,
      exitCode: 1,
    }));
    await expect(failing.save("prod", { username: "user", password: marker })).rejects.toThrow(
      "macOS Keychain command failed (exit 1).",
    );
    const malformed = createSecretStore("darwin", async () => ({
      stdout: `{"password":"${marker}",`,
      stderr: "",
      exitCode: 0,
    }));
    await expect(malformed.load("prod")).rejects.toThrow("Stored credentials are invalid.");
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
