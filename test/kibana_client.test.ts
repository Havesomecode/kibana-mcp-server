import { afterEach, describe, expect, it, vi } from "vitest";

import { KibanaClient } from "../src/kibana_client.js";
import type { AppConfig, CompiledSourceQuery, SourceDefinition } from "../src/types.js";

const source: SourceDefinition = {
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
  fieldHints: [],
  defaultTextFields: ["message"],
  evidenceFields: [],
};

const config: AppConfig["kibana"] = {
  baseUrl: "https://kibana.example.com",
  username: "elastic",
  password: "secret",
  timeoutMs: 1000,
};

describe("KibanaClient", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("verifies only the Kibana connection without touching an index", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(JSON.stringify({ status: { overall: { level: "available" } } })),
      );

    await new KibanaClient(config).verifyConnection();

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy).toHaveBeenCalledWith(
      "https://kibana.example.com/api/status",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("rejects a successful JSON response that is not a Kibana status envelope", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({})));

    await expect(new KibanaClient(config).verifyConnection()).rejects.toThrow(
      "valid Kibana status response",
    );
  });

  it("accepts the legacy Kibana overall.state status envelope", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ status: { overall: { state: "green" } } })),
    );

    await expect(new KibanaClient(config).verifyConnection()).resolves.toBeUndefined();
  });

  it("sends kibana internal search requests with auth and kbn-xsrf", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          rawResponse: {
            hits: {
              total: { value: 1 },
              hits: [],
            },
          },
        }),
        { status: 200 },
      ),
    );

    const client = new KibanaClient(config);
    const compiledQuery: CompiledSourceQuery = {
      source,
      resolvedFilters: [],
      resolvedNestedFilters: [],
      resolvedSortBy: "@timestamp",
      advisories: [],
      request: {
        body: {
          size: 0,
        },
      },
    };

    const result = await client.execute(compiledQuery);

    expect(result.source.id).toBe("app-logs");
    expect(fetchSpy).toHaveBeenCalledWith(
      "https://kibana.example.com/internal/search/es",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "Content-Type": "application/json",
          "kbn-xsrf": "kibana-mcp-server",
        }),
      }),
    );
  });

  it("unwraps nested raw responses", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          response: {
            rawResponse: {
              hits: {
                total: { value: 2 },
                hits: [],
              },
            },
          },
        }),
        { status: 200 },
      ),
    );

    const client = new KibanaClient(config);
    const result = await client.execute({
      source,
      resolvedFilters: [],
      resolvedNestedFilters: [],
      resolvedSortBy: "@timestamp",
      advisories: [],
      request: { body: { size: 0 } },
    });

    expect(result.rawResponse.hits).toBeDefined();
  });

  it("describes fields through Kibana wildcard field metadata", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          fields: [
            {
              name: "event",
              type: "text",
              searchable: true,
              aggregatable: false,
            },
            {
              name: "event.keyword",
              type: "keyword",
              searchable: true,
              aggregatable: true,
              subType: {
                multi: {
                  parent: "event",
                },
              },
            },
          ],
        }),
        { status: 200 },
      ),
    );

    const client = new KibanaClient(config);
    const result = await client.describeFields(source);
    const calledUrl = new URL(String(fetchSpy.mock.calls[0]?.[0]));

    expect(result.map((field) => field.name)).toEqual(["event", "event.keyword"]);
    expect(calledUrl.origin + calledUrl.pathname).toBe(
      "https://kibana.example.com/api/data_views/fields_for_wildcard",
    );
    expect(calledUrl.searchParams.get("pattern")).toBe("app-logs-*");
    expect(calledUrl.searchParams.get("allow_no_index")).toBe("true");
    expect(calledUrl.searchParams.getAll("meta_fields")).toEqual([
      "_source",
      "_id",
      "_index",
      "_score",
    ]);
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({
          "kbn-xsrf": "kibana-mcp-server",
        }),
      }),
    );
  });

  it("falls back to the search transport when every schema metadata endpoint returns 404", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("not found", { status: 404 }))
      .mockResolvedValueOnce(new Response("not found", { status: 404 }))
      .mockResolvedValueOnce(new Response("not found", { status: 404 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            rawResponse: {
              hits: {
                total: { value: 1 },
                hits: [
                  {
                    _source: {
                      event: "CACHE_REFRESH_PHASES",
                      steps: [
                        {
                          name: "CACHE_REFRESH",
                          duration_ms: 42,
                        },
                      ],
                    },
                    fields: {
                      "event.keyword": ["CACHE_REFRESH_PHASES"],
                      "@timestamp": ["2026-04-03T10:00:00.000Z"],
                    },
                  },
                ],
              },
            },
          }),
          { status: 200 },
        ),
      );

    const client = new KibanaClient(config);
    const result = await client.describeFields(source);

    expect(fetchSpy).toHaveBeenCalledTimes(4);
    expect(String(fetchSpy.mock.calls[3]?.[0])).toBe(
      "https://kibana.example.com/internal/search/es",
    );
    expect(result.find((field) => field.name === "event")?.preferred_exact_field).toBe(
      "event.keyword",
    );
    expect(result.find((field) => field.name === "@timestamp")?.type).toBe("date");
    expect(result.find((field) => field.name === "steps.name")?.nested_path).toBe(undefined);
    expect(result.find((field) => field.name === "steps.name")?.object_array_path).toBe("steps");
    expect(result.find((field) => field.name === "steps.duration_ms")?.object_array_path).toBe(
      "steps",
    );
  });

  it("fails clearly when schema backend configuration is missing", async () => {
    const client = new KibanaClient(config);

    await expect(
      client.describeFields({
        ...source,
        schema: undefined,
      }),
    ).rejects.toThrow("does not configure a schema backend");
  });
});
