import assert from 'node:assert/strict';
import { test, describe } from 'node:test';
import { parseConnectionSpecs, getDefaultConnectionId, globalLimits } from '../dist/core/config.js';

describe('parseConnectionSpecs', () => {
  test('parses valid MySQL connection with host', () => {
    const json = JSON.stringify([
      { id: 'my1', engine: 'mysql', host: 'localhost', port: 3306, user: 'root', password: 'pass', database: 'test' },
    ]);
    const specs = parseConnectionSpecs(json);
    assert.equal(specs.length, 1);
    assert.equal(specs[0]?.id, 'my1');
    assert.equal(specs[0]?.engine, 'mysql');
    assert.equal(specs[0]?.host, 'localhost');
    assert.equal(specs[0]?.port, 3306);
  });

  test('parses valid PostgreSQL connection with URL', () => {
    const json = JSON.stringify([
      { id: 'pg1', engine: 'postgres', url: 'postgres://user:pass@localhost:5432/db' },
    ]);
    const specs = parseConnectionSpecs(json);
    assert.equal(specs.length, 1);
    assert.equal(specs[0]?.id, 'pg1');
    assert.equal(specs[0]?.engine, 'postgres');
    assert.equal(specs[0]?.url, 'postgres://user:pass@localhost:5432/db');
  });

  test('parses Redis connection with keyPrefix', () => {
    const json = JSON.stringify([
      { id: 'rd1', engine: 'redis', url: 'redis://localhost:6379', keyPrefix: 'app:' },
    ]);
    const specs = parseConnectionSpecs(json);
    assert.equal(specs.length, 1);
    assert.equal(specs[0]?.engine, 'redis');
    assert.equal(specs[0]?.keyPrefix, 'app:');
  });

  test('parses MongoDB connection', () => {
    const json = JSON.stringify([
      { id: 'mdb1', engine: 'mongodb', url: 'mongodb://localhost:27017/test' },
    ]);
    const specs = parseConnectionSpecs(json);
    assert.equal(specs.length, 1);
    assert.equal(specs[0]?.engine, 'mongodb');
  });

  test('parses readonly flag', () => {
    const json = JSON.stringify([
      { id: 'ro1', engine: 'postgres', url: 'postgres://localhost/db', readonly: true },
    ]);
    const specs = parseConnectionSpecs(json);
    assert.equal(specs[0]?.readonly, true);
  });

  test('parses allowlist', () => {
    const json = JSON.stringify([
      { id: 'al1', engine: 'postgres', url: 'postgres://localhost/db', allowlist: ['db1', 'db2'] },
    ]);
    const specs = parseConnectionSpecs(json);
    assert.deepEqual(specs[0]?.allowlist, ['db1', 'db2']);
  });

  test('parses DuckDB with readonly default and file allowlist', () => {
    const json = JSON.stringify([
      { id: 'duck', engine: 'duckdb', url: ':memory:', allowlist: ['./data'] },
    ]);
    const specs = parseConnectionSpecs(json);
    assert.equal(specs[0]?.engine, 'duckdb');
    assert.equal(specs[0]?.readonly, true);
    assert.deepEqual(specs[0]?.allowlist, ['./data']);
  });

  test('throws on empty string', () => {
    assert.throws(() => parseConnectionSpecs(''), /必须设置 DB_MCP_CONNECTIONS/);
  });

  test('throws on invalid JSON', () => {
    assert.throws(() => parseConnectionSpecs('not json'), /不是合法 JSON/);
  });

  test('throws on empty array', () => {
    assert.throws(() => parseConnectionSpecs('[]'), /非空 JSON 数组/);
  });

  test('throws on non-array', () => {
    assert.throws(() => parseConnectionSpecs('{}'), /非空 JSON 数组/);
  });

  test('throws on duplicate id', () => {
    const json = JSON.stringify([
      { id: 'dup', engine: 'redis', url: 'redis://localhost:6379' },
      { id: 'dup', engine: 'redis', url: 'redis://localhost:6379' },
    ]);
    assert.throws(() => parseConnectionSpecs(json), /id「dup」重复/);
  });

  test('throws on invalid id format', () => {
    const json = JSON.stringify([
      { id: 'invalid-id!', engine: 'redis', url: 'redis://localhost:6379' },
    ]);
    assert.throws(() => parseConnectionSpecs(json), /合法 id/);
  });

  test('throws on missing engine', () => {
    const json = JSON.stringify([{ id: 'noeng' }]);
    assert.throws(() => parseConnectionSpecs(json), /缺少 engine/);
  });

  test('throws on unsupported engine', () => {
    const json = JSON.stringify([{ id: 'bad', engine: 'firebird' }]);
    assert.throws(() => parseConnectionSpecs(json), /不支持的 engine/);
  });

  test('parses plugin engines when explicitly allowed', () => {
    const json = JSON.stringify([{ id: 'ch', engine: 'clickhouse', url: 'clickhouse://local' }]);
    const specs = parseConnectionSpecs(json, { pluginEngines: ['clickhouse'] });
    assert.equal(specs[0]?.id, 'ch');
    assert.equal(specs[0]?.engine, 'clickhouse');
  });

  test('throws on Redis without url', () => {
    const json = JSON.stringify([{ id: 'rd', engine: 'redis' }]);
    assert.throws(() => parseConnectionSpecs(json), /必须提供 url/);
  });

  test('throws on MongoDB without url', () => {
    const json = JSON.stringify([{ id: 'mdb', engine: 'mongodb' }]);
    assert.throws(() => parseConnectionSpecs(json), /必须提供 url/);
  });

  test('throws on SQL engine without url or host', () => {
    const json = JSON.stringify([{ id: 'my', engine: 'mysql' }]);
    assert.throws(() => parseConnectionSpecs(json), /需提供 url 或 host/);
  });

  test('parses multiple connections', () => {
    const json = JSON.stringify([
      { id: 'pg', engine: 'postgres', url: 'postgres://localhost/db1' },
      { id: 'my', engine: 'mysql', host: 'localhost', port: 3306 },
      { id: 'rd', engine: 'redis', url: 'redis://localhost:6379' },
    ]);
    const specs = parseConnectionSpecs(json);
    assert.equal(specs.length, 3);
    assert.equal(specs[0]?.id, 'pg');
    assert.equal(specs[1]?.id, 'my');
    assert.equal(specs[2]?.id, 'rd');
  });
});

