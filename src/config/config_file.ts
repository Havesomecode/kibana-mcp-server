import { access } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import type { CatalogStore } from "../stores/catalog_store.js";
import type { HttpOidcOptions } from "../transports/oidc.js";
import { PROFILE_NAME_ENV } from "./environment.js";

export { CatalogConflictError } from "../stores/catalog_store.js";
export type { CatalogStore } from "../stores/catalog_store.js";

export const CONFIG_FILE_ENV = "KIBANA_MCP_CONFIG";
export const HTTP_HOST_ENV = "KIBANA_HTTP_HOST";
export const HTTP_PORT_ENV = "KIBANA_HTTP_PORT";
export const HTTP_PATH_ENV = "KIBANA_HTTP_PATH";
export const HTTP_PROFILE_HEADER_ENV = "KIBANA_HTTP_PROFILE_HEADER";
export const HTTP_AUTH_TOKEN_ENV = "KIBANA_HTTP_AUTH_TOKEN";
export const HTTP_OIDC_ENV = {
  issuer: "KIBANA_HTTP_OIDC_ISSUER",
  resource: "KIBANA_HTTP_OIDC_RESOURCE",
  audience: "KIBANA_HTTP_OIDC_AUDIENCE",
  mode: "KIBANA_HTTP_OIDC_MODE",
  clientId: "KIBANA_HTTP_OIDC_CLIENT_ID",
  clientSecret: "KIBANA_HTTP_OIDC_CLIENT_SECRET",
  requiredScopes: "KIBANA_HTTP_OIDC_REQUIRED_SCOPES",
  scopesSupported: "KIBANA_HTTP_OIDC_SCOPES_SUPPORTED",
  profileClaim: "KIBANA_HTTP_OIDC_PROFILE_CLAIM",
  allowInsecureRequests: "KIBANA_HTTP_OIDC_ALLOW_INSECURE_REQUESTS",
} as const;

export type CatalogStoreFactory<TStoreOptions> = (
  options?: TStoreOptions,
) => CatalogStore | Promise<CatalogStore>;

export interface KibanaMcpConfig<TStoreOptions = Record<string, unknown>> {
  /** Kibana base URL. Overridden by `KIBANA_BASE_URL`. */
  url?: string;
  /** Kibana user. Overridden by `KIBANA_USERNAME`. */
  user?: string;
  /** Kibana password. Overridden by `KIBANA_PASSWORD`. */
  password?: string;
  /** Backend deadline in milliseconds. Overridden by `KIBANA_TIMEOUT_MS`. */
  timeoutMs?: number;
  /** Profile served when the transport names none. Overridden by `KIBANA_PROFILE`. */
  profile?: string;
  /**
   * Where the source catalogs are kept, one per profile: a store, or a store factory such as the
   * default export of `stores/redis`, called with `storeOptions`. Without it, catalogs are files.
   */
  store?: CatalogStore | CatalogStoreFactory<TStoreOptions>;
  /** Options handed to the `store` factory: connection, key prefix, anything the store defines. */
  storeOptions?: TStoreOptions;
  /** Streamable HTTP transport, used by `serve --http`. Flags and environment variables win. */
  http?: {
    host?: string;
    port?: number;
    path?: string;
    /** Header carrying the profile of the caller. */
    profileHeader?: string;
    /** Shared secret expected as `Authorization: Bearer <token>`. */
    authToken?: string;
    /**
     * OAuth 2.1 / OpenID Connect resource server: callers present an access token from `issuer`,
     * and their profile is read from a token claim. Excludes `authToken` and `profileHeader`.
     */
    oidc?: HttpOidcOptions;
  };
}

type KibanaMcpConfigExport<TStoreOptions> =
  | KibanaMcpConfig<TStoreOptions>
  | (() => KibanaMcpConfig<TStoreOptions> | Promise<KibanaMcpConfig<TStoreOptions>>);

/**
 * Types the default export of a `kibana.mcp.config.ts` file.
 */
export function defineKibanaMcpConfig<TStoreOptions = Record<string, unknown>>(
  config: KibanaMcpConfigExport<TStoreOptions>,
): KibanaMcpConfigExport<TStoreOptions> {
  return config;
}

export interface LoadedConfigFile {
  path: string;
  config: KibanaMcpConfig;
  store?: CatalogStore;
}

/**
 * Loads the configuration file named explicitly by the operator. The file is executed as code,
 * so it is never discovered implicitly from the working directory.
 */
export async function loadConfigFile(
  configPath: string | undefined,
  cwd: string = process.cwd(),
): Promise<LoadedConfigFile | undefined> {
  const requested = configPath?.trim();
  if (!requested) {
    return undefined;
  }

  const path = resolve(cwd, requested);
  await access(path).catch(() => {
    throw new Error(`Configuration file '${path}' was not found.`);
  });

  let exported: unknown;
  try {
    exported = ((await import(pathToFileURL(path).href)) as { default?: unknown }).default;
  } catch (error) {
    const hint = /\.[cm]?ts$/.test(path)
      ? " A TypeScript configuration needs a runtime that strips types (Node.js 22.18 or later); otherwise use a .mjs file."
      : "";
    throw new Error(
      `Configuration file '${path}' could not be loaded: ${error instanceof Error ? error.message : String(error)}.${hint}`,
      { cause: error },
    );
  }

  const config = (typeof exported === "function" ? await exported() : exported) as KibanaMcpConfig;
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    throw new Error(`Configuration file '${path}' must default-export a configuration object.`);
  }

  const store =
    typeof config.store === "function" ? await config.store(config.storeOptions) : config.store;
  if (
    store !== undefined &&
    (typeof store?.read !== "function" || typeof store?.replace !== "function")
  ) {
    throw new Error(`Configuration file '${path}': store must implement read() and replace().`);
  }

  return { path, config, store };
}

/**
 * Returns the environment completed with the values of the configuration file. Variables that are
 * already set win, so a deployment can override the file without editing it.
 */
export function applyConfigFile(
  envInput: NodeJS.ProcessEnv,
  { config }: LoadedConfigFile,
): NodeJS.ProcessEnv {
  const oidc = config.http?.oidc;
  const defaults: Record<string, string | number | boolean | undefined> = {
    KIBANA_BASE_URL: config.url,
    KIBANA_USERNAME: config.user,
    KIBANA_PASSWORD: config.password,
    KIBANA_TIMEOUT_MS: config.timeoutMs,
    [PROFILE_NAME_ENV]: config.profile,
    [HTTP_HOST_ENV]: config.http?.host,
    [HTTP_PORT_ENV]: config.http?.port,
    [HTTP_PATH_ENV]: config.http?.path,
    [HTTP_PROFILE_HEADER_ENV]: config.http?.profileHeader,
    [HTTP_AUTH_TOKEN_ENV]: config.http?.authToken,
  };
  for (const [key, name] of Object.entries(HTTP_OIDC_ENV)) {
    const value = oidc?.[key as keyof typeof HTTP_OIDC_ENV];
    defaults[name] = Array.isArray(value) ? value.join(" ") : value;
  }

  const env = { ...envInput };
  for (const [name, value] of Object.entries(defaults)) {
    if (value !== undefined && value !== "" && !env[name]?.trim()) {
      env[name] = String(value);
    }
  }
  return env;
}
