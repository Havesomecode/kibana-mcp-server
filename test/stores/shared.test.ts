import { afterEach, describe, expect, it, vi } from "vitest";

import {
  describeStoreUrl,
  importDriver,
  quoteSqlIdentifier,
  resolveStoreUrl,
} from "../../src/stores/shared.js";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("resolveStoreUrl", () => {
  it("prefers the explicit URL, then KIBANA_STORE_URL, then the backend variables", () => {
    vi.stubEnv("KIBANA_STORE_URL", "redis://store-env:6379");
    vi.stubEnv("REDIS_URL", "redis://backend-env:6379");

    expect(
      resolveStoreUrl("Redis", " redis://explicit:6379 ", ["REDIS_URL"], ["redis:"]).host,
    ).toBe("explicit:6379");
    expect(resolveStoreUrl("Redis", undefined, ["REDIS_URL"], ["redis:"]).host).toBe(
      "store-env:6379",
    );

    vi.stubEnv("KIBANA_STORE_URL", "");
    expect(resolveStoreUrl("Redis", undefined, ["REDIS_URL"], ["redis:"]).host).toBe(
      "backend-env:6379",
    );
  });

  it("explains a missing, malformed or mismatched URL", () => {
    vi.stubEnv("KIBANA_STORE_URL", "");
    vi.stubEnv("REDIS_URL", "");

    expect(() => resolveStoreUrl("Redis", undefined, ["REDIS_URL"], ["redis:"])).toThrow(
      "pass 'url', or set KIBANA_STORE_URL or REDIS_URL",
    );
    expect(() => resolveStoreUrl("Redis", "not a url", [], ["redis:"])).toThrow("not a valid URL");
    expect(() => resolveStoreUrl("Redis", "http://localhost", [], ["redis:", "rediss:"])).toThrow(
      "must use redis:// or rediss://",
    );
  });
});

describe("describeStoreUrl", () => {
  it("drops credentials and query parameters from the reported location", () => {
    expect(
      describeStoreUrl(new URL("postgres://user:secret@db.internal:5432/app?sslmode=require")),
    ).toBe("postgres://db.internal:5432/app");
    expect(describeStoreUrl(new URL("redis://:secret@cache:6379/"))).toBe("redis://cache:6379");
  });
});

describe("quoteSqlIdentifier", () => {
  it("quotes plain and schema-qualified names and refuses anything else", () => {
    expect(quoteSqlIdentifier("catalogs")).toBe('"catalogs"');
    expect(quoteSqlIdentifier("ops.catalogs_v2")).toBe('"ops"."catalogs_v2"');
    for (const name of ['x"; DROP TABLE y; --', "a b", "1table", "a.b.c", "", "a."]) {
      expect(() => quoteSqlIdentifier(name)).toThrow("Invalid table name");
    }
  });
});

describe("importDriver", () => {
  it("names the package to install when the driver is missing", async () => {
    await expect(importDriver("Example", "kibana-mcp-missing-driver")).rejects.toThrow(
      "The Example catalog store requires the 'kibana-mcp-missing-driver' package",
    );
  });
});