describe('getDefaultConnectionId', () => {
  test('returns first id when env not set', () => {
    const specs = [{ id: 'a', engine: 'postgres', url: 'postgres://localhost/db' }];
    delete process.env.DB_MCP_DEFAULT_CONNECTION_ID;
    assert.equal(getDefaultConnectionId(specs), 'a');
  });

  test('returns env id when valid', () => {
    const specs = [
      { id: 'a', engine: 'postgres', url: 'postgres://localhost/db1' },
      { id: 'b', engine: 'postgres', url: 'postgres://localhost/db2' },
    ];
    process.env.DB_MCP_DEFAULT_CONNECTION_ID = 'b';
    assert.equal(getDefaultConnectionId(specs), 'b');
    delete process.env.DB_MCP_DEFAULT_CONNECTION_ID;
  });

  test('returns first id when env invalid', () => {
    const specs = [{ id: 'a', engine: 'postgres', url: 'postgres://localhost/db' }];
    process.env.DB_MCP_DEFAULT_CONNECTION_ID = 'nonexistent';
    assert.equal(getDefaultConnectionId(specs), 'a');
    delete process.env.DB_MCP_DEFAULT_CONNECTION_ID;
  });
});

describe('globalLimits', () => {
  test('returns default values', () => {
    delete process.env.DB_QUERY_TIMEOUT;
    delete process.env.DB_MAX_ROWS;
    delete process.env.DB_MAX_SQL_LENGTH;
    delete process.env.DB_RETRY_COUNT;
    delete process.env.DB_RETRY_DELAY_MS;

    const limits = globalLimits();
    assert.equal(limits.queryTimeoutMs, 30000);
    assert.equal(limits.maxRows, 100);
    assert.equal(limits.maxSqlLength, 102400);
    assert.equal(limits.retryCount, 2);
    assert.equal(limits.retryDelayMs, 200);
  });

  test('reads from env vars', () => {
    process.env.DB_QUERY_TIMEOUT = '5000';
    process.env.DB_MAX_ROWS = '50';
    process.env.DB_MAX_SQL_LENGTH = '51200';
    process.env.DB_RETRY_COUNT = '3';
    process.env.DB_RETRY_DELAY_MS = '100';

    const limits = globalLimits();
    assert.equal(limits.queryTimeoutMs, 5000);
    assert.equal(limits.maxRows, 50);
    assert.equal(limits.maxSqlLength, 51200);
    assert.equal(limits.retryCount, 3);
    assert.equal(limits.retryDelayMs, 100);

    // 清理
    delete process.env.DB_QUERY_TIMEOUT;
    delete process.env.DB_MAX_ROWS;
    delete process.env.DB_MAX_SQL_LENGTH;
    delete process.env.DB_RETRY_COUNT;
    delete process.env.DB_RETRY_DELAY_MS;
  });
});
