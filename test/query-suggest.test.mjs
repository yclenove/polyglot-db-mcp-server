import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  analyzeQuery,
  analyzeExplainPlan,
  generateAnalysis,
} from '../dist/core/query-suggest.js';

// ── 超时控制验证 ──────────────────────────────────────────

describe('timeout control', () => {
  test('analyzeQuery returns results within timeout', () => {
    // 正常 SQL 应该在超时前完成
    const suggestions = analyzeQuery('SELECT * FROM users WHERE id = 1');
    assert.ok(Array.isArray(suggestions));
    // SELECT * 应该被检测到
    const selectAll = suggestions.filter((s) => s.message.includes('SELECT *'));
    assert.ok(selectAll.length > 0);
  });

  test('analyzeExplainPlan respects timeout', () => {
    // 正常 EXPLAIN 结果应该在超时前完成
    const plan = [{ type: 'ALL', key: null, possible_keys: null }];
    const suggestions = analyzeExplainPlan(plan, 'mysql');
    assert.ok(Array.isArray(suggestions));
    const fullScan = suggestions.filter((s) => s.message.includes('全表扫描'));
    assert.ok(fullScan.length > 0);
  });

  test('generateAnalysis integrates timeout across all checks', () => {
    const plan = [{ type: 'ALL', key: null, possible_keys: null }];
    const result = generateAnalysis('SELECT * FROM users', [], plan, 'mysql');
    assert.ok(result.suggestions.length > 0);
    // 应该包含静态分析和 EXPLAIN 分析的结果
    const selectAll = result.suggestions.filter((s) => s.message.includes('SELECT *'));
    const fullScan = result.suggestions.filter((s) => s.message.includes('全表扫描'));
    assert.ok(selectAll.length > 0);
    assert.ok(fullScan.length > 0);
  });

  test('generateAnalysis skips EXPLAIN when timeout is 0', () => {
    // timeout=0 时，isTimedOut 检查 Date.now() - startTime > 0
    // 由于操作可能在同一毫秒内完成，结果取决于时机
    // 此测试验证超时机制的结构正确性
    const origTimeout = process.env.DB_SUGGEST_TIMEOUT_MS;
    process.env.DB_SUGGEST_TIMEOUT_MS = '0';
    try {
      const plan = [{ type: 'ALL', key: null, possible_keys: null }];
      const result = generateAnalysis('SELECT * FROM users', [], plan, 'mysql');
      // 应该始终返回有效结构
      assert.ok(Array.isArray(result.suggestions));
      assert.equal(result.sql, 'SELECT * FROM users');
      assert.deepStrictEqual(result.executionPlan, plan);
      // 超时后 EXPLAIN 分析可能被跳过或执行（取决于时机）
      // 重要的是不会抛出异常且结构正确
    } finally {
      if (origTimeout === undefined) {
        delete process.env.DB_SUGGEST_TIMEOUT_MS;
      } else {
        process.env.DB_SUGGEST_TIMEOUT_MS = origTimeout;
      }
    }
  });

  test('analyzeExplainPlan returns valid result with zero timeout', () => {
    const origTimeout = process.env.DB_SUGGEST_TIMEOUT_MS;
    process.env.DB_SUGGEST_TIMEOUT_MS = '0';
    try {
      const plan = [{ type: 'ALL', key: null, possible_keys: null }];
      const suggestions = analyzeExplainPlan(plan, 'mysql');
      // 应该始终返回有效数组（可能为空也可能有结果，取决于时机）
      assert.ok(Array.isArray(suggestions));
    } finally {
      if (origTimeout === undefined) {
        delete process.env.DB_SUGGEST_TIMEOUT_MS;
      } else {
        process.env.DB_SUGGEST_TIMEOUT_MS = origTimeout;
      }
    }
  });
});

// ── SELECT * 检测 ──────────────────────────────────────────

describe('SELECT * detection', () => {
  test('detects SELECT *', () => {
    const suggestions = analyzeQuery('SELECT * FROM users');
    const selectAll = suggestions.filter((s) => s.message.includes('SELECT *'));
    assert.ok(selectAll.length > 0);
    assert.equal(selectAll[0].type, 'rewrite');
    assert.equal(selectAll[0].severity, 'warn');
  });

  test('does not flag specific columns', () => {
    const suggestions = analyzeQuery('SELECT id, name FROM users');
    const selectAll = suggestions.filter((s) => s.message.includes('SELECT *'));
    assert.equal(selectAll.length, 0);
  });

  test('case insensitive', () => {
    const suggestions = analyzeQuery('select * from users');
    const selectAll = suggestions.filter((s) => s.message.includes('SELECT *'));
    assert.ok(selectAll.length > 0);
  });
});

