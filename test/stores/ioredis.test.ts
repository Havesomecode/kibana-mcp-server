import { afterEach, describe, expect, it, vi } from "vitest";

import ioredisCatalogStore from "../../src/stores/ioredis.js";
import { compareAndSet, expectCatalogStoreContract } from "./contract.js";

class FakeIoredis {
  static instances: FakeIoredis[] = [];
  readonly values = new Map<string, string>();
  readonly listeners: string[] = [];
  connected = false;
  quitted = false;
  emitError: (error: Error) => void = () => {};

  constructor(
    readonly url?: string,
    readonly options?: { lazyConnect?: boolean },
  ) {
    FakeIoredis.instances.push(this);
  }

  on(event: string, listener: (error: Error) => void) {
    this.listeners.push(event);
    this.emitError = listener;
    return this;
  }

  async connect() {
    this.connected = true;
  }

  async get(key: string) {
    return this.values.get(key) ?? null;
  }

  async eval(_script: string, numberOfKeys: number, key: string, ...rest: string[]) {
    expect(numberOfKeys).toBe(1);
    return compareAndSet(this.values, key, rest);
  }

  async quit() {
    this.quitted = true;
    return "OK";
  }
}

afterEach(() => {
  FakeIoredis.instances = [];
  vi.doUnmock("ioredis");
  vi.unstubAllEnvs();
});

describe("ioredis catalog store", () => {
  it("fulfils the catalog store contract with a supplied client it does not own", async () => {
    const client = new FakeIoredis();
    const store = await ioredisCatalogStore({ client });

    await expectCatalogStoreContract(store);

    expect(client.values.has("kibana-mcp:catalog:alice")).toBe(true);
    expect(store.close).toBeUndefined();
    expect(client.connected).toBe(false);
  });

  it("opens, uses and closes its own client from the configured URL", async () => {
    vi.doMock("ioredis", () => ({ Redis: FakeIoredis }));
    vi.stubEnv("KIBANA_STORE_URL", "rediss://user:secret@cache.internal:6380/2");

    const store = await ioredisCatalogStore({ keyPrefix: "team:" });
    await expectCatalogStoreContract(store);
    await store.close?.();

    const [client] = FakeIoredis.instances;
    expect(client.url).toBe("rediss://user:secret@cache.internal:6380/2");
    expect(client.options).toEqual({ lazyConnect: true });
    expect(client.connected).toBe(true);
    expect(client.listeners).toEqual(["error"]);
    // A dropped connection must not take the process down.
    expect(() => client.emitError(new Error("ECONNRESET"))).not.toThrow();
    expect(client.values.has("team:alice")).toBe(true);
    expect(store.describe?.("alice")).toBe("rediss://cache.internal:6380/2/team:alice");
    expect(client.quitted).toBe(true);
  });

  it("refuses a URL that is not a Redis URL", async () => {
    await expect(ioredisCatalogStore({ url: "http://cache.internal" })).rejects.toThrow(
      "must use redis:// or rediss://",
    );
  });
});
