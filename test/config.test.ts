import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import {
  PROFILE_NAME_ENV,
  loadConfigFromEnvironment,
  parseAppConfig,
  resolveSourceCatalogPath,
} from "../src/config.js";
import { resolveProfilePaths } from "../src/profile_paths.js";
import { ProfileStore } from "../src/profile_store.js";

const tempDirectories: string[] = [];

describe("parseAppConfig", () => {
  it("parses valid environment and source catalog inputs", () => {
    const config = parseAppConfig(
      {
        KIBANA_BASE_URL: "https://kibana.example.com/",
        KIBANA_USERNAME: "elastic",
        KIBANA_PASSWORD: "secret",
      },
      {
        sources: [
          {
            id: "app-logs",
            name: "Application logs",
            tags: ["application"],
            timeField: "@timestamp",
            backend: {
              kind: "kibana_internal_search_es",
              path: "/internal/search/es",
              index: "app-logs-*",
            },
            schema: {
              kind: "kibana_data_views_fields",
              path: "/api/data_views/fields_for_wildcard",
              index: "app-logs-*",
            },
          },
        ],
      },
    );

    expect(config.kibana.baseUrl).toBe("https://kibana.example.com");
    expect(config.kibana.timeoutMs).toBe(10000);
    expect(config.sources[0]?.id).toBe("app-logs");
    expect(config.sources[0]?.schema?.kind).toBe("kibana_data_views_fields");
  });

  it("accepts schema metadata without an explicit path when the index is provided", () => {
    const config = parseAppConfig(
      {
        KIBANA_BASE_URL: "https://kibana.example.com",
        KIBANA_USERNAME: "elastic",
        KIBANA_PASSWORD: "secret",
      },
      {
        sources: [
          {
            id: "workflow-metrics",
            name: "Workflow metrics",
            tags: ["workflow"],
            timeField: "@timestamp",
            backend: {
              kind: "kibana_internal_search_es",
              path: "/internal/search/es",
              index: "workflow-metrics-*",
            },
            schema: {
              kind: "kibana_data_views_fields",
              index: "workflow-metrics-*",
            },
          },
        ],
      },
    );

    expect(config.sources[0]?.schema?.kind).toBe("kibana_data_views_fields");
    expect(config.sources[0]?.schema?.path).toBeUndefined();
    expect(config.sources[0]?.schema?.index).toBe("workflow-metrics-*");
  });

  it("rejects missing credentials", () => {
    expect(() =>
      parseAppConfig(
        {
          KIBANA_BASE_URL: "https://kibana.example.com",
          KIBANA_USERNAME: "",
          KIBANA_PASSWORD: "secret",
        },
        {
          sources: [
            {
              id: "app-logs",
              name: "Application logs",
              tags: ["application"],
              timeField: "@timestamp",
              backend: {
                kind: "elasticsearch_search",
                path: "/app-logs/_search",
              },
            },
          ],
        },
      ),
    ).toThrow();
  });

  it("defaults the source catalog path to the runtime file", () => {
    expect(resolveSourceCatalogPath({})).toBe("config/sources.runtime.json");
    expect(
      resolveSourceCatalogPath({
        KIBANA_SOURCE_CATALOG_PATH: "config/custom.json",
      } as NodeJS.ProcessEnv),
    ).toBe("config/custom.json");
  });

  it("loads a saved default profile when no bootstrap environment is present", async () => {
    const root = await mkdtemp(join(tmpdir(), "kibana-config-"));
    tempDirectories.push(root);
    const paths = resolveProfilePaths({ KIBANA_STATE_DIR: root } as NodeJS.ProcessEnv);
    const store = new ProfileStore(paths);
    const sourceCatalogPath = join(paths.sourceCatalogsDir, "prod.json");

    await mkdir(paths.sourceCatalogsDir, { recursive: true });
    await writeFile(
      sourceCatalogPath,
      JSON.stringify(
        {
          sources: [
            {
              id: "app_logs",
              name: "Application logs",
              tags: ["application"],
              timeField: "@timestamp",
              backend: {
                kind: "kibana_internal_search_es",
                path: "/internal/search/es",
                index: ["app-logs-*"],
              },
              fieldHints: [],
              defaultTextFields: ["message"],
              evidenceFields: [],
            },
          ],
        },
        null,
        2,
      ),
      "utf8",
    );
    await store.upsertProfile(
      {
        id: "prod",
        name: "prod",
        baseUrl: "https://kibana.example.com",
        timeoutMs: 10000,
        sourceCatalogPath,
      },
      {
        makeDefault: true,
      },
    );

    const config = await loadConfigFromEnvironment(
      {},
      {
        profileStore: store,
        secretStore: {
          async load() {
            return { username: "elastic", password: "secret" };
          },
        },
      },
    );

    expect(config.profileName).toBe("prod");
    expect(config.kibana.username).toBe("elastic");
    expect(config.sourceCatalogPath).toBe(sourceCatalogPath);
    expect(config.sources[0]?.id).toBe("app_logs");
  });

  it("lets an explicit profile name override the default profile", async () => {
    const root = await mkdtemp(join(tmpdir(), "kibana-config-"));
    tempDirectories.push(root);
    const paths = resolveProfilePaths({ KIBANA_STATE_DIR: root } as NodeJS.ProcessEnv);
    const store = new ProfileStore(paths);
    const stagingCatalogPath = join(paths.sourceCatalogsDir, "staging.json");

    await mkdir(paths.sourceCatalogsDir, { recursive: true });
    await writeFile(
      stagingCatalogPath,
      JSON.stringify(
        {
          sources: [
            {
              id: "staging_logs",
              name: "Staging logs",
              tags: ["staging"],
              timeField: "@timestamp",
              backend: {
                kind: "kibana_internal_search_es",
                path: "/internal/search/es",
              },
              fieldHints: [],
              defaultTextFields: ["message"],
              evidenceFields: [],
            },
          ],
        },
        null,
        2,
      ),
      "utf8",
    );
    await store.upsertProfile(
      {
        id: "prod",
        name: "prod",
        baseUrl: "https://prod.example.com",
        timeoutMs: 10000,
        sourceCatalogPath: join(paths.sourceCatalogsDir, "prod.json"),
      },
      {
        makeDefault: true,
      },
    );
    await store.upsertProfile({
      id: "staging",
      name: "staging",
      baseUrl: "https://staging.example.com",
      timeoutMs: 10000,
      sourceCatalogPath: stagingCatalogPath,
    });

    const config = await loadConfigFromEnvironment(
      {
        [PROFILE_NAME_ENV]: "staging",
      } as NodeJS.ProcessEnv,
      {
        profileStore: store,
        secretStore: {
          async load(profileId) {
            return { username: profileId, password: "secret" };
          },
        },
      },
    );

    expect(config.profileName).toBe("staging");
    expect(config.kibana.baseUrl).toBe("https://staging.example.com");
    expect(config.kibana.username).toBe("staging");
    expect(config.sources[0]?.id).toBe("staging_logs");
  });
});

