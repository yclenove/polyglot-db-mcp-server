import { MongoClient, type Db } from 'mongodb';
import type { ConnectionSpec } from '../../core/types.js';
import type { MongoDriver } from '../../core/types.js';
import { auditLog } from '../../core/audit.js';

function dbFromClient(client: MongoClient, spec: ConnectionSpec): Db {
  if (spec.database) return client.db(spec.database);
  return client.db();
}

export async function createMongoDriver(spec: ConnectionSpec): Promise<MongoDriver> {
  const url = spec.url;
  if (!url) {
    throw new Error('MongoDB 连接需要 url');
  }
  const client = new MongoClient(url);
  await client.connect();
  const db = dbFromClient(client, spec);

  function assertCollectionAllowed(name: string): void {
    if (!spec.allowlist?.length) return;
    if (!spec.allowlist.includes(name)) {
      throw new Error(`集合「${name}」不在 allowlist 中`);
    }
  }

  function assertNotReadonly(): void {
    if (spec.readonly) {
      throw new Error('该 MongoDB 连接为只读');
    }
  }

  return {
    async ping() {
      try {
        await db.command({ ping: 1 });
        return { ok: true };
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
      }
    },
    async listCollections() {
      const cols = await db.listCollections().toArray();
      const names = cols.map((c) => c.name).filter((n) => !n.startsWith('system.'));
      if (spec.allowlist?.length) {
        return names.filter((n) => spec.allowlist!.includes(n));
      }
      return names;
    },
    async find(collection, filter, options) {
      assertCollectionAllowed(collection);
      const cur = db.collection(collection).find(filter).limit(options.limit);
      if (options.skip) cur.skip(options.skip);
      const rows = await cur.toArray();
      auditLog({ engine: 'mongodb', op: 'find', collection, n: rows.length });
      return rows;
    },
    async aggregate(collection, pipeline) {
      assertCollectionAllowed(collection);
      const rows = await db
        .collection(collection)
        .aggregate(pipeline as [])
        .toArray();
      auditLog({ engine: 'mongodb', op: 'aggregate', collection, n: rows.length });
      return rows;
    },
    async count(collection, filter) {
      assertCollectionAllowed(collection);
      return db.collection(collection).countDocuments(filter);
    },
    async insertOne(collection, document) {
      assertCollectionAllowed(collection);
      assertNotReadonly();
      const result = await db.collection(collection).insertOne(document);
      auditLog({ engine: 'mongodb', op: 'insertOne', collection });
      return {
        acknowledged: result.acknowledged,
        insertedId: result.insertedId,
        insertedCount: 1,
      };
    },
    async insertMany(collection, documents) {
      assertCollectionAllowed(collection);
      assertNotReadonly();
      const result = await db.collection(collection).insertMany(documents);
      auditLog({ engine: 'mongodb', op: 'insertMany', collection, n: documents.length });
      return {
        acknowledged: result.acknowledged,
        insertedId: result.insertedIds,
        insertedCount: result.insertedCount,
      };
    },
    async updateOne(collection, filter, update, options) {
      assertCollectionAllowed(collection);
      assertNotReadonly();
      const result = await db.collection(collection).updateOne(filter, update, options);
      auditLog({ engine: 'mongodb', op: 'updateOne', collection });
      return {
        acknowledged: result.acknowledged,
        matchedCount: result.matchedCount,
        modifiedCount: result.modifiedCount,
        upsertedId: result.upsertedId,
      };
    },
    async deleteOne(collection, filter) {
      assertCollectionAllowed(collection);
      assertNotReadonly();
      const result = await db.collection(collection).deleteOne(filter);
      auditLog({ engine: 'mongodb', op: 'deleteOne', collection });
      return {
        acknowledged: result.acknowledged,
        deletedCount: result.deletedCount,
      };
    },
    async updateMany(collection, filter, update) {
      assertCollectionAllowed(collection);
      assertNotReadonly();
      const result = await db.collection(collection).updateMany(filter, update);
      auditLog({
        engine: 'mongodb',
        op: 'updateMany',
        collection,
        matched: result.matchedCount,
        modified: result.modifiedCount,
      });
      return {
        acknowledged: result.acknowledged,
        matchedCount: result.matchedCount,
        modifiedCount: result.modifiedCount,
        upsertedId: result.upsertedId,
      };
    },
    async deleteMany(collection, filter) {
      assertCollectionAllowed(collection);
      assertNotReadonly();
      const result = await db.collection(collection).deleteMany(filter);
      auditLog({ engine: 'mongodb', op: 'deleteMany', collection, deleted: result.deletedCount });
      return {
        acknowledged: result.acknowledged,
        deletedCount: result.deletedCount,
      };
    },
    async findOneAndUpdate(collection, filter, update, options) {
      assertCollectionAllowed(collection);
      assertNotReadonly();
      const result = await db.collection(collection).findOneAndUpdate(filter, update, {
        upsert: options?.upsert,
        returnDocument: options?.returnDocument === 'after' ? 'after' : 'before',
      });
      auditLog({ engine: 'mongodb', op: 'findOneAndUpdate', collection });
      return result;
    },
    async findOneAndDelete(collection, filter) {
      assertCollectionAllowed(collection);
      assertNotReadonly();
      const result = await db.collection(collection).findOneAndDelete(filter);
      auditLog({ engine: 'mongodb', op: 'findOneAndDelete', collection });
      return result;
    },
    async dropCollection(collection) {
      assertCollectionAllowed(collection);
      assertNotReadonly();
      const result = await db.collection(collection).drop();
      auditLog({ engine: 'mongodb', op: 'dropCollection', collection });
      return result;
    },
    async renameCollection(collection, newName) {
      assertCollectionAllowed(collection);
      assertNotReadonly();
      const result = await db.collection(collection).rename(newName);
      auditLog({ engine: 'mongodb', op: 'renameCollection', from: collection, to: newName });
      return result.collectionName;
    },
    async listIndexes(collection) {
      assertCollectionAllowed(collection);
      const indexes = await db.collection(collection).listIndexes().toArray();
      auditLog({ engine: 'mongodb', op: 'listIndexes', collection });
      return indexes;
    },
    async createIndex(collection, keys, options) {
      assertCollectionAllowed(collection);
      assertNotReadonly();
      const indexName = await db
        .collection(collection)
        .createIndex(keys as unknown as import('mongodb').IndexSpecification, {
          name: options?.name,
          unique: options?.unique,
          sparse: options?.sparse,
        });
      auditLog({ engine: 'mongodb', op: 'createIndex', collection, indexName });
      return indexName;
    },
    async close() {
      await client.close();
    },
  };
}
