import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";

import { type ProfilePaths, resolveProfilePaths } from "./profile_paths.js";
import type { SavedProfile, SavedProfileStoreState } from "./types.js";

const PROFILE_STORE_VERSION = 1;

const savedProfileSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  baseUrl: z.url(),
  timeoutMs: z.number().int().positive().max(120000),
  sourceCatalogPath: z.string().min(1),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
});

const savedProfileStoreStateSchema = z.object({
  version: z.literal(PROFILE_STORE_VERSION),
  defaultProfileId: z.string().min(1).nullable(),
  profiles: z.array(savedProfileSchema),
});

export interface UpsertProfileInput {
  id?: string;
  name: string;
  baseUrl: string;
  timeoutMs: number;
  sourceCatalogPath: string;
}

const EMPTY_PROFILE_STORE: SavedProfileStoreState = {
  version: PROFILE_STORE_VERSION,
  defaultProfileId: null,
  profiles: [],
};

export class ProfileStore {
  constructor(
    private readonly paths: ProfilePaths = resolveProfilePaths(),
    private readonly io: {
      readFile?: typeof readFile;
      writeFile?: typeof writeFile;
      mkdir?: typeof mkdir;
    } = {},
  ) {}

  async load(): Promise<SavedProfileStoreState> {
    try {
      const raw = await (this.io.readFile ?? readFile)(this.paths.profilesPath, "utf8");
      return savedProfileStoreStateSchema.parse(JSON.parse(raw) as unknown);
    } catch (error) {
      if (isMissingFileError(error)) {
        return EMPTY_PROFILE_STORE;
      }
      throw error;
    }
  }

  async listProfiles(): Promise<SavedProfile[]> {
    return (await this.load()).profiles;
  }

  async getDefaultProfile(): Promise<SavedProfile | null> {
    const state = await this.load();
    if (!state.defaultProfileId) {
      return null;
    }
    return state.profiles.find((profile) => profile.id === state.defaultProfileId) ?? null;
  }

  async findProfile(query: string): Promise<SavedProfile | null> {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) {
      return null;
    }

    const state = await this.load();
    return (
      state.profiles.find(
        (profile) =>
          profile.id.toLowerCase() === normalizedQuery ||
          profile.name.toLowerCase() === normalizedQuery,
      ) ?? null
    );
  }

  async upsertProfile(
    input: UpsertProfileInput,
    options: {
      makeDefault?: boolean;
      now?: Date;
    } = {},
  ): Promise<SavedProfile> {
    const state = await this.load();
    const now = (options.now ?? new Date()).toISOString();
    const existing = state.profiles.find(
      (profile) => profile.name.toLowerCase() === input.name.trim().toLowerCase(),
    );

    const profile: SavedProfile = existing
      ? {
          ...existing,
          name: input.name.trim(),
          baseUrl: input.baseUrl,
          timeoutMs: input.timeoutMs,
          sourceCatalogPath: input.sourceCatalogPath,
          updatedAt: now,
        }
      : {
          id:
            input.id ??
            deriveProfileId(
              input.name,
              state.profiles.map((profile) => profile.id),
            ),
          name: input.name.trim(),
          baseUrl: input.baseUrl,
          timeoutMs: input.timeoutMs,
          sourceCatalogPath: input.sourceCatalogPath,
          createdAt: now,
          updatedAt: now,
        };

    const nextProfiles = existing
      ? state.profiles.map((candidate) => (candidate.id === profile.id ? profile : candidate))
      : [...state.profiles, profile];
    const nextState: SavedProfileStoreState = {
      version: PROFILE_STORE_VERSION,
      defaultProfileId:
        options.makeDefault || !state.defaultProfileId ? profile.id : state.defaultProfileId,
      profiles: nextProfiles,
    };

    await this.save(nextState);
    return profile;
  }

  async setDefaultProfile(profileId: string): Promise<void> {
    const state = await this.load();
    const profileExists = state.profiles.some((profile) => profile.id === profileId);
    if (!profileExists) {
      throw new Error(`Cannot set default profile. Unknown profile id '${profileId}'.`);
    }

    await this.save({
      ...state,
      defaultProfileId: profileId,
    });
  }

  private async save(state: SavedProfileStoreState): Promise<void> {
    const mkdirImpl = this.io.mkdir ?? mkdir;
    const writeFileImpl = this.io.writeFile ?? writeFile;
    await mkdirImpl(dirname(this.paths.profilesPath), { recursive: true });
    await writeFileImpl(this.paths.profilesPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  }
}

export function normalizeProfileId(name: string): string {
  const normalized = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return normalized || "default";
}

export function deriveProfileId(name: string, existingIds: string[]): string {
  const baseId = normalizeProfileId(name);
  if (!existingIds.includes(baseId)) {
    return baseId;
  }

  let index = 2;
  while (existingIds.includes(`${baseId}-${index}`)) {
    index += 1;
  }

  return `${baseId}-${index}`;
}

function isMissingFileError(error: unknown): error is NodeJS.ErrnoException {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT");
}
