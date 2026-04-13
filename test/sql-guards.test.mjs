import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkDangerousOperation, isReadOnlyQuery } from '../dist/core/sql-guards.js';

test('isReadOnlyQuery recognizes read-only starters', () => {
  assert.equal(isReadOnlyQuery('SELECT 1'), true);
  assert.equal(isReadOnlyQuery('  show tables'), true);
  assert.equal(isReadOnlyQuery('WITH x AS (SELECT 1) SELECT * FROM x'), true);
  assert.equal(isReadOnlyQuery('INSERT INTO t VALUES (1)'), false);
});

test('checkDangerousOperation blocks high-risk statements', () => {
  assert.ok(checkDangerousOperation('TRUNCATE TABLE users'));
  assert.ok(checkDangerousOperation('DROP TABLE users'));
  assert.ok(checkDangerousOperation('ALTER TABLE users ADD COLUMN x INT'));
  assert.equal(
    checkDangerousOperation('DELETE FROM users'),
    '危险操作：DELETE 或 UPDATE 语句缺少 WHERE 子句，拒绝执行'
  );
  assert.equal(
    checkDangerousOperation('UPDATE users SET x=1'),
    '危险操作：DELETE 或 UPDATE 语句缺少 WHERE 子句，拒绝执行'
  );
  assert.equal(checkDangerousOperation('UPDATE users SET x=1 WHERE id=1'), null);
});