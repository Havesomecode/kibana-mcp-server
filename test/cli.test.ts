import { Readable } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { runCli } from "../src/bin/run_cli.js";
import { PromptCancelledError } from "../src/utils/cli_prompts.js";

const connectionEnv = {
  KIBANA_BASE_URL: "https://kibana.example.com",
  KIBANA_USERNAME: "elastic",
  KIBANA_PASSWORD: " env-secret ",
};
const bootstrapResult = {
  profileName: "default",
  profileId: "default",
  sourceCount: 0,
  sourceCatalogPath: "/tmp/default.json",
  client: "codex" as const,
  registered: true,
  verified: true,
};

describe("runCli", () => {
  it("starts the MCP server without prompting when no command is supplied", async () => {
    let started = false;

    const exitCode = await runCli(
      [],
      {
        stdout: () => {},
        stderr: () => {},
        env: {},
      },
      {
        async startMcpServerFn() {
          started = true;
        },
      },
    );

    expect(exitCode).toBe(0);
    expect(started).toBe(true);
  });

  it("consumes non-interactive setup stdin deterministically", async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];

    const exitCode = await runCli(
      ["node", "kibana-mcp-server", "setup"],
      {
        stdout: (text) => stdout.push(text),
        stderr: (text) => stderr.push(text),
        stdin: Readable.from("\nsecret\n\n"),
        stdinIsTTY: false,
        env: connectionEnv,
      },
      {
        async runSetupFlowFn(promptIo) {
          const environmentName = await promptIo.prompt("Environment name", {
            defaultValue: "default",
          });
          const password = await promptIo.prompt("Kibana password", {
            secret: true,
          });
          const addAnother = await promptIo.confirm("Add another environment now?", false);

          expect(environmentName).toBe("default");
          expect(password).toBe("secret");
          expect(addAnother).toBe(false);

          return {
            defaultProfileName: environmentName,
            profiles: [environmentName],
            sourceCatalogPaths: ["/tmp/default.json"],
          };
        },
      },
    );

    expect(exitCode).toBe(0);
    expect(stderr).toEqual([]);
    expect(stdout).toContain("Environment name [default]:");
    expect(stdout).toContain("Kibana password:");
    expect(stdout).toContain("Add another environment now? [y/N]:");
    expect(stdout).toContain("Saved 1 environment. Default environment: default.");
  });

  it("runs a prompt-free connection-only bootstrap from environment values", async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    let received: Record<string, unknown> | undefined;

    const exitCode = await runCli(
      [
        "node",
        "kibana-mcp-server",
        "bootstrap",
        "--profile",
        "prod",
        "--url",
        "https://kibana.example.com",
        "--username",
        "elastic",
        "--password-env",
        "KIBANA_PASSWORD",
        "--client",
        "codex",
        "--package",
        "github:Havesomecode/kibana-mcp-server#df3f520",
        "--mcp-name",
        "kibana-live",
        "--replace",
      ],
      {
        stdout: (text) => stdout.push(text),
        stderr: (text) => stderr.push(text),
        stdin: Readable.from(""),
        env: {
          KIBANA_BASE_URL: "https://kibana.example.com",
          KIBANA_USERNAME: "elastic",
          KIBANA_PASSWORD: "secret",
        },
      },
      {
        async runBootstrapFn(options) {
          received = options as unknown as Record<string, unknown>;
          return {
            profileName: options.profileName,
            profileId: "prod",
            sourceCount: 0,
            sourceCatalogPath: "/tmp/prod.json",
            client: options.client,
            registered: true,
            verified: true,
          };
        },
      },
    );

    expect(exitCode).toBe(0);
    expect(stderr).toEqual([]);
    expect(received).toMatchObject({
      profileName: "prod",
      baseUrl: "https://kibana.example.com",
      username: "elastic",
      password: "secret",
      client: "codex",
      packageSpecifier: "github:Havesomecode/kibana-mcp-server#df3f520",
      mcpName: "kibana-live",
      makeDefault: true,
      replaceExisting: true,
    });
    expect(received).not.toHaveProperty("indexes");
    expect(stdout.join("\n")).not.toContain("secret");
    expect(stdout.join("\n")).toContain("Bootstrap verified");
  });

  it.each([undefined, " staging "])(
    "bootstraps without flags using connection environment values and profile %s",
    async (profile) => {
      const stdout: string[] = [];
      const runBootstrapFn = vi.fn().mockResolvedValue(bootstrapResult);
      const runSetupFlowFn = vi.fn();
      const exitCode = await runCli(
        ["node", "kibana-mcp-server", "bootstrap"],
        {
          env: { ...connectionEnv, KIBANA_PROFILE: profile },
          // A prompt must not consume stdin when all connection values are supplied.
          stdin: new Readable({
            read() {
              throw new Error("Unexpected stdin read");
            },
          }),
          stdout: (text) => stdout.push(text),
          stderr: () => {},
        },
        { runBootstrapFn, runSetupFlowFn },
      );

      expect(exitCode).toBe(0);
      expect(runSetupFlowFn).not.toHaveBeenCalled();
      expect(runBootstrapFn).toHaveBeenCalledExactlyOnceWith({
        profileName: profile?.trim() ?? "default",
        baseUrl: connectionEnv.KIBANA_BASE_URL,
        username: connectionEnv.KIBANA_USERNAME,
        password: connectionEnv.KIBANA_PASSWORD,
        client: "codex",
        makeDefault: true,
        replaceExisting: false,
        packageSpecifier: undefined,
        mcpName: undefined,
        timeoutMs: undefined,
      });
      expect(stdout.join("\n")).not.toContain(connectionEnv.KIBANA_PASSWORD);
      expect(stdout.join("\n")).toContain("No Kibana indexes were inspected or configured");
    },
  );

  it("prompts only for the connection when bootstrap has no flags or environment values", async () => {
    const stdout: string[] = [];
    const runBootstrapFn = vi.fn().mockResolvedValue(bootstrapResult);
    const runSetupFlowFn = vi.fn();
    const exitCode = await runCli(
      ["node", "kibana-mcp-server", "bootstrap"],
      {
        env: {},
        stdin: Readable.from("https://kibana.example.com\nelastic\nprompt-secret\n"),
        stdinIsTTY: false,
        stdout: (text) => stdout.push(text),
        stderr: () => {},
      },
      { runBootstrapFn, runSetupFlowFn },
    );

    expect(exitCode).toBe(0);
    expect(runSetupFlowFn).not.toHaveBeenCalled();
    expect(runBootstrapFn).toHaveBeenCalledWith(
      expect.objectContaining({
        baseUrl: "https://kibana.example.com",
        username: "elastic",
        password: "prompt-secret",
      }),
    );
    expect(stdout.slice(0, 3)).toEqual([
      "Kibana base URL:",
      "Kibana username:",
      "Kibana password:",
    ]);
    expect(stdout.join("\n")).not.toContain("prompt-secret");
  });

  it("registers setup and bootstrap separately with shared connection options", async () => {
    const stdout: string[] = [];
    expect(
      await runCli(["node", "kibana-mcp-server", "--help"], {
        stdout: (text) => stdout.push(text),
        stderr: () => {},
      }),
    ).toBe(0);
    expect(stdout.join("\n")).toMatch(/\n\s+setup\b/);
    expect(stdout.join("\n")).toMatch(/\n\s+bootstrap\b/);
    expect(stdout.join("\n")).not.toContain("setup|bootstrap");
    stdout.length = 0;
    expect(
      await runCli(["node", "kibana-mcp-server", "setup", "--help"], {
        stdout: (text) => stdout.push(text),
        stderr: () => {},
      }),
    ).toBe(0);
    expect(stdout.join("\n")).toContain("guided");
    expect(stdout.join("\n")).toContain("--url");
    expect(stdout.join("\n")).toContain("--password-stdin");
    expect(stdout.join("\n")).not.toContain("--index");
  });

  it("passes Commander-parsed equals, repeated, numeric and negated bootstrap options", async () => {
    const runBootstrapFn = vi.fn().mockResolvedValue(bootstrapResult);
    expect(
      await runCli(
        [
          "node",
          "kibana-mcp-server",
          "bootstrap",
          "--url=https://override.example.com",
          "--username=first",
          "--username=last",
          "--profile=prod",
          "--password-env=OTHER_SECRET",
          "--client=none",
          "--package=example@1.0.0",
          "--mcp-name=custom",
          "--timeout=120000",
          "--no-default",
        ],
        {
          env: { ...connectionEnv, OTHER_SECRET: " alternate-secret " },
          stdin: Readable.from(""),
          stdout: () => {},
          stderr: () => {},
        },
        { runBootstrapFn },
      ),
    ).toBe(0);
    expect(runBootstrapFn).toHaveBeenCalledExactlyOnceWith({
      profileName: "prod",
      baseUrl: "https://override.example.com",
      username: "last",
      password: " alternate-secret ",
      client: "none",
      packageSpecifier: "example@1.0.0",
      mcpName: "custom",
      timeoutMs: 120000,
      makeDefault: false,
      replaceExisting: false,
    });
  });

  it.each(["0", "-1", "120001", "1.5", "NaN", "Infinity", "bad", ""])(
    "rejects invalid bootstrap timeout %s before running bootstrap",
    async (timeout) => {
      const stderr: string[] = [];
      const runBootstrapFn = vi.fn();
      const exitCode = await runCli(
        ["node", "kibana-mcp-server", "bootstrap", `--timeout=${timeout}`],
        {
          env: connectionEnv,
          stdin: Readable.from(""),
          stdout: () => {},
          stderr: (text) => stderr.push(text),
        },
        { runBootstrapFn },
      );
      expect(exitCode).toBe(1);
      expect(runBootstrapFn).not.toHaveBeenCalled();
      expect(stderr.join("\n")).toContain("--timeout");
    },
  );

  it.each([
    ["--password-stdin", "--password-env", "OTHER_SECRET"],
    ["--password-env", "OTHER_SECRET", "--password-stdin"],
    ["--index", "logs-*"],
    ["--password", "argument-secret"],
  ])("rejects conflicting or unsupported bootstrap flags %j", async (...flags) => {
    const runBootstrapFn = vi.fn();
    expect(
      await runCli(
        ["node", "kibana-mcp-server", "bootstrap", ...flags],
        { env: connectionEnv, stdin: Readable.from(""), stdout: () => {}, stderr: () => {} },
        { runBootstrapFn },
      ),
    ).toBe(1);
    expect(runBootstrapFn).not.toHaveBeenCalled();
  });

  it("does not fall back to KIBANA_PASSWORD when an explicit password environment variable is missing", async () => {
    const runBootstrapFn = vi.fn();
    const stderr: string[] = [];
    expect(
      await runCli(
        ["node", "kibana-mcp-server", "bootstrap", "--password-env", "MISSING_SECRET"],
        {
          env: connectionEnv,
          stdin: Readable.from(""),
          stdout: () => {},
          stderr: (text) => stderr.push(text),
        },
        { runBootstrapFn },
      ),
    ).toBe(1);
    expect(runBootstrapFn).not.toHaveBeenCalled();
    expect(stderr.join("\n")).toContain("Kibana password is required");
    expect(stderr.join("\n")).not.toContain(connectionEnv.KIBANA_PASSWORD);
  });

  it("documents bootstrap as connection-only and does not expose index selection flags", async () => {
    const stdout: string[] = [];

    const exitCode = await runCli(["node", "kibana-mcp-server", "bootstrap", "--help"], {
      stdout: (text) => stdout.push(text),
      stderr: () => {},
    });

    expect(exitCode).toBe(0);
    expect(stdout.join("\n")).toContain("does not inspect or configure indexes");
    expect(stdout.join("\n")).not.toContain("--index");
    expect(stdout.join("\n")).not.toContain("--time-field");
  });

  it("accepts deterministic setup flags as a bootstrap-compatible alias", async () => {
    let called = false;
    const exitCode = await runCli(
      [
        "node",
        "kibana-mcp-server",
        "setup",
        "--profile",
        "default",
        "--url",
        "https://kibana.example.com",
        "--username",
        "elastic",
        "--password-env",
        "KIBANA_PASSWORD",
        "--client",
        "none",
      ],
      {
        stdout: () => {},
        stderr: () => {},
        env: {
          KIBANA_BASE_URL: "https://kibana.example.com",
          KIBANA_USERNAME: "elastic",
          KIBANA_PASSWORD: "secret",
        },
      },
      {
        async runBootstrapFn() {
          called = true;
          return {
            profileName: "default",
            profileId: "default",
            sourceCount: 0,
            sourceCatalogPath: "/tmp/consumer.json",
            client: "none" as const,
            registered: false,
            verified: true as const,
          };
        },
      },
    );

    expect(exitCode).toBe(0);
    expect(called).toBe(true);
  });

  it.each([
    [["--profile=prod"], { profileName: "prod" }],
    [["--url=https://override.example.com"], { baseUrl: "https://override.example.com" }],
    [["--username=first", "--username=last"], { username: "last" }],
    [["--password-stdin"], { password: " stdin-secret " }],
    [["--password-env=OTHER_SECRET"], { password: " alternate-secret " }],
    [["--timeout=120000"], { timeoutMs: 120000 }],
    [["--client=none"], { client: "none" }],
    [["--package=example@1.0.0"], { packageSpecifier: "example@1.0.0" }],
    [["--mcp-name=custom"], { mcpName: "custom" }],
    [["--replace"], { replaceExisting: true }],
    [["--no-default"], { makeDefault: false }],
  ] as const)(
    "uses connection-only setup for explicitly supplied options %j",
    async (flags, expected) => {
      const runBootstrapFn = vi.fn().mockResolvedValue(bootstrapResult);
      const runSetupFlowFn = vi.fn();
      const stdout: string[] = [];
      const stderr: string[] = [];
      const exitCode = await runCli(
        ["node", "kibana-mcp-server", "setup", ...flags],
        {
          env: {
            ...connectionEnv,
            KIBANA_PROFILE: " staging ",
            OTHER_SECRET: " alternate-secret ",
          },
          stdin: flags.some((flag) => flag === "--password-stdin")
            ? Readable.from(" stdin-secret \r\n")
            : new Readable({
                read() {
                  throw new Error("Unexpected stdin read");
                },
              }),
          stdout: (text) => stdout.push(text),
          stderr: (text) => stderr.push(text),
        },
        { runBootstrapFn, runSetupFlowFn },
      );

      expect(exitCode).toBe(0);
      expect(stderr).toEqual([]);
      expect(runSetupFlowFn).not.toHaveBeenCalled();
      expect(runBootstrapFn).toHaveBeenCalledExactlyOnceWith({
        profileName: "staging",
        baseUrl: connectionEnv.KIBANA_BASE_URL,
        username: connectionEnv.KIBANA_USERNAME,
        password: connectionEnv.KIBANA_PASSWORD,
        client: "codex",
        makeDefault: true,
        replaceExisting: false,
        packageSpecifier: undefined,
        mcpName: undefined,
        timeoutMs: undefined,
        ...expected,
      });
      expect(stdout.join("\n")).toContain("No Kibana indexes were inspected or configured");
      expect(stdout.join("\n")).not.toContain("secret");
    },
  );

  it.each([
    [["--timeout=0"], "--timeout"],
    [["--timeout=1.5"], "--timeout"],
    [["--client=invalid"], "Allowed choices are codex, none"],
    [["--password-stdin", "--password-env=OTHER_SECRET"], "cannot be used with"],
    [["--password-env=OTHER_SECRET", "--password-stdin"], "cannot be used with"],
    [["--password", "argument-secret"], "unknown option '--password'"],
    [["--index", "logs-*"], "unknown option '--index'"],
    [["--password-env=MISSING_SECRET"], "Kibana password is required"],
  ] as const)(
    "validates setup connection options %j before running bootstrap",
    async (flags, message) => {
      const runBootstrapFn = vi.fn();
      const runSetupFlowFn = vi.fn();
      const stderr: string[] = [];
      const exitCode = await runCli(
        ["node", "kibana-mcp-server", "setup", ...flags],
        {
          env: connectionEnv,
          stdin: Readable.from(""),
          stdout: () => {},
          stderr: (text) => stderr.push(text),
        },
        { runBootstrapFn, runSetupFlowFn },
      );

      expect(exitCode).toBe(1);
      expect(runBootstrapFn).not.toHaveBeenCalled();
      expect(runSetupFlowFn).not.toHaveBeenCalled();
      expect(stderr.join("\n")).toContain(message);
      expect(stderr.join("\n")).not.toContain(connectionEnv.KIBANA_PASSWORD);
    },
  );

  it("prompts only for missing connection values with setup options", async () => {
    const runBootstrapFn = vi.fn().mockResolvedValue(bootstrapResult);
    const runSetupFlowFn = vi.fn();
    const stdout: string[] = [];
    const exitCode = await runCli(
      ["node", "kibana-mcp-server", "setup", "--url=https://override.example.com"],
      {
        env: {},
        stdin: Readable.from("elastic\nprompt-secret\n"),
        stdinIsTTY: false,
        stdout: (text) => stdout.push(text),
        stderr: () => {},
      },
      { runBootstrapFn, runSetupFlowFn },
    );

    expect(exitCode).toBe(0);
    expect(runSetupFlowFn).not.toHaveBeenCalled();
    expect(runBootstrapFn).toHaveBeenCalledWith(
      expect.objectContaining({
        baseUrl: "https://override.example.com",
        username: "elastic",
        password: "prompt-secret",
      }),
    );
    expect(stdout.slice(0, 2)).toEqual(["Kibana username:", "Kibana password:"]);
    expect(stdout.join("\n")).not.toContain("prompt-secret");
  });

  it("preserves guided setup cancellation with connection environment values", async () => {
    const runBootstrapFn = vi.fn();
    const runSetupFlowFn = vi.fn().mockRejectedValue(new PromptCancelledError());
    const stderr: string[] = [];
    expect(
      await runCli(
        ["node", "kibana-mcp-server", "setup"],
        {
          env: connectionEnv,
          stdin: Readable.from(""),
          stdinIsTTY: false,
          stdout: () => {},
          stderr: (text) => stderr.push(text),
        },
        { runBootstrapFn, runSetupFlowFn },
      ),
    ).toBe(130);
    expect(runSetupFlowFn).toHaveBeenCalledOnce();
    expect(runBootstrapFn).not.toHaveBeenCalled();
    expect(stderr).toEqual([]);
  });

  it("reads a password from stdin without exposing it as a command argument", async () => {
    let password = "";
    const exitCode = await runCli(
      [
        "node",
        "kibana-mcp-server",
        "bootstrap",
        "--url",
        "https://kibana.example.com",
        "--username",
        "elastic",
        "--password-stdin",
        "--client",
        "none",
      ],
      {
        stdin: Readable.from(" stdin-secret \r\n"),
        env: connectionEnv,
        stdout: () => {},
        stderr: () => {},
      },
      {
        async runBootstrapFn(options) {
          password = options.password;
          return {
            profileName: options.profileName,
            profileId: "default",
            sourceCount: 0,
            sourceCatalogPath: "/tmp/default.json",
            client: options.client,
            registered: false,
            verified: true as const,
          };
        },
      },
    );

    expect(exitCode).toBe(0);
    expect(password).toBe(" stdin-secret ");
  });

  it("fails closed when non-interactive bootstrap inputs are missing", async () => {
    const stderr: string[] = [];
    const exitCode = await runCli(
      ["node", "kibana-mcp-server", "bootstrap", "--client", "none"],
      {
        stdin: Readable.from(""),
        env: {},
        stdout: () => {},
        stderr: (text) => stderr.push(text),
      },
      {},
    );

    expect(exitCode).toBe(1);
    expect(stderr.join("\n")).toContain("Kibana base URL is required");
  });

  it("passes --profile to serve without requiring an environment variable", async () => {
    let receivedProfile: string | undefined;
    const exitCode = await runCli(
      ["node", "kibana-mcp-server", "serve", "--profile", "staging"],
      {
        stdout: () => {},
        stderr: () => {},
        env: {},
      },
      {
        async startMcpServerFn(envInput) {
          receivedProfile = envInput?.KIBANA_PROFILE;
        },
      },
    );

    expect(exitCode).toBe(0);
    expect(receivedProfile).toBe("staging");
  });

  it("starts the HTTP transport with --http and rejects HTTP flags without it", async () => {
    let received: unknown;
    const stderr: string[] = [];
    const io = { stdout: () => {}, stderr: (text: string) => stderr.push(text), env: {} };

    const exitCode = await runCli(
      [
        "node",
        "kibana-mcp-server",
        "serve",
        "--http",
        "--port",
        "8123",
        "--profile-header",
        "x-profile",
      ],
      io,
      {
        async startHttpMcpServerFn(_env, options) {
          received = options;
          return { url: "http://127.0.0.1:8123/mcp", close: async () => {} };
        },
      },
    );
    const stdioExitCode = await runCli(["node", "kibana-mcp-server", "serve", "--port", "1"], io, {
      async startMcpServerFn() {},
    });

    expect(exitCode).toBe(0);
    expect(received).toMatchObject({ port: 8123, profileHeader: "x-profile" });
    expect(stdioExitCode).toBe(1);
    expect(stderr.join("\n")).toContain("require --http");
  });

  it("uses Commander validation for unrecognized CLI options", async () => {
    const stderr: string[] = [];

    const exitCode = await runCli(["node", "kibana-mcp-server", "serve", "--unknown"], {
      stdout: () => {},
      stderr: (text) => stderr.push(text),
      env: {},
    });

    expect(exitCode).toBe(1);
    expect(stderr.join("\n")).toContain("unknown option '--unknown'");
  });

  it("uses Commander validation for local bootstrap option constraints", async () => {
    const stderr: string[] = [];

    const exitCode = await runCli(
      ["node", "kibana-mcp-server", "bootstrap", "--client", "invalid"],
      {
        stdout: () => {},
        stderr: (text) => stderr.push(text),
        env: {},
      },
    );

    expect(exitCode).toBe(1);
    expect(stderr.join("\n").toLowerCase()).toContain("allowed choices are codex, none");
  });
});
