#!/usr/bin/env node

import { existsSync } from "node:fs";

const bundle = new URL("./dist/mcp_entry.mjs", import.meta.url);

if (Number(process.versions.node.split(".")[0]) < 22) {
  console.error("Kibana MCP requires Node.js 22 or newer. Update Node.js before restarting Codex.");
  process.exitCode = 1;
} else if (!existsSync(bundle)) {
  console.error(
    "Kibana MCP plugin runtime is missing. Run npm ci and npm run build in the source checkout, " +
      "then reinstall the built plugin into Codex. Opening another discussion cannot repair this installation.",
  );
  process.exitCode = 1;
} else {
  try {
    await import(bundle.href);
  } catch (error) {
    const code = typeof error?.code === "string" ? error.code : "STARTUP_ERROR";
    console.error(
      `Kibana MCP plugin could not load (${code}). Rebuild and reinstall the plugin; inspect sanitized startup stderr if the failure persists. Do not share credentials.`,
    );
    process.exitCode = 1;
  }
}
