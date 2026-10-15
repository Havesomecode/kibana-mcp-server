import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  applyConfigFile,
  defineKibanaMcpConfig,
  loadConfigFile,
} from "../../src/config/config_file.js";
import { type HttpOidcOptions, oidcOptionsFromEnv } from "../../src/transports/oidc.js";

describe("loadConfigFile", () => {
  let directory: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "kibana-mcp-config-file-"));
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  async function write(name: string, content: string): Promise<string> {
    await writeFile(join(directory, name), content);
    return name;
  }

  it("loads nothing unless a file is named", async () => {
    expect(await loadConfigFile(undefined)).toBeUndefined();
    expect(await loadConfigFile("  ")).toBeUndefined();
  });

  it("resolves the path from the working directory and accepts an async function export", async () => {
    const name = await write(
      "function.config.mjs",
      `export default async () => ({
        url: "https://kibana.example.com",
        storeOptions: { prefix: "team:" },
        store: async (options) => ({
          read: async () => options.prefix,
          replace: async () => {},
        }),
      });`,
    );

    const loaded = await loadConfigFile(name, directory);

    expect(loaded?.path).toBe(join(directory, name));
    expect(loaded?.config.url).toBe("https://kibana.example.com");
    expect(await loaded?.store?.read("alice")).toBe("team:");
  });

  it("accepts a ready store object and a configuration without store", async () => {
    const withStore = await loadConfigFile(
      await write(
        "object.config.mjs",
        "export default { store: { read: async () => 'content', replace: async () => {} } };",
      ),
      directory,
    );
    const withoutStore = await loadConfigFile(
      await write("plain.config.mjs", "export default { user: 'elastic' };"),
      directory,
    );

    expect(await withStore?.store?.read("alice")).toBe("content");
    expect(withoutStore?.store).toBeUndefined();
    expect(withoutStore?.config.user).toBe("elastic");
  });

  it("explains a missing file, a broken file, a wrong export and an invalid store", async () => {
    await expect(loadConfigFile("missing.config.mjs", directory)).rejects.toThrow("was not found");
    await expect(
      loadConfigFile(await write("broken.config.mjs", "throw new Error('boom');"), directory),
    ).rejects.toThrow(/could not be loaded: boom\.$/);
    await expect(
      loadConfigFile(await write("broken.config.ts", "throw new Error('boom');"), directory),
    ).rejects.toThrow("otherwise use a .mjs file");
    for (const [name, content] of [
      ["empty.config.mjs", "export const other = 1;"],
      ["array.config.mjs", "export default [];"],
      ["scalar.config.mjs", "export default 'nope';"],
    ]) {
      await expect(loadConfigFile(await write(name, content), directory)).rejects.toThrow(
        "must default-export a configuration object",
      );
    }
    await expect(
      loadConfigFile(
        await write("store.config.mjs", "export default { store: { read: async () => '' } };"),
        directory,
      ),
    ).rejects.toThrow("store must implement read() and replace()");
    await expect(
      loadConfigFile(
        await write("null-store.config.mjs", "export default { store: () => null };"),
        directory,
      ),
    ).rejects.toThrow("store must implement read() and replace()");
  });
});

describe("applyConfigFile", () => {
  it("maps every option to its environment variable without overriding the environment", () => {
    const config = defineKibanaMcpConfig({
      url: "https://file.example.com",
      user: "file-user",
      password: "file-password",
      timeoutMs: 2000,
      profile: "team",
      http: {
        host: "0.0.0.0",
        port: 4000,
        path: "/kibana",
        profileHeader: "x-profile",
        authToken: "token",
      },
    });

    const merged = applyConfigFile(
      { KIBANA_USERNAME: "env-user", KIBANA_HTTP_PORT: " ", UNRELATED: "kept" },
      { path: "kibana.mcp.config.ts", config: config as never },
    );

    expect(merged).toEqual({
      UNRELATED: "kept",
      KIBANA_BASE_URL: "https://file.example.com",
      KIBANA_USERNAME: "env-user",
      KIBANA_PASSWORD: "file-password",
      KIBANA_TIMEOUT_MS: "2000",
      KIBANA_PROFILE: "team",
      KIBANA_HTTP_HOST: "0.0.0.0",
      KIBANA_HTTP_PORT: "4000",
      KIBANA_HTTP_PATH: "/kibana",
      KIBANA_HTTP_PROFILE_HEADER: "x-profile",
      KIBANA_HTTP_AUTH_TOKEN: "token",
    });
  });

  it("round-trips every OIDC option through the environment", () => {
    const oidc: Required<HttpOidcOptions> = {
      issuer: "https://sso.example.com/realms/acme",
      resource: "https://kibana-mcp.example.com/mcp",
      audience: "api://kibana-mcp",
      mode: "introspection",
      clientId: "kibana-mcp",
      clientSecret: "secret",
      requiredScopes: ["logs:read", "kibana,mcp"],
      scopesSupported: ["logs:read", "profile"],
      profileClaim: "preferred_username",
      allowInsecureRequests: true,
    };

    const env = applyConfigFile(
      { KIBANA_HTTP_OIDC_CLIENT_SECRET: "from-env" },
      { path: "c.ts", config: { http: { oidc } } },
    );

    expect(env).toMatchObject({
      KIBANA_HTTP_OIDC_REQUIRED_SCOPES: "logs:read kibana,mcp",
      KIBANA_HTTP_OIDC_ALLOW_INSECURE_REQUESTS: "true",
    });
    expect(oidcOptionsFromEnv(env)).toEqual({ ...oidc, clientSecret: "from-env" });
  });

  it("leaves the environment untouched for an empty configuration", () => {
    expect(applyConfigFile({ A: "1" }, { path: "c.ts", config: { url: "" } })).toEqual({ A: "1" });
  });
});
