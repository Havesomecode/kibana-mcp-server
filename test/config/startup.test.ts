import { describe, expect, it } from "vitest";

import { resolveStartupConfiguration } from "../../src/config/startup.js";
import { createGeneratedCatalog } from "../../src/setup/bootstrap.js";
import type { CatalogStore } from "../../src/stores/catalog_store.js";
import { type HttpServerHandle, startHttpMcpServer } from "../../src/transports/http.js";
import type { SavedProfile } from "../../src/types.js";
import { callTool, source, sourceIds } from "../transports/helpers.js";

const connection = {
  KIBANA_BASE_URL: "https://kibana.example.com",
  KIBANA_USERNAME: "elastic",
  KIBANA_PASSWORD: "secret",
};

function savedProfiles(defaultProfileId: string | null = "production") {
  const profiles: SavedProfile[] = ["production", "staging"].map((id) => ({
    id,
    name: id === "staging" ? "Staging" : id,
    baseUrl: `https://${id}.kibana.example.com`,
    timeoutMs: 5000,
    sourceCatalogPath: `/catalogs/${id}.json`,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  }));
  const find = (query: string) =>
    profiles.find(
      (profile) =>
        profile.id === query.toLowerCase() || profile.name.toLowerCase() === query.toLowerCase(),
    ) ?? null;

  return {
    profileStore: {
      findProfile: async (query: string, options?: { exactName?: boolean }) =>
        options?.exactName
          ? (profiles.find((profile) => profile.name === query) ?? null)
          : find(query),
      getDefaultProfile: async () => (defaultProfileId ? find(defaultProfileId) : null),
    },
    secretStore: {
      load: async (profileId: string) => ({ username: profileId, password: "secret" }),
    },
    readFile: (async (path: unknown) =>
      JSON.stringify(
        createGeneratedCatalog([
          source(String(path).includes("staging") ? "staging-logs" : "orders"),
        ]),
      )) as never,
  };
}

function memoryStore(): CatalogStore & { closed: boolean } {
  return {
    closed: false,
    read: async () => undefined,
    replace: async () => {},
    async close() {
      this.closed = true;
    },
  };
}

