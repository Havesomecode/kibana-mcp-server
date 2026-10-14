---
description: "Keep source catalogs in MongoDB: options, document shape and replica set connections."
---

# MongoDB store

## 1. Install the driver

```bash
npm install mongodb
```

## 2. Configure the store

MongoDB keeps one document per profile:

```ts
import { defineKibanaMcpConfig } from "@havesomecode/kibana-mcp-server/config";
import store from "@havesomecode/kibana-mcp-server/stores/mongodb";

export default defineKibanaMcpConfig({
  url: process.env.KIBANA_URL,
  user: process.env.KIBANA_USER,
  password: process.env.KIBANA_PASSWORD,
  store,
  storeOptions: { url: process.env.MONGODB_URI, database: "ops" },
});
```

## Options

| Option | Default | Description |
| --- | --- | --- |
| `url` | `KIBANA_STORE_URL`, then `MONGODB_URI`, then `MONGO_URL` | `mongodb://` or `mongodb+srv://` URL |
| `database` | the database of the URL | Database name |
| `collectionName` | `kibana_mcp_catalogs` | Collection name |
| `collection` | none | A collection you obtained yourself, used instead of `url`. The store never closes its client. |

::: warning Replica sets
The `url` option does not yet accept multi-host strings such as `mongodb://db1,db2,db3/logs?replicaSet=rs0`. Use `mongodb+srv://`, or create a client and pass its `collection`:

```ts
import { MongoClient } from "mongodb";

const client = await new MongoClient(process.env.MONGODB_URI).connect();
const collection = client.db("ops").collection("kibana_mcp_catalogs");

export default defineKibanaMcpConfig({ /* … */ store, storeOptions: { collection } });
```
:::

## Documents

```json
{ "_id": "<profile key>", "content": "<serialized catalog>", "updatedAt": "<date>" }
```

## How writes are protected

New catalogs use insert; duplicate keys report a conflict. Existing catalogs update only when previous content matches; no matching document reports a conflict.
