import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  describeTableSql,
  explainQuerySql,
  listIndexesSql,
  listTablesSql,
} from '../dist/core/sql-helpers.js';

describe('sql helpers', () => {
  test('describeTableSql supports all SQL engines', () => {
    assert.match(describeTableSql('mysql', 'users').sql, /SHOW COLUMNS FROM `users`/);
    assert.deepEqual(describeTableSql('postgres', 'users'), {
      sql: `SELECT column_name, data_type, is_nullable
              FROM information_schema.columns
              WHERE table_schema = $1 AND table_name = $2
              ORDER BY ordinal_position`,
      params: ['public', 'users'],
    });
    assert.deepEqual(describeTableSql('postgres', 'users', 'app').params, ['app', 'users']);
    assert.match(describeTableSql('mssql', 'users').sql, /TABLE_NAME = \?/);
    assert.deepEqual(describeTableSql('mssql', 'users').params, ['users']);
    assert.match(describeTableSql('oracle', 'users').sql, /table_name = \?/);
    assert.deepEqual(describeTableSql('oracle', 'users').params, ['USERS']);
    assert.match(describeTableSql('sqlite', 'users').sql, /PRAGMA table_info\(`users`\)/);
  });

  test('listIndexesSql supports all SQL engines', () => {
    assert.match(listIndexesSql('mysql', 'users').sql, /SHOW INDEX FROM `users`/);
    assert.deepEqual(listIndexesSql('postgres', 'users', 'app').params, ['app', 'users']);
    assert.match(listIndexesSql('mssql', 'users').sql, /OBJECT_ID\(\?\)/);
    assert.deepEqual(listIndexesSql('mssql', 'users').params, ['users']);
    assert.match(listIndexesSql('oracle', 'users').sql, /table_name = \?/);
    assert.deepEqual(listIndexesSql('oracle', 'users').params, ['USERS']);
    assert.match(listIndexesSql('sqlite', 'users').sql, /pragma_index_list\(\?\)/);
    assert.deepEqual(listIndexesSql('sqlite', 'users').params, ['users']);
  });

  test('listTablesSql supports all SQL engines', () => {
    assert.match(listTablesSql('mysql').sql, /information_schema\.tables/);
    assert.deepEqual(listTablesSql('postgres').params, ['public']);
    assert.deepEqual(listTablesSql('postgres', 'app').params, ['app']);
    assert.match(listTablesSql('mssql').sql, /INFORMATION_SCHEMA\.TABLES/);
    assert.match(listTablesSql('oracle').sql, /user_tables/);
    assert.match(listTablesSql('sqlite').sql, /sqlite_master/);
  });

  test('rejects invalid identifiers', () => {
    assert.throws(() => describeTableSql('postgres', 'users;drop'), /table 不合法/);
    assert.throws(() => listIndexesSql('mysql', 'users-name'), /table 不合法/);
  });

  test('explainQuerySql supports safe single-statement engines', () => {
    assert.equal(explainQuerySql('mysql', 'SELECT 1'), 'EXPLAIN SELECT 1');
    assert.equal(explainQuerySql('postgres', 'SELECT 1'), 'EXPLAIN (FORMAT JSON, VERBOSE) SELECT 1');
    assert.equal(explainQuerySql('oracle', 'SELECT 1 FROM dual'), 'EXPLAIN PLAN FOR SELECT 1 FROM dual');
    assert.equal(explainQuerySql('sqlite', 'SELECT 1'), 'EXPLAIN QUERY PLAN SELECT 1');
  });

  test('explainQuerySql rejects MSSQL instead of building a SHOWPLAN batch', () => {
    assert.throws(
      () => explainQuerySql('mssql', 'SELECT 1'),
      /MSSQL EXPLAIN 暂不支持安全批处理/
    );
  });
});
