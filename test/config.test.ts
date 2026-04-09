import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { loadConfigFromEnvironment, parseAppConfig, resolveSourceCatalogPath } from "../src/config.js";

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
});

describe("loadConfigFromEnvironment", () => {
  it("loads config when KIBANA_TIMEOUT_MS is present", async () => {
    const catalogDirectory = await mkdtemp(join(tmpdir(), "kibana-mcp-server-"));
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
