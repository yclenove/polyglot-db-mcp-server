import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  isReadOnlyQuery,
  detectInjectionPatterns,
  checkDangerousOperation,
} from '../dist/core/sql-guards.js';

// ── isReadOnlyQuery ──────────────────────────────────────────

describe('isReadOnlyQuery', () => {
  test('recognizes SELECT', () => {
    assert.equal(isReadOnlyQuery('SELECT 1'), true);
    assert.equal(isReadOnlyQuery('  select * from users'), true);
    assert.equal(isReadOnlyQuery('SELECT id, name FROM users WHERE id = 1'), true);
  });

  test('recognizes SHOW', () => {
    assert.equal(isReadOnlyQuery('SHOW TABLES'), true);
    assert.equal(isReadOnlyQuery('  show databases'), true);
  });

  test('recognizes DESCRIBE and DESC', () => {
    assert.equal(isReadOnlyQuery('DESCRIBE users'), true);
    assert.equal(isReadOnlyQuery('DESC users'), true);
    assert.equal(isReadOnlyQuery('  describe users'), true);
  });

  test('recognizes EXPLAIN', () => {
    assert.equal(isReadOnlyQuery('EXPLAIN SELECT * FROM users'), true);
    assert.equal(isReadOnlyQuery('  explain format=json select 1'), true);
  });

  test('recognizes WITH (CTE) as read-only when no mutations', () => {
    assert.equal(isReadOnlyQuery('WITH x AS (SELECT 1) SELECT * FROM x'), true);
    assert.equal(isReadOnlyQuery('WITH cte AS (SELECT id FROM t) SELECT * FROM cte'), true);
  });

  test('rejects WITH containing INSERT', () => {
    assert.equal(isReadOnlyQuery('WITH x AS (SELECT 1) INSERT INTO t SELECT * FROM x'), false);
  });

  test('rejects WITH containing UPDATE', () => {
    assert.equal(isReadOnlyQuery('WITH x AS (SELECT 1) UPDATE t SET col=1'), false);
  });

  test('rejects WITH containing DELETE', () => {
    assert.equal(isReadOnlyQuery('WITH x AS (SELECT 1) DELETE FROM t'), false);
  });

  test('rejects WITH containing MERGE', () => {
    assert.equal(isReadOnlyQuery('WITH x AS (SELECT 1) MERGE INTO t USING x ON 1=1'), false);
  });

  test('rejects WITH containing TRUNCATE', () => {
    assert.equal(isReadOnlyQuery('WITH x AS (SELECT 1) TRUNCATE TABLE t'), false);
  });

  test('rejects WITH containing DROP', () => {
    assert.equal(isReadOnlyQuery('WITH x AS (SELECT 1) DROP TABLE t'), false);
  });

  test('rejects WITH containing ALTER', () => {
    assert.equal(isReadOnlyQuery('WITH x AS (SELECT 1) ALTER TABLE t ADD col INT'), false);
  });

  test('rejects INSERT', () => {
    assert.equal(isReadOnlyQuery('INSERT INTO t VALUES (1)'), false);
  });

  test('rejects UPDATE', () => {
    assert.equal(isReadOnlyQuery('UPDATE t SET x=1'), false);
  });

  test('rejects DELETE', () => {
    assert.equal(isReadOnlyQuery('DELETE FROM t'), false);
  });

  test('rejects CREATE', () => {
    assert.equal(isReadOnlyQuery('CREATE TABLE t (id INT)'), false);
  });

  test('rejects DROP', () => {
    assert.equal(isReadOnlyQuery('DROP TABLE t'), false);
  });

  test('rejects empty string', () => {
    assert.equal(isReadOnlyQuery(''), false);
  });
});

// ── detectInjectionPatterns ──────────────────────────────────