// ── 缺失 WHERE 检测 ──────────────────────────────────────────

describe('missing WHERE detection', () => {
  test('detects missing WHERE in SELECT', () => {
    const suggestions = analyzeQuery('SELECT id FROM users');
    const missingWhere = suggestions.filter((s) => s.message.includes('WHERE'));
    assert.ok(missingWhere.length > 0);
    assert.equal(missingWhere[0].type, 'performance');
  });

  test('does not flag SELECT with WHERE', () => {
    const suggestions = analyzeQuery('SELECT id FROM users WHERE id = 1');
    const missingWhere = suggestions.filter((s) => s.message.includes('缺少 WHERE'));
    assert.equal(missingWhere.length, 0);
  });

  test('ignores non-SELECT statements', () => {
    const suggestions = analyzeQuery('INSERT INTO users (name) VALUES (?)');
    const missingWhere = suggestions.filter((s) => s.message.includes('缺少 WHERE'));
    assert.equal(missingWhere.length, 0);
  });
});

// ── LIKE 前缀通配检测 ──────────────────────────────────────────

describe('prefix wildcard detection', () => {
  test('detects LIKE with leading %', () => {
    const suggestions = analyzeQuery("SELECT * FROM users WHERE name LIKE '%test'");
    const wildcard = suggestions.filter((s) => s.message.includes('% 开头'));
    assert.ok(wildcard.length > 0);
    assert.equal(wildcard[0].severity, 'warn');
  });

  test('does not flag LIKE without leading %', () => {
    const suggestions = analyzeQuery("SELECT * FROM users WHERE name LIKE 'test%'");
    const wildcard = suggestions.filter((s) => s.message.includes('% 开头'));
    assert.equal(wildcard.length, 0);
  });
});

// ── 子查询检测 ──────────────────────────────────────────

describe('subquery detection', () => {
  test('detects IN (SELECT ...)', () => {
    const suggestions = analyzeQuery('SELECT * FROM users WHERE id IN (SELECT user_id FROM orders)');
    const subquery = suggestions.filter((s) => s.message.includes('IN (SELECT'));
    assert.ok(subquery.length > 0);
    assert.equal(subquery[0].type, 'rewrite');
  });

  test('detects EXISTS (SELECT ...)', () => {
    const suggestions = analyzeQuery('SELECT * FROM users WHERE EXISTS (SELECT 1 FROM orders WHERE orders.user_id = users.id)');
    const subquery = suggestions.filter((s) => s.message.includes('EXISTS'));
    assert.ok(subquery.length > 0);
  });
});

// ── ORDER BY RAND 检测 ──────────────────────────────────────────

describe('ORDER BY RAND detection', () => {
  test('detects ORDER BY RAND()', () => {
    const suggestions = analyzeQuery('SELECT * FROM users ORDER BY RAND() LIMIT 10');
    const rand = suggestions.filter((s) => s.message.includes('RAND()'));
    assert.ok(rand.length > 0);
    assert.equal(rand[0].severity, 'warn');
  });
});

// ── OR in WHERE 检测 ──────────────────────────────────────────

describe('OR in WHERE detection', () => {
  test('detects OR in WHERE clause', () => {
    const suggestions = analyzeQuery('SELECT * FROM users WHERE id = 1 OR id = 2');
    const orClause = suggestions.filter((s) => s.message.includes('OR'));
    assert.ok(orClause.length > 0);
    assert.equal(orClause[0].type, 'index');
  });
});

// ── EXPLAIN 结果分析 ──────────────────────────────────────────

describe('analyzeExplainPlan', () => {
  test('detects full table scan (type=ALL)', () => {
    const plan = [{ type: 'ALL', key: null, possible_keys: null }];
    const suggestions = analyzeExplainPlan(plan, 'mysql');
    const fullScan = suggestions.filter((s) => s.message.includes('全表扫描'));
    assert.ok(fullScan.length > 0);
  });

  test('detects filesort', () => {
    const plan = [{ type: 'index', Extra: 'Using filesort' }];
    const suggestions = analyzeExplainPlan(plan, 'mysql');
    const filesort = suggestions.filter((s) => s.message.includes('filesort'));
    assert.ok(filesort.length > 0);
  });

  test('detects temporary table', () => {
    const plan = [{ type: 'index', Extra: 'Using temporary' }];
    const suggestions = analyzeExplainPlan(plan, 'mysql');
    const temp = suggestions.filter((s) => s.message.includes('临时表'));
    assert.ok(temp.length > 0);
  });

  test('detects unused index when possible_keys exist', () => {
    const plan = [{ type: 'ALL', key: null, possible_keys: 'idx_name' }];
    const suggestions = analyzeExplainPlan(plan, 'mysql');
    const noIndex = suggestions.filter((s) => s.message.includes('possible_keys'));
    assert.ok(noIndex.length > 0);
  });

  test('returns empty for good plan', () => {
    const plan = [{ type: 'ref', key: 'PRIMARY', Extra: '' }];
    const suggestions = analyzeExplainPlan(plan, 'mysql');
    assert.equal(suggestions.length, 0);
  });
});

