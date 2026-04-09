import { homedir } from "node:os";
import { join } from "node:path";

export const MACHINE_STATE_DIR_ENV = "KIBANA_STATE_DIR";
export const APP_STATE_DIRECTORY_NAME = "kibana-mcp-server";

export interface ProfilePaths {
  stateRoot: string;
  profilesPath: string;
  sourceCatalogsDir: string;
}

export function resolveMachineStateRoot(
  envInput: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  homeDirectory: string = homedir(),
): string {
  const explicitRoot = envInput[MACHINE_STATE_DIR_ENV]?.trim();
  if (explicitRoot) {
    return explicitRoot;
  }

  switch (platform) {
    case "darwin":
      return join(homeDirectory, "Library", "Application Support", APP_STATE_DIRECTORY_NAME);
    case "win32": {
      const appData = envInput.APPDATA?.trim();
      if (appData) {
        return join(appData, APP_STATE_DIRECTORY_NAME);
      }
      return join(homeDirectory, "AppData", "Roaming", APP_STATE_DIRECTORY_NAME);
    }
    default: {
      const xdgConfigHome = envInput.XDG_CONFIG_HOME?.trim();
      if (xdgConfigHome) {
        return join(xdgConfigHome, APP_STATE_DIRECTORY_NAME);
      }
      return join(homeDirectory, ".config", APP_STATE_DIRECTORY_NAME);
    }
  }
}

export function resolveProfilePaths(
  envInput: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  homeDirectory: string = homedir(),
): ProfilePaths {
  const stateRoot = resolveMachineStateRoot(envInput, platform, homeDirectory);

  return {
    stateRoot,
    profilesPath: join(stateRoot, "profiles.json"),
    sourceCatalogsDir: join(stateRoot, "source-catalogs"),
  };
}