describe('detectInjectionPatterns', () => {
  test('returns null for clean queries', () => {
    assert.equal(detectInjectionPatterns('SELECT * FROM users WHERE id = 1'), null);
    assert.equal(detectInjectionPatterns('INSERT INTO t (name) VALUES (?)'), null);
    assert.equal(detectInjectionPatterns('UPDATE t SET x=1 WHERE id=?'), null);
  });

  test('detects multi-statement injection', () => {
    const result = detectInjectionPatterns('SELECT * FROM users; DROP TABLE users');
    assert.ok(result);
    assert.match(result, /多语句注入/);
  });

  test('detects UNION injection', () => {
    const result = detectInjectionPatterns("SELECT * FROM users WHERE id=1 UNION SELECT password FROM admin");
    assert.ok(result);
    assert.match(result, /UNION 注入/);
  });

  test('detects always-true condition (OR 1=1)', () => {
    const result = detectInjectionPatterns("SELECT * FROM users WHERE id=1 OR 1=1");
    assert.ok(result);
    assert.match(result, /永真条件注入/);
  });

  test('detects string always-true injection', () => {
    const result = detectInjectionPatterns("SELECT * FROM users WHERE name='x' OR 'a'='a'");
    assert.ok(result);
    assert.match(result, /字符串永真注入/);
  });

  test('detects condition probing (AND 1=1)', () => {
    const result = detectInjectionPatterns('SELECT * FROM users WHERE id=1 AND 1=1');
    assert.ok(result);
    assert.match(result, /条件探测/);
  });

  test('detects sleep-based blind injection', () => {
    const result = detectInjectionPatterns('SELECT * FROM users WHERE id=1 AND SLEEP(5)');
    assert.ok(result);
    assert.match(result, /时间盲注/);
  });

  test('detects benchmark-based blind injection', () => {
    const result = detectInjectionPatterns('SELECT * FROM users WHERE id=1 AND BENCHMARK(1000000,SHA1("test"))');
    assert.ok(result);
    assert.match(result, /时间盲注/);
  });

  test('detects WAITFOR DELAY (MSSQL blind injection)', () => {
    const result = detectInjectionPatterns("SELECT * FROM users; WAITFOR DELAY '0:0:5'");
    assert.ok(result);
    assert.match(result, /时间盲注/);
  });

  test('detects LOAD_FILE injection', () => {
    const result = detectInjectionPatterns("SELECT LOAD_FILE('/etc/passwd')");
    assert.ok(result);
    assert.match(result, /文件读取注入/);
  });

  test('detects INTO OUTFILE injection', () => {
    const result = detectInjectionPatterns("SELECT * INTO OUTFILE '/tmp/dump.txt' FROM users");
    assert.ok(result);
    assert.match(result, /文件写入注入/);
  });

  test('detects information_schema probing', () => {
    const result = detectInjectionPatterns('SELECT * FROM information_schema.tables');
    assert.ok(result);
    assert.match(result, /系统表探测/);
  });

  test('ignores patterns inside quoted strings', () => {
    // Single-quoted strings should be stripped
    assert.equal(detectInjectionPatterns("SELECT * FROM t WHERE name = 'OR 1=1'"), null);
  });

  test('ignores patterns inside comments', () => {
    assert.equal(detectInjectionPatterns('SELECT * FROM t -- OR 1=1'), null);
  });

  test('ignores patterns inside block comments', () => {
    assert.equal(detectInjectionPatterns('SELECT * FROM t /* UNION SELECT */'), null);
  });
});

// ── checkDangerousOperation ──────────────────────────────────

describe('checkDangerousOperation', () => {
  test('blocks TRUNCATE', () => {
    const result = checkDangerousOperation('TRUNCATE TABLE users');
    assert.ok(result);
    assert.match(result, /TRUNCATE/);
  });

  test('blocks DROP', () => {
    const result = checkDangerousOperation('DROP TABLE users');
    assert.ok(result);
    assert.match(result, /DROP/);
  });

  test('blocks ALTER', () => {
    const result = checkDangerousOperation('ALTER TABLE users ADD COLUMN x INT');
    assert.ok(result);
    assert.match(result, /ALTER/);
  });

  test('blocks DELETE without WHERE', () => {
    const result = checkDangerousOperation('DELETE FROM users');
    assert.equal(result, '危险操作：DELETE 或 UPDATE 语句缺少 WHERE 子句，拒绝执行');
  });

  test('blocks UPDATE without WHERE', () => {
    const result = checkDangerousOperation('UPDATE users SET x=1');
    assert.equal(result, '危险操作：DELETE 或 UPDATE 语句缺少 WHERE 子句，拒绝执行');
  });

  test('allows DELETE with WHERE', () => {
    assert.equal(checkDangerousOperation('DELETE FROM users WHERE id=1'), null);
  });

  test('allows UPDATE with WHERE', () => {
    assert.equal(checkDangerousOperation('UPDATE users SET x=1 WHERE id=1'), null);
  });

  test('allows INSERT', () => {
    assert.equal(checkDangerousOperation('INSERT INTO users (name) VALUES (?)'), null);
  });

  test('allows SELECT', () => {
    assert.equal(checkDangerousOperation('SELECT * FROM users'), null);
  });

  test('detects injection in dangerous check', () => {
    const result = checkDangerousOperation('SELECT * FROM users; DROP TABLE users');
    assert.ok(result);
  });

  test('blocks case-insensitive TRUNCATE', () => {
    const result = checkDangerousOperation('  truncate table users');
    assert.ok(result);
  });

  test('blocks case-insensitive DROP', () => {
    const result = checkDangerousOperation('  DROP TABLE users');
    assert.ok(result);
  });
});
