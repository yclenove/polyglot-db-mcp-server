/**
 * 测试配置辅助模块
 * 提供测试用的连接配置和环境变量管理
 */

export const TEST_CONNECTIONS = {
  mysql: {
    id: 'test-mysql',
    engine: 'mysql',
    host: process.env.TEST_MYSQL_HOST || '127.0.0.1',
    port: parseInt(process.env.TEST_MYSQL_PORT || '3306', 10),
    user: process.env.TEST_MYSQL_USER || 'root',
    password: process.env.TEST_MYSQL_PASSWORD || 'testpass',
    database: process.env.TEST_MYSQL_DATABASE || 'testdb',
  },
  postgres: {
    id: 'test-pg',
    engine: 'postgres',
    url: process.env.TEST_PG_URL || 'postgres://postgres:postgres@127.0.0.1:5432/testdb',
  },
  redis: {
    id: 'test-redis',
    engine: 'redis',
    url: process.env.TEST_REDIS_URL || 'redis://127.0.0.1:6379/1',
    keyPrefix: 'test:',
  },
  mongodb: {
    id: 'test-mongo',
    engine: 'mongodb',
    url: process.env.TEST_MONGO_URL || 'mongodb://127.0.0.1:27017/testdb',
  },
};

/**
 * 检查测试环境是否可用
 */
export async function checkTestEnv(engine) {
  const conn = TEST_CONNECTIONS[engine];
  if (!conn) return false;

  try {
    if (engine === 'mysql') {
      const mysql = await import('mysql2/promise');
      const pool = mysql.createPool({
        host: conn.host,
        port: conn.port,
        user: conn.user,
        password: conn.password,
        database: conn.database,
        connectTimeout: 3000,
      });
      try {
        await pool.query('SELECT 1');
        return true;
      } finally {
        await pool.end().catch(() => {});
      }
    }
    if (engine === 'postgres') {
      const pg = await import('pg');
      const client = new pg.Client({ connectionString: conn.url, connectionTimeoutMillis: 3000 });
      try {
        await client.connect();
        await client.query('SELECT 1');
        return true;
      } finally {
        await client.end().catch(() => {});
      }
    }
    if (engine === 'redis') {
      const { Redis } = await import('ioredis');
      const redis = new Redis(conn.url, { connectTimeout: 3000, maxRetriesPerRequest: 1 });
      redis.on('error', () => {});
      try {
        await redis.ping();
        return true;
      } finally {
        redis.disconnect();
      }
    }
    if (engine === 'mongodb') {
      const { MongoClient } = await import('mongodb');
      const client = new MongoClient(conn.url, {
        connectTimeoutMS: 3000,
        serverSelectionTimeoutMS: 3000,
      });
      try {
        await client.connect();
        await client.db().admin().ping();
        return true;
      } finally {
        await client.close().catch(() => {});
      }
    }
  } catch (error) {
    if (process.env.TEST_INTEGRATION_REQUIRED === 'true') {
      throw new Error(
        `${engine} integration environment is required but unavailable: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }
    return false;
  }
  return false;
}

/**
 * 设置测试环境变量
 */
export function setupTestEnv() {
  process.env.DB_MCP_CONNECTIONS = JSON.stringify(Object.values(TEST_CONNECTIONS));
  process.env.DB_MCP_DEFAULT_CONNECTION_ID = 'test-mysql';
}
