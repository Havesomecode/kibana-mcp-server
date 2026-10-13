import { spawn } from "node:child_process";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { createGeneratedCatalog } from "../dist/src/setup/bootstrap.js";

export async function verifyPluginInstall(sourcePluginRoot) {
  const installRoot = await mkdtemp(join(tmpdir(), "kibana-plugin-install-"));
  const pluginRoot = join(installRoot, "cached-plugin");
  let child;
  let lines;
  let timer;
  try {
    // Copy ONLY the published plugin, without the package's dist/ or node_modules.
    await cp(sourcePluginRoot, pluginRoot, { recursive: true });
    const config = JSON.parse(await readFile(join(pluginRoot, ".mcp.json"), "utf8"));
    const server = config.mcpServers?.["kibana-log-investigation"];
    if (
      server?.command !== "node" ||
      server.cwd !== "." ||
      JSON.stringify(server.args) !== JSON.stringify(["./mcp-launcher.mjs"])
    ) {
      throw new Error("Plugin must launch its local runtime with cwd set to the plugin root.");
    }
    const catalogPath = join(installRoot, "empty-sources.json");
    await writeFile(catalogPath, JSON.stringify(createGeneratedCatalog([])));
    const env = {
      PATH: process.env.PATH,
      SystemRoot: process.env.SystemRoot,
      WINDIR: process.env.WINDIR,
      HOME: installRoot,
      USERPROFILE: installRoot,
      KIBANA_STATE_DIR: join(installRoot, "state"),
      // Synthetic connection-only fixture. discover performs no backend request.
      KIBANA_BASE_URL: "http://127.0.0.1:1",
      KIBANA_USERNAME: "plugin-smoke-fixture",
      KIBANA_PASSWORD: "synthetic-test-value",
      KIBANA_SOURCE_CATALOG_PATH: catalogPath,
    };
    child = spawn(process.execPath, server.args, {
      cwd: resolve(pluginRoot, server.cwd),
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const exited = new Promise((resolveExit) => child.once("close", resolveExit));
    const pending = new Map();
    let failure;
    const fail = (error) => {
      failure ??= error;
      for (const { reject } of pending.values()) reject(error);
      pending.clear();
      child.kill();
    };
    child.on("error", (error) => fail(error));
    child.on("exit", (code, signal) => {
      if (pending.size) fail(new Error(`Plugin exited before responding (${code ?? signal}).`));
    });
    // Deliberately do not echo arbitrary startup stderr: it can contain operator secrets.
    let stderrBytes = 0;
    child.stderr.on("data", (chunk) => {
      stderrBytes += chunk.length;
      if (stderrBytes > 1024 * 1024) fail(new Error("Plugin startup stderr exceeded 1 MiB."));
    });
    let stdoutBytes = 0;
    child.stdout.on("data", (chunk) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes > 1024 * 1024) fail(new Error("Plugin stdout exceeded 1 MiB."));
    });
    lines = createInterface({ input: child.stdout });
    lines.on("line", (line) => {
      try {
        const response = JSON.parse(line);
        const request = pending.get(response.id);
        if (!request) return;
        pending.delete(response.id);
        if (response.error) request.reject(new Error("Plugin returned an MCP protocol error."));
        else request.resolve(response.result);
      } catch {
        fail(new Error("Plugin wrote non-JSON data to MCP stdout."));
      }
    });
    timer = setTimeout(
      () => fail(new Error("Installed plugin MCP handshake exceeded 10 seconds.")),
      10_000,
    );
    let id = 0;
    const request = (method, params = {}) => {
      if (failure) return Promise.reject(failure);
      return new Promise((resolveResponse, reject) => {
        const requestId = ++id;
        pending.set(requestId, { resolve: resolveResponse, reject });
        child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: requestId, method, params })}\n`);
      });
    };
    const initialized = await request("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "installed-plugin-verifier", version: "1.0.0" },
    });
    if (!initialized?.capabilities?.tools) throw new Error("Plugin did not advertise tools.");
    child.stdin.write(
      `${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`,
    );
    const listed = await request("tools/list");
    if (!listed?.tools?.some((tool) => tool.name === "discover")) {
      throw new Error("Installed plugin does not expose discover.");
    }
    const discovery = await request("tools/call", { name: "discover", arguments: {} });
    if (discovery?.isError || !discovery?.content?.length) {
      throw new Error("Installed plugin discover failed.");
    }
    const payload = discovery.structuredContent ?? JSON.parse(discovery.content[0].text);
    if (payload.configured_total !== 0 || payload.total !== 0 || payload.sources?.length !== 0) {
      throw new Error("Isolated plugin unexpectedly loaded operator state.");
    }
    child.stdin.end();
    child.kill();
    await exited;
    if (failure) throw failure;
    console.log(
      "Copied installed plugin: initialize, tools/list, discover passed without checkout dependencies.",
    );
  } finally {
    clearTimeout(timer);
    lines?.close();
    child?.kill();
    await rm(installRoot, { recursive: true, force: true });
  }
}