describe("loadConfigFromEnvironment", () => {
  it("loads config when KIBANA_TIMEOUT_MS is present", async () => {
    const catalogDirectory = await mkdtemp(join(tmpdir(), "kibana-mcp-server-"));
    tempDirectories.push(catalogDirectory);
    const sourceCatalogPath = join(catalogDirectory, "sources.json");

    await writeFile(
      sourceCatalogPath,
      JSON.stringify(
        {
          sources: [
            {
              id: "app-logs",
              name: "Application logs",
              tags: ["application"],
              timeField: "@timestamp",
              backend: {
                kind: "kibana_internal_search_es",
                path: "/internal/search/es",
                index: "app-logs-*",
              },
            },
          ],
        },
        null,
        2,
      ),
      "utf8",
    );

    const config = await loadConfigFromEnvironment({
      KIBANA_BASE_URL: "https://kibana.example.com/",
      KIBANA_USERNAME: "elastic",
      KIBANA_PASSWORD: "secret",
      KIBANA_TIMEOUT_MS: "2500",
      KIBANA_SOURCE_CATALOG_PATH: sourceCatalogPath,
    } as NodeJS.ProcessEnv);

    expect(config.kibana.baseUrl).toBe("https://kibana.example.com");
    expect(config.kibana.timeoutMs).toBe(2500);
    expect(config.sources).toHaveLength(1);
    expect(config.sources[0]?.id).toBe("app-logs");
  });
});

afterAll(async () => {
  await Promise.all(
    tempDirectories.map((directory) => rm(directory, { recursive: true, force: true })),
  );
});