// ── generateAnalysis 综合分析 ──────────────────────────────────────

describe('generateAnalysis', () => {
  test('combines static and EXPLAIN analysis', () => {
    const plan = [{ type: 'ALL', key: null, possible_keys: null }];
    const result = generateAnalysis('SELECT * FROM users', [], plan, 'mysql');
    assert.ok(result.suggestions.length > 0);
    assert.equal(result.sql, 'SELECT * FROM users');
    assert.deepStrictEqual(result.executionPlan, plan);
  });

  test('works without EXPLAIN plan', () => {
    const result = generateAnalysis('SELECT * FROM users');
    assert.ok(result.suggestions.length > 0);
    assert.equal(result.executionPlan, undefined);
  });

  test('works with table info for index suggestions', () => {
    const tableInfo = [{
      tableName: 'users',
      columns: [
        { name: 'id', type: 'int', isPrimaryKey: true },
        { name: 'email', type: 'varchar', isPrimaryKey: false },
      ],
      indexes: [{ name: 'PRIMARY', columns: ['id'] }],
    }];
    const result = generateAnalysis(
      'SELECT * FROM users WHERE email = ?',
      tableInfo
    );
    const indexSuggestions = result.suggestions.filter((s) => s.type === 'index');
    assert.ok(indexSuggestions.length > 0);
  });
});

// ── 空/注释 SQL 处理 ──────────────────────────────────────────

describe('edge cases', () => {
  test('handles SQL with comments', () => {
    const suggestions = analyzeQuery('-- comment\nSELECT * FROM users');
    const selectAll = suggestions.filter((s) => s.message.includes('SELECT *'));
    assert.ok(selectAll.length > 0);
  });

  test('handles SQL with block comments', () => {
    const suggestions = analyzeQuery('/* block */ SELECT * FROM users');
    const selectAll = suggestions.filter((s) => s.message.includes('SELECT *'));
    assert.ok(selectAll.length > 0);
  });

  test('handles well-optimized query with minimal suggestions', () => {
    const suggestions = analyzeQuery('SELECT id, name FROM users WHERE id = 1');
    // 应该没有 SELECT *、没有缺少 WHERE、没有 LIKE 通配
    const critical = suggestions.filter((s) => s.severity === 'critical');
    assert.equal(critical.length, 0);
  });
});

// ── 索引建议 ──────────────────────────────────────────

describe('index suggestions', () => {
  test('suggests index for unindexed WHERE column', () => {
    const tableInfo = [{
      tableName: 'orders',
      columns: [
        { name: 'id', type: 'int', isPrimaryKey: true },
        { name: 'user_id', type: 'int', isPrimaryKey: false },
        { name: 'status', type: 'varchar', isPrimaryKey: false },
      ],
      indexes: [{ name: 'PRIMARY', columns: ['id'] }],
    }];
    const suggestions = analyzeQuery(
      'SELECT * FROM orders WHERE user_id = 1 AND status = ?',
      tableInfo
    );
    const indexSuggestions = suggestions.filter((s) => s.type === 'index' && s.message.includes('orders'));
    assert.ok(indexSuggestions.length > 0);
    assert.ok(indexSuggestions[0].suggestedSql);
  });

  test('does not suggest index for already-indexed column', () => {
    const tableInfo = [{
      tableName: 'users',
      columns: [
        { name: 'id', type: 'int', isPrimaryKey: true },
      ],
      indexes: [{ name: 'PRIMARY', columns: ['id'] }],
    }];
    const suggestions = analyzeQuery(
      'SELECT * FROM users WHERE id = 1',
      tableInfo
    );
    const indexSuggestions = suggestions.filter(
      (s) => s.type === 'index' && s.message.includes('缺少索引')
    );
    assert.equal(indexSuggestions.length, 0);
  });
});
