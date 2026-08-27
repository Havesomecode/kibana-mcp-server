import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";

import { runCli } from "../src/cli.js";

describe("runCli", () => {
  it("starts the MCP server without prompting when no command is supplied", async () => {
    let started = false;

    const exitCode = await runCli(
      [],
      { stdout: () => {}, stderr: () => {}, env: {} },
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
      ["setup"],
      {
        stdout: (text) => stdout.push(text),
        stderr: (text) => stderr.push(text),
        stdin: Readable.from("\nsecret\n\n"),
        stdinIsTTY: false,
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
        "bootstrap",
        "--profile",
        "prod",
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

  it("documents bootstrap as connection-only and does not expose index selection flags", async () => {
    const stdout: string[] = [];

    const exitCode = await runCli(["bootstrap", "--help"], {
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
      ["setup", "--profile", "default", "--client", "none"],
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

  it("reads a password from stdin without exposing it as a command argument", async () => {
    let password = "";
    const exitCode = await runCli(
      [
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
        stdin: Readable.from("stdin-secret\n"),
        env: {},
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
    expect(password).toBe("stdin-secret");
  });

  it("fails closed when bootstrap inputs are missing instead of prompting", async () => {
    const stderr: string[] = [];
    const exitCode = await runCli(
      ["bootstrap"],
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
      ["serve", "--profile", "staging"],
      { stdout: () => {}, stderr: () => {}, env: {} },
      {
        async startMcpServerFn(envInput) {
          receivedProfile = envInput?.KIBANA_PROFILE;
        },
      },
    );

    expect(exitCode).toBe(0);
    expect(receivedProfile).toBe("staging");
  });
});