describe("resolveStartupConfiguration", () => {
  it("serves a single catalog when the environment connection names one plain path", async () => {
    const { defaultConfig, loadProfileConfig } = await resolveStartupConfiguration(
      { ...connection, KIBANA_SOURCE_CATALOG_PATH: "/catalogs/all.json" },
      savedProfiles(),
    );

    expect(defaultConfig?.sourceCatalogPath).toBe("/catalogs/all.json");
    expect(defaultConfig?.sources.map((entry) => entry.id)).toEqual(["orders"]);
    expect(loadProfileConfig).toBeUndefined();
  });

  it("binds every profile to the store of the configuration file and closes it on shutdown", async () => {
    const store = memoryStore();

    const { defaultConfig, loadProfileConfig, close } = await resolveStartupConfiguration(
      { ...connection, KIBANA_PROFILE: "team" },
      { configFile: { path: "kibana.mcp.config.ts", config: {}, store } },
    );
    const alice = await loadProfileConfig?.("Alice");

    expect(defaultConfig?.profileName).toBe("team");
    expect(defaultConfig?.catalog?.location).toBe("team");
    expect(alice?.catalog?.location).toMatch(/^alice-[a-f0-9]{12}$/);
    expect(alice?.kibana.baseUrl).toBe("https://kibana.example.com");
    await close?.();
    expect(store.closed).toBe(true);
  });

  it("gives every profile its own filesystem-safe catalog path from the {profile} placeholder", async () => {
    const { defaultConfig, loadProfileConfig } = await resolveStartupConfiguration({
      ...connection,
      KIBANA_SOURCE_CATALOG_PATH: "/catalogs/{profile}.json",
    });
    const traversal = await loadProfileConfig?.("../../etc/passwd");
    const named = await resolveStartupConfiguration({
      ...connection,
      KIBANA_SOURCE_CATALOG_PATH: "/catalogs/{profile}.json",
      KIBANA_PROFILE: "team",
    });

    // No shared profile is assumed unless the operator names one.
    expect(defaultConfig).toBeUndefined();
    expect(named.defaultConfig?.catalog?.location).toBe("/catalogs/team.json");
    expect(traversal?.catalog?.location).toMatch(/^\/catalogs\/etc-passwd-[a-f0-9]{12}\.json$/);
    expect(traversal?.sourceCatalogPath).toBeUndefined();
  });

  it("loads the default saved profile and any saved profile by name or id", async () => {
    const { defaultConfig, loadProfileConfig } = await resolveStartupConfiguration(
      { KIBANA_TIMEOUT_MS: "2500", KIBANA_SOURCE_CATALOG_PATH: "/catalogs/override.json" },
      savedProfiles(),
    );
    const staging = await loadProfileConfig?.("Staging");

    expect(defaultConfig?.kibana.baseUrl).toBe("https://production.kibana.example.com");
    expect(defaultConfig?.sourceCatalogPath).toBe("/catalogs/override.json");
    // A named profile keeps its own catalog: the global override only applies to the default.
    expect(staging?.sourceCatalogPath).toBe("/catalogs/staging.json");
    expect(staging?.kibana).toMatchObject({
      baseUrl: "https://staging.kibana.example.com",
      username: "staging",
      timeoutMs: 2500,
    });
    await expect(loadProfileConfig?.("unknown")).rejects.toThrow(
      "Saved Kibana profile 'unknown' was not found",
    );
  });

  it("matches saved HTTP profiles exactly while startup keeps CLI case-insensitive selection", async () => {
    const { defaultConfig, loadProfileConfig } = await resolveStartupConfiguration(
      { KIBANA_PROFILE: "STAGING" },
      savedProfiles(),
    );
    expect(defaultConfig?.profileName).toBe("Staging");
    expect((await loadProfileConfig?.("Staging"))?.profileName).toBe("Staging");
    await expect(loadProfileConfig?.("staging")).rejects.toThrow("was not found");
    await expect(loadProfileConfig?.("STAGING")).rejects.toThrow("was not found");
  });

  it("falls back to the legacy unconfigured mode when no profile was ever saved", async () => {
    const unconfigured = await resolveStartupConfiguration({}, savedProfiles(null));
    expect(unconfigured.defaultConfig).toBeUndefined();
    expect(unconfigured.loadProfileConfig).toBeUndefined();
    await expect(
      resolveStartupConfiguration({ KIBANA_PROFILE: "unknown" }, savedProfiles()),
    ).rejects.toThrow("Saved Kibana profile 'unknown' was not found");
  });

  it("refuses incoherent combinations and releases the store it will not use", async () => {
    const store = memoryStore();
    const configFile = { path: "kibana.mcp.config.ts", config: {}, store };

    await expect(
      resolveStartupConfiguration(
        { ...connection, KIBANA_SOURCE_CATALOG_PATH: "/catalogs/{profile}.json" },
        { configFile },
      ),
    ).rejects.toThrow("cannot be combined with the store");
    expect(store.closed).toBe(true);
    await expect(resolveStartupConfiguration({}, { configFile })).rejects.toThrow(
      "require a Kibana url, user and password",
    );
    await expect(
      resolveStartupConfiguration({ KIBANA_SOURCE_CATALOG_PATH: "/catalogs/{profile}.json" }),
    ).rejects.toThrow("require a Kibana url, user and password");
    await expect(
      resolveStartupConfiguration({ KIBANA_BASE_URL: "https://kibana.example.com" }),
    ).rejects.toThrow("Incomplete Kibana bootstrap environment");
  });
});

describe("saved profiles behind the HTTP profile header", () => {
  it("serves each caller the connection and catalog of the saved profile it names", async () => {
    let handle: HttpServerHandle | undefined;
    try {
      handle = await startHttpMcpServer(
        {},
        { port: 0, profileHeader: "x-profile" },
        { startupConfiguration: await resolveStartupConfiguration({}, savedProfiles()) },
      );

      const production = await callTool(handle.url, "discover", { "X-Profile": "production" });
      const staging = await callTool(handle.url, "discover", { "X-Profile": "Staging" });
      const wrongCase = await callTool(handle.url, "discover", { "X-Profile": "STAGING" });
      expect(wrongCase.result?.isError).toBe(true);
      expect(JSON.stringify(wrongCase.result?.content)).toContain("was not found");
      const unknown = await callTool(handle.url, "discover", { "X-Profile": "nobody" });

      expect(sourceIds(production.result)).toEqual(["orders"]);
      expect(sourceIds(staging.result)).toEqual(["staging-logs"]);
      expect(unknown.result?.isError).toBe(true);
      expect(JSON.stringify(unknown.result?.content)).toContain("was not found");
    } finally {
      await handle?.close();
    }
  });
});
