import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { resolveProfilePaths } from "../src/profile_paths.js";
import { ProfileStore } from "../src/profile_store.js";
import { type SetupPrompter, runSetupFlow } from "../src/setup_flow.js";

const tempDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("runSetupFlow", () => {
  it("saves multiple environments, imports catalogs into machine state, and updates the default", async () => {
    const root = await mkdtemp(join(tmpdir(), "kibana-setup-flow-"));
    tempDirectories.push(root);
    const cwd = join(root, "workspace");
    const paths = resolveProfilePaths({
      KIBANA_STATE_DIR: join(root, "machine-state"),
    } as NodeJS.ProcessEnv);
    const profileStore = new ProfileStore(paths);
    const sourceCatalogPath = join(cwd, "sources.json");

    await mkdir(cwd, { recursive: true });
    await writeFile(
      sourceCatalogPath,
      JSON.stringify(
        {
          sources: [
            {
              id: "app_logs",
              name: "Application logs",
              tags: ["application"],
              timeField: "@timestamp",
              backend: {
                kind: "kibana_internal_search_es",
                path: "/internal/search/es",
                index: ["app-logs-*"],
              },
              fieldHints: [],
              defaultTextFields: ["message"],
              evidenceFields: [],
            },
          ],
        },
        null,
        2,
      ),
      "utf8",
    );

    const savedSecrets = new Map<string, { username: string; password: string }>();
    const prompts = createQueuedPrompter({
      promptAnswers: [
        "prod",
        "https://prod.example.com",
        "elastic-prod",
        "prod-secret",
        sourceCatalogPath,
        "staging",
        "https://staging.example.com/logs",
        "elastic-staging",
        "staging-secret",
        sourceCatalogPath,
      ],
      confirmAnswers: [true, true, false],
    });

    const result = await runSetupFlow(prompts, {
      cwd,
      paths,
      profileStore,
      secretStore: {
        async load(profileId) {
          const secret = savedSecrets.get(profileId);
          if (!secret) {
            throw new Error(`missing ${profileId}`);
          }
          return secret;
        },
        async save(profileId, secret) {
          savedSecrets.set(profileId, secret);
        },
        async delete(profileId) {
          savedSecrets.delete(profileId);
        },
      },
    });

    expect(result.defaultProfileName).toBe("staging");
    expect(result.profiles).toEqual(["prod", "staging"]);
    expect(savedSecrets.get("prod")?.username).toBe("elastic-prod");
    expect(savedSecrets.get("staging")?.password).toBe("staging-secret");
    expect(await readFile(join(paths.sourceCatalogsDir, "prod.json"), "utf8")).toContain(
      '"id": "app_logs"',
    );
    expect(await readFile(join(paths.sourceCatalogsDir, "staging.json"), "utf8")).toContain(
      '"path": "/internal/search/es"',
    );
    expect((await profileStore.getDefaultProfile())?.name).toBe("staging");
  });

  it("rejects full endpoint URLs and asks again", async () => {
    const root = await mkdtemp(join(tmpdir(), "kibana-setup-flow-"));
    tempDirectories.push(root);
    const cwd = root;
    const paths = resolveProfilePaths({
      KIBANA_STATE_DIR: join(root, "machine-state"),
    } as NodeJS.ProcessEnv);
    const profileStore = new ProfileStore(paths);
    const sourceCatalogPath = join(root, "sources.json");

    await mkdir(root, { recursive: true });
    await writeFile(
      sourceCatalogPath,
      JSON.stringify(
        {
          sources: [
            {
              id: "app_logs",
              name: "Application logs",
              tags: ["application"],
              timeField: "@timestamp",
              backend: {
                kind: "kibana_internal_search_es",
                path: "/internal/search/es",
              },
              fieldHints: [],
              defaultTextFields: ["message"],
              evidenceFields: [],
            },
          ],
        },
        null,
        2,
      ),
      "utf8",
    );

    const prompts = createQueuedPrompter({
      promptAnswers: [
        "prod",
        "https://prod.example.com/internal/search/es",
        "https://prod.example.com",
        "elastic",
        "secret",
        sourceCatalogPath,
      ],
      confirmAnswers: [false],
    });

    await runSetupFlow(prompts, {
      cwd,
      paths,
      profileStore,
      secretStore: {
        async load() {
          return { username: "elastic", password: "secret" };
        },
        async save() {},
        async delete() {},
      },
    });

    expect(prompts.messages).toContain(
      "Enter the Kibana base URL only. Do not include endpoint paths such as /internal/search/es.",
    );
  });
});

function createQueuedPrompter(input: {
  promptAnswers: string[];
  confirmAnswers: boolean[];
}): SetupPrompter & { messages: string[] } {
  const messages: string[] = [];
  const promptAnswers = [...input.promptAnswers];
  const confirmAnswers = [...input.confirmAnswers];

  return {
    messages,
    async info(message: string) {
      messages.push(message);
    },
    async prompt() {
      const answer = promptAnswers.shift();
      if (answer === undefined) {
        throw new Error("No prompt answer available");
      }
      return answer;
    },
    async confirm() {
      const answer = confirmAnswers.shift();
      if (answer === undefined) {
        throw new Error("No confirm answer available");
      }
      return answer;
    },
  };
}
