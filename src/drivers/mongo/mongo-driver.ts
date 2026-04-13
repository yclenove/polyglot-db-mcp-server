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
      const rows = await db.collection(collection).aggregate(pipeline as []).toArray();
      auditLog({ engine: 'mongodb', op: 'aggregate', collection, n: rows.length });
      return rows;
    },
    async count(collection, filter) {
      assertCollectionAllowed(collection);
      return db.collection(collection).countDocuments(filter);
    },
    async close() {
      await client.close();
    },
  };
}
