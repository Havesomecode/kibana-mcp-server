import type { CatalogStore } from "./catalog_store.js";
import {
  DEFAULT_KEY_PREFIX,
  REDIS_COMPARE_AND_SET_SCRIPT,
  createKeyValueCatalogStore,
  describeStoreUrl,
  importDriver,
  resolveStoreUrl,
} from "./shared.js";

export interface IoredisCatalogStoreOptions {
  /** `redis://` or `rediss://` URL. Defaults to `KIBANA_STORE_URL`, then `REDIS_URL`. */
  url?: string;
  /** Prefix of the catalog keys. Defaults to `kibana-mcp:catalog:`. */
  keyPrefix?: string;
  /** An `ioredis` client (standalone, Sentinel or Cluster) to use instead of `url`. The store never closes it. */
  client?: IoredisCatalogClient;
}

/** The subset of the `ioredis` client this store relies on. */
export interface IoredisCatalogClient {
  get(key: string): Promise<string | null>;
  eval(script: string, numberOfKeys: number, ...keysAndArguments: string[]): Promise<unknown>;
}

/**
 * Catalog store backed by Redis through the `ioredis` package: one key per profile, without
 * expiry. Use a Redis with persistence and a `noeviction` policy, catalogs are not a cache.
 *
 * Usable directly as `store` in the configuration file; its options come from `storeOptions`.
 */
export default async function ioredisCatalogStore(
  options: IoredisCatalogStoreOptions = {},
): Promise<CatalogStore> {
  let client = options.client;
  let label = "redis:";
  let close: (() => Promise<void>) | undefined;

  if (!client) {
    const url = resolveStoreUrl("ioredis", options.url, ["REDIS_URL"], ["redis:", "rediss:"]);
    const { Redis } = await importDriver<typeof import("ioredis")>("ioredis", "ioredis");
    const owned = new Redis(url.href, { lazyConnect: true });
    // Without a listener, a connection error would be reported as an unhandled error event.
    owned.on("error", () => {});
    await owned.connect();
    client = owned;
    label = describeStoreUrl(url);
    close = async () => {
      await owned.quit();
    };
  }

  const connected = client;
  return createKeyValueCatalogStore({
    label,
    keyPrefix: options.keyPrefix ?? DEFAULT_KEY_PREFIX,
    get: (key) => connected.get(key),
    compareAndSet: (key, values) => connected.eval(REDIS_COMPARE_AND_SET_SCRIPT, 1, key, ...values),
    close,
  });
}
