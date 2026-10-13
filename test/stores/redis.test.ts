import { afterEach, describe, expect, it, vi } from "vitest";

import redisCatalogStore from "../../src/stores/redis.js";
import { compareAndSet, expectCatalogStoreContract } from "./contract.js";

function fakeRedisClient() {
  const values = new Map<string, string>();
  return {
    values,
    listeners: [] as string[],
    emitError: (_error: Error) => {},
    connected: false,
    closed: false,
    on(event: string, listener: (error: Error) => void) {
      this.listeners.push(event);
      this.emitError = listener;
      return this;
    },
    async connect() {
      this.connected = true;
    },
    async get(key: string) {
      return values.get(key) ?? null;
    },
    async eval(_script: string, options: { keys: string[]; arguments: string[] }) {
      return compareAndSet(values, options.keys[0], options.arguments);
    },
    async close() {
      this.closed = true;
    },
  };
}

afterEach(() => {
  vi.doUnmock("redis");
  vi.unstubAllEnvs();
});

describe("redis catalog store", () => {
  it("fulfils the catalog store contract with a supplied client it does not own", async () => {
    const client = fakeRedisClient();
    const store = await redisCatalogStore({ client });

    await expectCatalogStoreContract(store);

    expect([...client.values.keys()].sort()).toEqual([
      "kibana-mcp:catalog:alice",
      "kibana-mcp:catalog:bob",
    ]);
    expect(store.close).toBeUndefined();
    expect(client.connected).toBe(false);
  });

  it("opens, uses and closes its own client from the configured URL", async () => {
    const client = fakeRedisClient();
    const createClient = vi.fn(() => client);
    vi.doMock("redis", () => ({ createClient }));
    vi.stubEnv("KIBANA_STORE_URL", "");
    vi.stubEnv("REDIS_URL", "redis://:secret@cache.internal:6379");

    const store = await redisCatalogStore({ keyPrefix: "team:" });
    await expectCatalogStoreContract(store);
    await store.close?.();

    expect(createClient).toHaveBeenCalledWith({ url: "redis://:secret@cache.internal:6379" });
    expect(client.connected).toBe(true);
    expect(client.listeners).toEqual(["error"]);
    // A dropped connection must not take the process down.
    expect(() => client.emitError(new Error("ECONNRESET"))).not.toThrow();
    expect(client.values.has("team:alice")).toBe(true);
    expect(store.describe?.("alice")).toBe("redis://cache.internal:6379/team:alice");
    expect(client.closed).toBe(true);
  });

  it("refuses a URL that is not a Redis URL", async () => {
    await expect(redisCatalogStore({ url: "http://cache.internal" })).rejects.toThrow(
      "must use redis:// or rediss://",
    );
  });
});
