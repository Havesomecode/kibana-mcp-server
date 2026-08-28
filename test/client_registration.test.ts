import { describe, expect, it } from "vitest";

import { CodexClientRegistrar, deriveCodexRegistrationName } from "../src/client_registration.js";

interface CommandCall {
  command: string;
  args: string[];
}

const options = {
  mcpName: "kibana-log-investigation",
  profileName: "prod",
  packageSpecifier: "@havesomecode/kibana-mcp-server",
};
const registrationName = deriveCodexRegistrationName(options);

const expectedTransport = {
  name: registrationName,
  enabled: true,
  transport: {
    type: "stdio",
    command: "npx",
    args: ["-y", "@havesomecode/kibana-mcp-server", "serve", "--profile", "prod"],
    env: null,
    env_vars: [],
    cwd: null,
  },
};

describe("CodexClientRegistrar", () => {
  it("derives collision-free names from the exact transport", () => {
    expect(registrationName).toMatch(/^kibana-log-investigation-[a-f0-9]{12}$/);
    expect(deriveCodexRegistrationName({ ...options, profileName: "staging" })).not.toBe(
      registrationName,
    );
  });

  it("registers an absent MCP and verifies the exact transport by JSON readback", async () => {
    const calls: CommandCall[] = [];
    let getCount = 0;
    const registrar = new CodexClientRegistrar(options, async (command, args) => {
      calls.push({ command, args });
      if (args[1] === "get") {
        getCount += 1;
        return getCount === 1
          ? { exitCode: 1, stdout: "", stderr: "MCP server not found" }
          : { exitCode: 0, stdout: JSON.stringify(expectedTransport), stderr: "" };
      }
      return { exitCode: 0, stdout: "", stderr: "" };
    });

    await expect(registrar.preflight()).resolves.toEqual({ alreadyRegistered: false });
    await expect(registrar.register()).resolves.toEqual({ added: true });
    expect(calls).toEqual([
      { command: "codex", args: ["mcp", "get", registrationName, "--json"] },
      {
        command: "codex",
        args: [
          "mcp",
          "add",
          registrationName,
          "--",
          "npx",
          "-y",
          "@havesomecode/kibana-mcp-server",
          "serve",
          "--profile",
          "prod",
        ],
      },
      { command: "codex", args: ["mcp", "get", registrationName, "--json"] },
    ]);
  });

  it("treats an exact existing registration as idempotent", async () => {
    const registrar = new CodexClientRegistrar(options, async () => ({
      exitCode: 0,
      stdout: JSON.stringify(expectedTransport),
      stderr: "",
    }));

    await expect(registrar.preflight()).resolves.toEqual({ alreadyRegistered: true });
    await expect(registrar.register()).resolves.toEqual({ added: false });
  });

  it.each([
    {
      label: "disabled registration",
      config: { ...expectedTransport, enabled: false },
    },
    {
      label: "unknown transport option",
      config: {
        ...expectedTransport,
        transport: { ...expectedTransport.transport, unexpected: "foreign" },
      },
    },
  ])("refuses an otherwise matching $label", async ({ config }) => {
    const registrar = new CodexClientRegistrar(options, async () => ({
      exitCode: 0,
      stdout: JSON.stringify(config),
      stderr: "",
    }));

    await expect(registrar.preflight()).rejects.toThrow("transport differs");
  });

  it.each([
    { label: "working directory", overrides: { cwd: "/tmp/foreign" } },
    { label: "environment", overrides: { env: { KIBANA_STATE_DIR: "/tmp/other" } } },
    { label: "inherited environment", overrides: { env_vars: ["KIBANA_STATE_DIR"] } },
  ])("refuses an otherwise matching transport with a foreign $label", async ({ overrides }) => {
    const registrar = new CodexClientRegistrar(options, async () => ({
      exitCode: 0,
      stdout: JSON.stringify({
        ...expectedTransport,
        transport: { ...expectedTransport.transport, ...overrides },
      }),
      stderr: "",
    }));

    await expect(registrar.preflight()).rejects.toThrow("transport differs");
  });

  it("refuses to overwrite a different existing MCP registration", async () => {
    const registrar = new CodexClientRegistrar(options, async () => ({
      exitCode: 0,
      stdout: JSON.stringify({
        ...expectedTransport,
        transport: { ...expectedTransport.transport, command: "node", args: ["other.js"] },
      }),
      stderr: "",
    }));

    await expect(registrar.preflight()).rejects.toThrow("Refusing to overwrite");
  });

  it("does not remove a mismatched registration when ownership cannot be proven", async () => {
    const calls: CommandCall[] = [];
    let getCount = 0;
    const registrar = new CodexClientRegistrar(options, async (command, args) => {
      calls.push({ command, args });
      if (args[1] === "get") {
        getCount += 1;
        return getCount === 1
          ? { exitCode: 1, stdout: "", stderr: "not found" }
          : {
              exitCode: 0,
              stdout: JSON.stringify({
                ...expectedTransport,
                transport: { ...expectedTransport.transport, args: ["wrong"] },
              }),
              stderr: "",
            };
      }
      return { exitCode: 0, stdout: "", stderr: "" };
    });

    await registrar.preflight();
    await expect(registrar.register()).rejects.toThrow("readback did not match");
    expect(calls.some(({ args }) => args[1] === "remove")).toBe(false);
  });

  it("treats an ambiguous add as converged when exact readback is present", async () => {
    let registration: typeof expectedTransport | null = null;
    const calls: CommandCall[] = [];
    const registrar = new CodexClientRegistrar(options, async (command, args) => {
      calls.push({ command, args });
      if (args[1] === "get") {
        return registration
          ? { exitCode: 0, stdout: JSON.stringify(registration), stderr: "" }
          : { exitCode: 1, stdout: "", stderr: "not found" };
      }
      if (args[1] === "add") {
        registration = expectedTransport;
        throw new Error("command timed out");
      }
      if (args[1] === "remove") {
        registration = null;
        return { exitCode: 0, stdout: "", stderr: "" };
      }
      throw new Error(`unexpected command ${args.join(" ")}`);
    });

    await registrar.preflight();
    await expect(registrar.register()).resolves.toEqual({ added: true });
    expect(registration).toEqual(expectedTransport);
    expect(calls.some(({ args }) => args[1] === "remove")).toBe(false);
  });

  it("keeps rollback retryable until removal is confirmed", async () => {
    let removeAttempts = 0;
    let getCount = 0;
    const registrar = new CodexClientRegistrar(options, async (_command, args) => {
      if (args[1] === "get") {
        getCount += 1;
        if (getCount === 1) {
          return { exitCode: 1, stdout: "", stderr: "not found" };
        }
        return removeAttempts >= 2
          ? { exitCode: 1, stdout: "", stderr: "not found" }
          : { exitCode: 0, stdout: JSON.stringify(expectedTransport), stderr: "" };
      }
      if (args[1] === "add") {
        return { exitCode: 0, stdout: "", stderr: "" };
      }
      if (args[1] === "remove") {
        removeAttempts += 1;
        return removeAttempts === 1
          ? { exitCode: 1, stdout: "", stderr: "transient failure" }
          : { exitCode: 0, stdout: "", stderr: "" };
      }
      throw new Error(`unexpected command ${args.join(" ")}`);
    });

    await registrar.preflight();
    await registrar.register();
    await expect(registrar.rollback()).rejects.toThrow("Could not roll back");
    await expect(registrar.rollback()).resolves.toBeUndefined();
    expect(removeAttempts).toBe(2);
  });
});
