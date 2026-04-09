import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { sourceCatalogSchema } from "./config.js";
import { type ProfilePaths, resolveProfilePaths } from "./profile_paths.js";
import { ProfileStore, deriveProfileId } from "./profile_store.js";
import { type SecretStore, SecretStoreError, createSecretStore } from "./secret_store.js";

const DEFAULT_TIMEOUT_MS = 10000;
const KNOWN_ENDPOINT_PATHS = [
  "/internal/search/es",
  "/api/data_views/fields_for_wildcard",
  "/api/index_patterns/_fields_for_wildcard",
];

export interface SetupPrompter {
  info(message: string): void | Promise<void>;
  prompt(
    message: string,
    options?: {
      defaultValue?: string;
      secret?: boolean;
    },
  ): Promise<string>;
  confirm(message: string, defaultValue?: boolean): Promise<boolean>;
}

export interface SetupFlowResult {
  defaultProfileName: string;
  profiles: string[];
  sourceCatalogPaths: string[];
}

export async function runSetupFlow(
  prompter: SetupPrompter,
  dependencies: {
    profileStore?: ProfileStore;
    secretStore?: SecretStore;
    cwd?: string;
    paths?: ProfilePaths;
    readFile?: typeof readFile;
    writeFile?: typeof writeFile;
    mkdir?: typeof mkdir;
  } = {},
): Promise<SetupFlowResult> {
  const paths = dependencies.paths ?? resolveProfilePaths();
  const profileStore = dependencies.profileStore ?? new ProfileStore(paths);
  const secretStore = dependencies.secretStore ?? createSecretStore();
  const readFileImpl = dependencies.readFile ?? readFile;
  const writeFileImpl = dependencies.writeFile ?? writeFile;
  const mkdirImpl = dependencies.mkdir ?? mkdir;
  const cwd = dependencies.cwd ?? process.cwd();

  const savedProfileNames: string[] = [];
  const savedCatalogPaths: string[] = [];

  await prompter.info(
    "Guided setup will save one machine-level Kibana profile and reuse it in later threads.",
  );

  let continueAddingProfiles = true;
  while (continueAddingProfiles) {
    const existingProfiles = await profileStore.listProfiles();
    const profileName = await promptForProfileName(
      prompter,
      existingProfiles.map((profile) => profile.name),
    );
    const existingProfile = existingProfiles.find(
      (profile) => profile.name.toLowerCase() === profileName.toLowerCase(),
    );
    const profileId =
      existingProfile?.id ??
      deriveProfileId(
        profileName,
        existingProfiles.map((profile) => profile.id),
      );
    const baseUrl = await promptForBaseUrl(prompter);
    const username = await promptForRequiredValue(prompter, "Kibana username");
    const password = await promptForRequiredValue(prompter, "Kibana password", { secret: true });
    const importPath = await promptForSourceCatalogPath(prompter, cwd);
    const importedCatalogPath = join(paths.sourceCatalogsDir, `${profileId}.json`);

    await copyValidatedSourceCatalog(importPath, importedCatalogPath, {
      readFile: readFileImpl,
      writeFile: writeFileImpl,
      mkdir: mkdirImpl,
    });

    try {
      await secretStore.save(profileId, { username, password });
    } catch (error) {
      if (error instanceof SecretStoreError) {
        throw new Error(`Could not save Kibana credentials securely: ${error.message}`);
      }
      throw error;
    }

    const profile = await profileStore.upsertProfile(
      {
        id: profileId,
        name: profileName,
        baseUrl,
        timeoutMs: DEFAULT_TIMEOUT_MS,
        sourceCatalogPath: importedCatalogPath,
      },
      {
        makeDefault: existingProfiles.length === 0,
      },
    );

    if (existingProfiles.length > 0) {
      const makeDefault = await prompter.confirm(
        `Make '${profile.name}' the default environment for new threads?`,
        false,
      );
      if (makeDefault) {
        await profileStore.setDefaultProfile(profile.id);
      }
    }

    savedProfileNames.push(profile.name);
    savedCatalogPaths.push(importedCatalogPath);

    continueAddingProfiles = await prompter.confirm("Add another environment now?", false);
  }

  const defaultProfile = await profileStore.getDefaultProfile();
  if (!defaultProfile) {
    throw new Error("Setup completed without a saved default profile.");
  }

  return {
    defaultProfileName: defaultProfile.name,
    profiles: savedProfileNames,
    sourceCatalogPaths: savedCatalogPaths,
  };
}

