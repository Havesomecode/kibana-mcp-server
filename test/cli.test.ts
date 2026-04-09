import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";

import { runCli } from "../src/cli.js";

describe("runCli", () => {
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
});
