import { describe, expect, it } from "vitest";

import { type SecretStoreError, createSecretStore } from "../src/secret_store.js";

describe("createSecretStore", () => {
  it("uses macOS Keychain commands for darwin", async () => {
    const calls: Array<{ command: string; args: string[] }> = [];
    const store = createSecretStore(
      "darwin",
      async (command, args) => {
        calls.push({ command, args });
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
      args: [
        "add-generic-password",
        "-U",
        "-s",
        "com.example.kibana",
        "-a",
        "prod",
        "-w",
        '{"username":"elastic","password":"secret"}',
      ],
    });
    expect(calls[1]?.args.slice(0, 5)).toEqual([
      "find-generic-password",
      "-s",
      "com.example.kibana",
      "-a",
      "prod",
    ]);
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