async function promptForProfileName(
  prompter: SetupPrompter,
  existingNames: string[],
): Promise<string> {
  while (true) {
    const value = (await prompter.prompt("Environment name", { defaultValue: "default" })).trim();
    if (!value) {
      continue;
    }
    if (!/^[A-Za-z0-9][A-Za-z0-9 _-]*$/.test(value)) {
      await prompter.info(
        "Use letters, numbers, spaces, dashes, or underscores for the environment name.",
      );
      continue;
    }
    if (existingNames.some((candidate) => candidate.toLowerCase() === value.toLowerCase())) {
      const overwrite = await prompter.confirm(
        `An environment named '${value}' already exists. Update it with new credentials and sources?`,
        true,
      );
      if (!overwrite) {
        continue;
      }
    }
    return value;
  }
}

async function promptForBaseUrl(prompter: SetupPrompter): Promise<string> {
  while (true) {
    const rawValue = (await prompter.prompt("Kibana base URL")).trim();
    try {
      const parsed = new URL(rawValue);
      const normalizedBaseUrl = parsed.toString().replace(/\/+$/, "");
      if (KNOWN_ENDPOINT_PATHS.some((path) => parsed.pathname.includes(path))) {
        await prompter.info(
          "Enter the Kibana base URL only. Do not include endpoint paths such as /internal/search/es.",
        );
        continue;
      }
      return normalizedBaseUrl;
    } catch {
      await prompter.info(
        "Enter a valid URL such as https://kibana.example.com or https://gateway.example.com/logs.",
      );
    }
  }
}

async function promptForRequiredValue(
  prompter: SetupPrompter,
  label: string,
  options: {
    secret?: boolean;
  } = {},
): Promise<string> {
  while (true) {
    const value = (await prompter.prompt(label, options)).trim();
    if (value) {
      return value;
    }
    await prompter.info(`${label} is required.`);
  }
}

async function promptForSourceCatalogPath(prompter: SetupPrompter, cwd: string): Promise<string> {
  const bundledCatalogPath = await resolveBundledSourceCatalogPath();

  while (true) {
    const rawValue = (
      await prompter.prompt("Source catalog path to import", {
        defaultValue: bundledCatalogPath,
      })
    ).trim();
    const importPath = rawValue ? resolve(cwd, rawValue) : bundledCatalogPath;

    try {
      await access(importPath);
      return importPath;
    } catch {
      await prompter.info(
        `Source catalog not found at ${importPath}. Use a JSON file or accept the bundled example.`,
      );
    }
  }
}

async function copyValidatedSourceCatalog(
  importPath: string,
  destinationPath: string,
  io: {
    readFile: typeof readFile;
    writeFile: typeof writeFile;
    mkdir: typeof mkdir;
  },
): Promise<void> {
  const rawCatalog = await io.readFile(importPath, "utf8");
  const parsedCatalog = sourceCatalogSchema.parse(JSON.parse(rawCatalog) as unknown);

  await io.mkdir(dirname(destinationPath), { recursive: true });
  await io.writeFile(destinationPath, `${JSON.stringify(parsedCatalog, null, 2)}\n`, "utf8");
}

async function resolveBundledSourceCatalogPath(): Promise<string> {
  const candidates = [
    new URL("../config/sources.example.json", import.meta.url),
    new URL("../../config/sources.example.json", import.meta.url),
  ].map((candidate) => fileURLToPath(candidate));

  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {}
  }

  throw new Error("Bundled source catalog config/sources.example.json could not be found.");
}
