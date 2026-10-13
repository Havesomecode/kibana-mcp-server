import { afterEach, describe, expect, it, vi } from "vitest";

import mongodbCatalogStore, { type MongodbCatalogDocument } from "../../src/stores/mongodb.js";
import { expectCatalogStoreContract } from "./contract.js";

function fakeCollection() {
  const documents = new Map<string, MongodbCatalogDocument>();
  return {
    documents,
    async findOne({ _id }: { _id: string }) {
      return documents.get(_id) ?? null;
    },
    async insertOne(document: MongodbCatalogDocument) {
      if (documents.has(document._id)) {
        throw Object.assign(new Error("E11000 duplicate key error"), { code: 11000 });
      }
      documents.set(document._id, document);
    },
    async updateOne(
      filter: { _id: string; content: string },
      update: { $set: { content: string; updatedAt: Date } },
    ) {
      const current = documents.get(filter._id);
      if (current?.content !== filter.content) return { matchedCount: 0 };
      documents.set(filter._id, { ...current, ...update.$set });
      return { matchedCount: 1 };
    },
  };
}

class FakeMongoClient {
  static instances: FakeMongoClient[] = [];
  readonly collections = new Map<string, ReturnType<typeof fakeCollection>>();
  connected = false;
  closed = false;

  constructor(readonly url: string) {
    FakeMongoClient.instances.push(this);
  }

  async connect() {
    this.connected = true;
  }

  db(name?: string) {
    return {
      collection: (collectionName: string) => {
        const key = `${name ?? "<default>"}.${collectionName}`;
        const collection = this.collections.get(key) ?? fakeCollection();
        this.collections.set(key, collection);
        return collection;
      },
    };
  }

  async close() {
    this.closed = true;
  }
}

afterEach(() => {
  FakeMongoClient.instances = [];
  vi.doUnmock("mongodb");
  vi.unstubAllEnvs();
});

describe("mongodb catalog store", () => {
  it("fulfils the catalog store contract with a supplied collection it does not own", async () => {
    const collection = fakeCollection();
    const store = await mongodbCatalogStore({ collection });

    await expectCatalogStoreContract(store);

    expect(collection.documents.get("alice")).toMatchObject({ _id: "alice", content: "v2" });
    expect(collection.documents.get("alice")?.updatedAt).toBeInstanceOf(Date);
    expect(store.describe?.("alice")).toBe("mongodb:/kibana_mcp_catalogs/alice");
    expect(store.close).toBeUndefined();
  });

  it("opens, uses and closes its own client from the configured URL", async () => {
    vi.doMock("mongodb", () => ({ MongoClient: FakeMongoClient }));
    vi.stubEnv("KIBANA_STORE_URL", "");
    vi.stubEnv("MONGODB_URI", "mongodb://app:secret@mongo.internal:27017/logs");

    const store = await mongodbCatalogStore({ database: "ops", collectionName: "catalogs" });
    await expectCatalogStoreContract(store);
    await store.close?.();

    const [client] = FakeMongoClient.instances;
    expect(client.url).toBe("mongodb://app:secret@mongo.internal:27017/logs");
    expect(client.connected).toBe(true);
    expect([...client.collections.keys()]).toEqual(["ops.catalogs"]);
    expect(store.describe?.("alice")).toBe("mongodb://mongo.internal:27017/logs/catalogs/alice");
    expect(client.closed).toBe(true);
  });

  it("falls back to MONGO_URL and the database of the URL", async () => {
    vi.doMock("mongodb", () => ({ MongoClient: FakeMongoClient }));
    vi.stubEnv("KIBANA_STORE_URL", "");
    vi.stubEnv("MONGODB_URI", "");
    vi.stubEnv("MONGO_URL", "mongodb+srv://cluster.example.com/logs");

    const store = await mongodbCatalogStore();
    await store.replace("alice", undefined, "v1");

    expect([...FakeMongoClient.instances[0].collections.keys()]).toEqual([
      "<default>.kibana_mcp_catalogs",
    ]);
  });

  it("reports insert failures other than a duplicate key, and foreign URLs", async () => {
    const collection = fakeCollection();
    collection.insertOne = async () => {
      throw Object.assign(new Error("not primary"), { code: 10107 });
    };
    const store = await mongodbCatalogStore({ collection });

    await expect(store.replace("alice", undefined, "v1")).rejects.toThrow("not primary");
    await expect(mongodbCatalogStore({ url: "http://mongo.internal" })).rejects.toThrow(
      "must use mongodb:// or mongodb+srv://",
    );
  });
});
