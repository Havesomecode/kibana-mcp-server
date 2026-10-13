import { CatalogConflictError, type CatalogStore } from "./catalog_store.js";

export const STORE_URL_ENV = "KIBANA_STORE_URL";
export const DEFAULT_KEY_PREFIX = "kibana-mcp:catalog:";
export const DEFAULT_TABLE_NAME = "kibana_mcp_catalogs";

/**
 * Resolves the connection URL of a store: the explicit option, then `KIBANA_STORE_URL`, then the
 * conventional variables of the backend.
 */
export function resolveStoreUrl(
  storeName: string,
  explicitUrl: string | undefined,
  fallbackEnvNames: string[],
  protocols: string[],
): URL {
  const url = resolveStoreConnectionString(storeName, explicitUrl, fallbackEnvNames, protocols);
  try {
    return new URL(url);
  } catch {
    throw new Error(`The ${storeName} catalog store URL is not a valid URL.`);
  }
}

/** Like resolveStoreUrl, but leaves backend-specific URI parsing to its driver. */
export function resolveStoreConnectionString(
  storeName: string,
  explicitUrl: string | undefined,
  fallbackEnvNames: string[],
  protocols: string[],
): string {
  const envNames = [STORE_URL_ENV, ...fallbackEnvNames];
  const url =
    explicitUrl?.trim() ||
    envNames.map((name) => process.env[name]?.trim()).find((value) => Boolean(value));
  if (!url) {
    throw new Error(
      `The ${storeName} catalog store needs a URL: pass 'url', or set ${envNames.join(" or ")}.`,
    );
  }

  const protocol = /^[a-z][a-z0-9+.-]*:/i.exec(url)?.[0].toLowerCase();
  if (!protocol) {
    throw new Error(`The ${storeName} catalog store URL is not a valid URL.`);
  }
  if (!protocols.includes(protocol)) {
    throw new Error(
      `The ${storeName} catalog store URL must use ${protocols.map((protocol) => `${protocol}//`).join(" or ")}.`,
    );
  }
  return url;
}

/** Location of a store without its credentials, for tool output. */
export function describeStoreUrl(url: URL): string {
  return `${url.protocol}//${url.host}${url.pathname === "/" ? "" : url.pathname}`;
}

export async function importDriver<T>(storeName: string, packageName: string): Promise<T> {
  try {
    return (await import(packageName)) as T;
  } catch (error) {
    throw new Error(
      `The ${storeName} catalog store requires the '${packageName}' package. Install it next to this server.`,
      { cause: error },
    );
  }
}

/** Quotes a possibly schema-qualified SQL identifier, refusing anything but plain names. */
export function quoteSqlIdentifier(name: string): string {
  const parts = name.split(".");
  if (parts.length > 2 || parts.some((part) => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(part))) {
    throw new Error(
      `Invalid table name '${name}': use letters, digits and underscores, optionally prefixed by a schema.`,
    );
  }
  return parts.map((part) => `"${part}"`).join(".");
}

// Writes only when the key still holds the content the caller read, so that several server
// processes sharing one Redis never overwrite each other's catalog changes.
export const REDIS_COMPARE_AND_SET_SCRIPT = `
local current = redis.call('GET', KEYS[1])
if ARGV[1] == '1' then
  if current ~= ARGV[2] then return 0 end
elseif current then
  return 0
end
redis.call('SET', KEYS[1], ARGV[3])
return 1
`;

export function createKeyValueCatalogStore(backend: {
  label: string;
  keyPrefix: string;
  get(key: string): Promise<string | null | undefined>;
  /** Runs {@link REDIS_COMPARE_AND_SET_SCRIPT} with `[hasExpected, expected, next]`. */
  compareAndSet(key: string, values: [string, string, string]): Promise<unknown>;
  close?(): Promise<void>;
}): CatalogStore {
  const keyOf = (profileKey: string) => `${backend.keyPrefix}${profileKey}`;
  const describe = (profileKey: string) => `${backend.label}/${keyOf(profileKey)}`;

  return {
    describe,
    async read(profileKey) {
      return (await backend.get(keyOf(profileKey))) ?? undefined;
    },
    async replace(profileKey, expected, next, signal) {
      signal?.throwIfAborted();
      const replaced = await backend.compareAndSet(keyOf(profileKey), [
        expected === undefined ? "0" : "1",
        expected ?? "",
        next,
      ]);
      if (Number(replaced) !== 1) {
        throw new CatalogConflictError(describe(profileKey));
      }
    },
    close: backend.close,
  };
}
