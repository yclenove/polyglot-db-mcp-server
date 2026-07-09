/**
 * SQL Guards 性能基准测试
 * 测试 SQL 注入检测和只读查询检查的性能
 */

import { isReadOnlyQuery, detectInjectionPatterns, checkDangerousOperation } from '../../dist/core/sql-guards.js';

const ITERATIONS = 10000;

function measureTime(fn, iterations = ITERATIONS) {
  const start = performance.now();
  for (let i = 0; i < iterations; i++) {
    fn();
  }
  const end = performance.now();
  return {
    totalMs: end - start,
    avgMs: (end - start) / iterations,
    opsPerSecond: Math.round(iterations / ((end - start) / 1000)),
  };
}

// 测试用例
const testQueries = [
  // 只读查询
  'SELECT * FROM users WHERE id = 1',
  'SELECT u.name, o.total FROM users u JOIN orders o ON u.id = o.user_id',
  'SELECT COUNT(*) FROM products WHERE price > 100',
  'SELECT * FROM users ORDER BY created_at DESC LIMIT 10',

  // 写入查询
  'INSERT INTO users (name, email) VALUES ($1, $2)',
  'UPDATE users SET name = $1 WHERE id = $2',
  'DELETE FROM users WHERE id = $1',

  // 危险操作
  'DROP TABLE users',
  'TRUNCATE TABLE users',
  'ALTER TABLE users ADD COLUMN age INT',

  // 注入尝试
  "SELECT * FROM users WHERE id = 1; DROP TABLE users--",
  "SELECT * FROM users WHERE id = 1 UNION SELECT * FROM passwords",
  "SELECT * FROM users WHERE 1=1 OR 1=1",
];

console.log('=== SQL Guards 性能基准测试 ===\n');

// 测试 isReadOnlyQuery
console.log('--- isReadOnlyQuery ---');
const readOnlyResults = testQueries.map(query => ({
  query: query.substring(0, 50) + (query.length > 50 ? '...' : ''),
  ...measureTime(() => isReadOnlyQuery(query)),
}));
readOnlyResults.forEach(r => {
  console.log(`  ${r.query.padEnd(55)} ${r.avgMs.toFixed(4)}ms (${r.opsPerSecond} ops/s)`);
});

// 测试 detectInjectionPatterns
console.log('\n--- detectInjectionPatterns ---');
const injectionResults = testQueries.map(query => ({
  query: query.substring(0, 50) + (query.length > 50 ? '...' : ''),
  ...measureTime(() => detectInjectionPatterns(query)),
}));
injectionResults.forEach(r => {
  console.log(`  ${r.query.padEnd(55)} ${r.avgMs.toFixed(4)}ms (${r.opsPerSecond} ops/s)`);
});

// 测试 checkDangerousOperation
console.log('\n--- checkDangerousOperation ---');
const dangerousResults = testQueries.map(query => ({
  query: query.substring(0, 50) + (query.length > 50 ? '...' : ''),
  ...measureTime(() => checkDangerousOperation(query)),
}));
dangerousResults.forEach(r => {
  console.log(`  ${r.query.padEnd(55)} ${r.avgMs.toFixed(4)}ms (${r.opsPerSecond} ops/s)`);
});

// 汇总统计
console.log('\n--- 汇总统计 ---');
const allResults = [...readOnlyResults, ...injectionResults, ...dangerousResults];
const totalOps = allResults.reduce((sum, r) => sum + r.opsPerSecond, 0);
const avgOps = Math.round(totalOps / allResults.length);
console.log(`  总操作数/秒: ${totalOps.toLocaleString()}`);
console.log(`  平均操作数/秒: ${avgOps.toLocaleString()}`);

// 输出 JSON 格式报告
const report = {
  timestamp: new Date().toISOString(),
  iterations: ITERATIONS,
  results: {
    isReadOnlyQuery: readOnlyResults.map(({ query, ...rest }) => rest),
    detectInjectionPatterns: injectionResults.map(({ query, ...rest }) => rest),
    checkDangerousOperation: dangerousResults.map(({ query, ...rest }) => rest),
  },
  summary: {
    totalOpsPerSecond: totalOps,
    averageOpsPerSecond: avgOps,
  },
};

// 写入报告文件
import { writeFileSync } from 'node:fs';
writeFileSync('test/benchmark/sql-guards-report.json', JSON.stringify(report, null, 2));
console.log('\n报告已写入: test/benchmark/sql-guards-report.json');
