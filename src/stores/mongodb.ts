import { CatalogConflictError, type CatalogStore } from "./catalog_store.js";
import { DEFAULT_TABLE_NAME, importDriver, resolveStoreConnectionString } from "./shared.js";

const DUPLICATE_KEY_ERROR_CODE = 11000;

export interface MongodbCatalogStoreOptions {
  /** `mongodb://` or `mongodb+srv://` URL. Defaults to `KIBANA_STORE_URL`, then `MONGODB_URI`, then `MONGO_URL`. */
  url?: string;
  /** Database name. Defaults to the database of the URL. */
  database?: string;
  /** Collection name. Defaults to `kibana_mcp_catalogs`. */
  collectionName?: string;
  /** A `mongodb` collection to use instead of `url`. The store never closes its client. */
  collection?: MongodbCatalogCollection;
}

export interface MongodbCatalogDocument {
  _id: string;
  content: string;
  updatedAt: Date;
}

/** The subset of a `mongodb` collection this store relies on. */
export interface MongodbCatalogCollection {
  findOne(filter: { _id: string }): Promise<{ content?: unknown } | null>;
  insertOne(document: MongodbCatalogDocument): Promise<unknown>;
  updateOne(
    filter: { _id: string; content: string },
    update: { $set: { content: string; updatedAt: Date } },
  ): Promise<{ matchedCount: number }>;
}

/**
 * Catalog store backed by MongoDB through the `mongodb` package: one document per profile.
 *
 * Usable directly as `store` in the configuration file; its options come from `storeOptions`.
 */
export default async function mongodbCatalogStore(
  options: MongodbCatalogStoreOptions = {},
): Promise<CatalogStore> {
  const collectionName = options.collectionName ?? DEFAULT_TABLE_NAME;
  let collection = options.collection;
  let label = "mongodb:";
  let close: (() => Promise<void>) | undefined;

  if (!collection) {
    const url = resolveStoreConnectionString(
      "MongoDB",
      options.url,
      ["MONGODB_URI", "MONGO_URL"],
      ["mongodb:", "mongodb+srv:"],
    );
    const { MongoClient } = await importDriver<typeof import("mongodb")>("MongoDB", "mongodb");
    // MongoDB's driver accepts seed lists and SRV URIs that WHATWG URL cannot parse.
    const client = new MongoClient(url);
    await client.connect();
    collection = client.db(options.database).collection<MongodbCatalogDocument>(collectionName);
    label = url
      .split(/[?#]/, 1)[0]
      .replace(/(\/\/)[^/]*@/, "$1")
      .replace(/\/$/, "");
    close = () => client.close();
  }

  const catalogs = collection;
  const describe = (profileKey: string) => `${label}/${collectionName}/${profileKey}`;
  return {
    describe,
    async read(profileKey) {
      const document = await catalogs.findOne({ _id: profileKey });
      return typeof document?.content === "string" ? document.content : undefined;
    },
    async replace(profileKey, expected, next, signal) {
      signal?.throwIfAborted();
      const updatedAt = new Date();
      if (expected === undefined) {
        try {
          await catalogs.insertOne({ _id: profileKey, content: next, updatedAt });
        } catch (error) {
          if ((error as { code?: unknown } | null)?.code === DUPLICATE_KEY_ERROR_CODE) {
            throw new CatalogConflictError(describe(profileKey));
          }
          throw error;
        }
        return;
      }

      const { matchedCount } = await catalogs.updateOne(
        { _id: profileKey, content: expected },
        { $set: { content: next, updatedAt } },
      );
      if (matchedCount !== 1) {
        throw new CatalogConflictError(describe(profileKey));
      }
    },
    close,
  };
}
