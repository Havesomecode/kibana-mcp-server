import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { resolveProfilePaths } from "../src/profile_paths.js";
import { ProfileStore } from "../src/profile_store.js";

const tempDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("ProfileStore", () => {
  it("persists non-secret profile metadata and sets the first profile as default", async () => {
    const root = await mkdtemp(join(tmpdir(), "kibana-profile-store-"));
    tempDirectories.push(root);
    const paths = resolveProfilePaths({ KIBANA_STATE_DIR: root } as NodeJS.ProcessEnv);
    const store = new ProfileStore(paths);

    const profile = await store.upsertProfile(
      {
        name: "prod",
        baseUrl: "https://kibana.example.com",
        timeoutMs: 10000,
        sourceCatalogPath: join(paths.sourceCatalogsDir, "prod.json"),
      },
      {
        makeDefault: true,
      },
    );

    expect(profile.id).toBe("prod");
    expect((await store.getDefaultProfile())?.id).toBe("prod");

    const rawStore = await readFile(paths.profilesPath, "utf8");
    expect(rawStore).toContain('"defaultProfileId": "prod"');
    expect(rawStore).not.toContain("secret");
    expect(rawStore).not.toContain("password");
  });

  it("switches the default profile without mutating the others", async () => {
    const root = await mkdtemp(join(tmpdir(), "kibana-profile-store-"));
    tempDirectories.push(root);
    const paths = resolveProfilePaths({ KIBANA_STATE_DIR: root } as NodeJS.ProcessEnv);
    const store = new ProfileStore(paths);

    await store.upsertProfile(
      {
        name: "prod",
        baseUrl: "https://prod.example.com",
        timeoutMs: 10000,
        sourceCatalogPath: join(paths.sourceCatalogsDir, "prod.json"),
      },
      {
        makeDefault: true,
      },
    );
    const staging = await store.upsertProfile({
      name: "staging",
      baseUrl: "https://staging.example.com",
      timeoutMs: 10000,
      sourceCatalogPath: join(paths.sourceCatalogsDir, "staging.json"),
    });

    await store.setDefaultProfile(staging.id);

    expect((await store.getDefaultProfile())?.name).toBe("staging");
    expect((await store.findProfile("prod"))?.baseUrl).toBe("https://prod.example.com");
  });
});
