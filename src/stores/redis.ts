import type { CatalogStore } from "./catalog_store.js";
import {
  DEFAULT_KEY_PREFIX,
  REDIS_COMPARE_AND_SET_SCRIPT,
  createKeyValueCatalogStore,
  describeStoreUrl,
  importDriver,
  resolveStoreUrl,
} from "./shared.js";

export interface RedisCatalogStoreOptions {
  /** `redis://` or `rediss://` URL. Defaults to `KIBANA_STORE_URL`, then `REDIS_URL`. */
  url?: string;
  /** Prefix of the catalog keys. Defaults to `kibana-mcp:catalog:`. */
  keyPrefix?: string;
  /** A connected `redis` client to use instead of `url`. The store never closes it. */
  client?: RedisCatalogClient;
}

/** The subset of the `redis` client this store relies on. */
export interface RedisCatalogClient {
  get(key: string): Promise<string | null>;
  eval(script: string, options: { keys: string[]; arguments: string[] }): Promise<unknown>;
}

/**
 * Catalog store backed by Redis through the `redis` package: one key per profile, without expiry.
 * Use a Redis with persistence and a `noeviction` policy, catalogs are not a cache.
 *
 * Usable directly as `store` in the configuration file; its options come from `storeOptions`.
 */
export default async function redisCatalogStore(
  options: RedisCatalogStoreOptions = {},
): Promise<CatalogStore> {
  let client = options.client;
  let label = "redis:";
  let close: (() => Promise<void>) | undefined;

  if (!client) {
    const url = resolveStoreUrl("Redis", options.url, ["REDIS_URL"], ["redis:", "rediss:"]);
    const redis = await importDriver<typeof import("redis")>("Redis", "redis");
    const owned = redis.createClient({ url: url.href });
    // Without a listener, a connection error would crash the process instead of failing the call.
    owned.on("error", () => {});
    await owned.connect();
    client = owned;
    label = describeStoreUrl(url);
    close = () => owned.close();
  }

  const connected = client;
  return createKeyValueCatalogStore({
    label,
    keyPrefix: options.keyPrefix ?? DEFAULT_KEY_PREFIX,
    get: (key) => connected.get(key),
    compareAndSet: (key, values) =>
      connected.eval(REDIS_COMPARE_AND_SET_SCRIPT, { keys: [key], arguments: values }),
    close,
  });
}
