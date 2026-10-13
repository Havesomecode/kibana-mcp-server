import type { ProfileConfigLoader } from "../profiles/runtime.js";
import { type CatalogStore, bindCatalogStore } from "../stores/catalog_store.js";
import { createFileCatalogStore } from "../stores/file.js";
import type { ResolvedAppConfig } from "../types.js";
import {
  CONFIG_FILE_ENV,
  type LoadedConfigFile,
  applyConfigFile,
  loadConfigFile,
} from "./config_file.js";
import {
  NoSavedProfileError,
  PROFILE_NAME_ENV,
  PROFILE_PLACEHOLDER,
  loadConfigFromEnvironment,
  readBootstrapConnection,
} from "./environment.js";

/** Profile served over stdio when per-profile catalogs are configured and none is named. */
export const DEFAULT_PROFILE_NAME = "default";

export interface StartupConfiguration {
  defaultConfig?: ResolvedAppConfig;
  loadProfileConfig?: ProfileConfigLoader;
  /** Releases what the configuration opened, such as the catalog store. */
  close: () => Promise<void>;
}

/**
 * Loads the configuration file named by `KIBANA_MCP_CONFIG`, if any, and resolves the startup
 * configuration from the environment completed with its values.
 */
export async function loadStartupConfiguration(
  envInput: NodeJS.ProcessEnv = process.env,
): Promise<{ env: NodeJS.ProcessEnv; startupConfiguration: StartupConfiguration }> {
  const configFile = await loadConfigFile(envInput[CONFIG_FILE_ENV]);
  const env = configFile ? applyConfigFile(envInput, configFile) : envInput;
  return { env, startupConfiguration: await resolveStartupConfiguration(env, { configFile }) };
}

/**
 * Resolves what the server serves by default and, when the configuration allows it, how to load
 * the configuration of a named profile on demand.
 *
 * Named profiles come from either the saved profile store, or from one connection shared by every
 * profile whose catalogs live in a catalog store: the `store` of the configuration file, or files
 * when `KIBANA_SOURCE_CATALOG_PATH` carries the `{profile}` placeholder.
 */
export async function resolveStartupConfiguration(
  envInput: NodeJS.ProcessEnv = process.env,
  dependencies: Parameters<typeof loadConfigFromEnvironment>[1] & {
    configFile?: LoadedConfigFile;
  } = {},
): Promise<StartupConfiguration> {
  const customStore = dependencies.configFile?.store;
  const close = async () => {
    await customStore?.close?.();
  };

  try {
    return { ...(await resolveConfiguration(envInput, dependencies, customStore)), close };
  } catch (error) {
    await close().catch(() => {});
    throw error;
  }
}

async function resolveConfiguration(
  envInput: NodeJS.ProcessEnv,
  dependencies: Parameters<typeof loadConfigFromEnvironment>[1],
  customStore: CatalogStore | undefined,
): Promise<Omit<StartupConfiguration, "close">> {
  const kibana = readBootstrapConnection(envInput);
  const requestedProfileName = envInput[PROFILE_NAME_ENV]?.trim();
  const catalogPath = envInput.KIBANA_SOURCE_CATALOG_PATH?.trim();
  const catalogPathTemplate = catalogPath?.includes(PROFILE_PLACEHOLDER) ? catalogPath : undefined;

  if (customStore && catalogPath) {
    throw new Error(
      "KIBANA_SOURCE_CATALOG_PATH cannot be combined with the store of the configuration file.",
    );
  }

  if (kibana) {
    const store =
      customStore ??
      (catalogPathTemplate
        ? createFileCatalogStore((profileKey) =>
            catalogPathTemplate.replaceAll(PROFILE_PLACEHOLDER, profileKey),
          )
        : undefined);
    if (!store) {
      return { defaultConfig: await loadConfigFromEnvironment(envInput, dependencies) };
    }

    // Sources are read from the store when the profile is resolved, not here.
    const loadProfileConfig: ProfileConfigLoader = async (profileName) => ({
      kibana,
      sources: [],
      profileName,
      catalog: bindCatalogStore(store, profileName),
    });

    // No profile is assumed here: a transport serving several callers must not fall back to a
    // catalog shared by all of them unless the operator named it.
    return {
      defaultConfig: requestedProfileName
        ? await loadProfileConfig(requestedProfileName)
        : undefined,
      loadProfileConfig,
    };
  }

  if (customStore || catalogPathTemplate) {
    throw new Error(
      "Per-profile catalogs (a store, or {profile} in KIBANA_SOURCE_CATALOG_PATH) require a Kibana url, user and password.",
    );
  }

  // Named saved profiles carry their own catalog: the global catalog override is not applied.
  const loadProfileConfig: ProfileConfigLoader = (profileName) =>
    loadConfigFromEnvironment(
      { KIBANA_TIMEOUT_MS: envInput.KIBANA_TIMEOUT_MS, [PROFILE_NAME_ENV]: profileName },
      dependencies,
    );

  try {
    return {
      defaultConfig: await loadConfigFromEnvironment(envInput, dependencies),
      loadProfileConfig,
    };
  } catch (error) {
    if (error instanceof NoSavedProfileError) {
      return {};
    }
    throw error;
  }
}
