/**
 * 智能查询建议模块 —— 规则引擎（非 ML）
 * ADR-007: 基于正则 + EXPLAIN 结果的规则引擎
 */

export interface Suggestion {
  type: 'index' | 'rewrite' | 'performance' | 'security';
  severity: 'info' | 'warn' | 'critical';
  message: string;
  suggestedSql?: string;
}

export interface AnalysisResult {
  sql: string;
  suggestions: Suggestion[];
  executionPlan?: Record<string, unknown>[];
}

export interface TableInfo {
  tableName: string;
  columns: Array<{ name: string; type: string; isPrimaryKey: boolean }>;
  indexes: Array<{ name: string; columns: string[] }>;
}

function getSuggestTimeoutFromEnv(): number {
  const raw = process.env.DB_SUGGEST_TIMEOUT_MS;
  if (!raw) return 5000;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : 5000;
}

function isTimedOut(startTime: number, timeout: number): boolean {
  return Date.now() - startTime > timeout;
}

function logTimeout(context: string, elapsed: number, timeout: number): void {
  console.warn(`[query-suggest] ${context} 超时: 耗时 ${elapsed}ms，限制 ${timeout}ms`);
}

// ── SQL 静态分析规则 ──────────────────────────────────────────

function stripComments(sql: string): string {
  return sql
    .replace(/--.*$/gm, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/'(?:''|[^'])*'/g, "''");
}

function detectSelectAll(sql: string): Suggestion | null {
  const normalized = stripComments(sql).trim().toLowerCase();
  if (/select\s+\*\s+from/i.test(normalized)) {
    return {
      type: 'rewrite',
      severity: 'warn',
      message: '检测到 SELECT *，建议明确列出需要的字段以减少网络传输和内存开销',
    };
  }
  return null;
}

function detectMissingWhere(sql: string): Suggestion | null {
  const normalized = stripComments(sql).trim().toLowerCase();
  if (!normalized.startsWith('select')) return null;
  // 检查是否有 WHERE（排除子查询中的 WHERE）
  if (!/\bwhere\b/.test(normalized)) {
    return {
      type: 'performance',
      severity: 'info',
      message: 'SELECT 语句缺少 WHERE 子句，可能导致全表扫描。如需全量数据请忽略此建议',
    };
  }
  return null;
}

function detectPrefixWildcard(sql: string): Suggestion | null {
  // 检查原始 SQL（stripComments 会替换引号内容导致丢失 LIKE 模式）
  if (/like\s+'%/i.test(sql)) {
    return {
      type: 'performance',
      severity: 'warn',
      message: '检测到 LIKE 模式以 % 开头，无法使用索引，可能导致全表扫描。考虑使用全文索引或反转索引',
    };
  }
  return null;
}

function detectSubquery(sql: string): Suggestion | null {
  const normalized = stripComments(sql).trim().toLowerCase();
  if (/\bwhere\b.*\bin\s*\(\s*select\b/i.test(normalized)) {
    return {
      type: 'rewrite',
      severity: 'info',
      message: '检测到 IN (SELECT ...) 子查询，考虑改写为 JOIN 以提升性能',
    };
  }
  if (/\bexists\s*\(\s*select\b/i.test(normalized)) {
    return {
      type: 'rewrite',
      severity: 'info',
      message: '检测到 EXISTS 子查询，确认是否可以改写为 JOIN 或半连接',
    };
  }
  return null;
}

function detectOrderByRand(sql: string): Suggestion | null {
  const normalized = stripComments(sql).trim().toLowerCase();
  if (/order\s+by\s+rand\s*\(/i.test(normalized)) {
    return {
      type: 'performance',
      severity: 'warn',
      message: 'ORDER BY RAND() 会导致全表扫描和临时表，考虑使用其他随机采样策略',
    };
  }
  return null;
}

function detectOrInWhere(sql: string): Suggestion | null {
  const normalized = stripComments(sql).trim().toLowerCase();
  const whereMatch = normalized.match(/\bwhere\b(.+?)(?:order|group|limit|$)/is);
  if (whereMatch && whereMatch[1] && /\bor\b/.test(whereMatch[1])) {
    return {
      type: 'index',
      severity: 'info',
      message: 'WHERE 中使用 OR 可能导致索引失效，考虑改写为 UNION ALL 或确认是否有复合索引覆盖',
    };
  }
  return null;
}

function detectImplicitConversion(sql: string): Suggestion | null {
  const normalized = stripComments(sql);
  // 检测数字与字符串比较的常见模式
  if (/where\s+\w+\s*=\s*\d+/.test(normalized) && /varchar|text|char/i.test(sql)) {
    return {
      type: 'performance',
      severity: 'info',
      message: '可能存在隐式类型转换，建议确保比较值类型与列类型一致',
    };
  }
  return null;
}

// ── EXPLAIN 结果分析规则 ──────────────────────────────────────

function detectFullTableScan(
  plan: Record<string, unknown>[],
  _engine: string
): Suggestion[] {
  const suggestions: Suggestion[] = [];

  for (const row of plan) {
    const type = String(row.type ?? row.Type ?? '').toLowerCase();
    const extra = String(row.Extra ?? row.extra ?? row.EXTRA ?? '').toLowerCase();
    const accessType = String(row.access_type ?? row.type ?? '').toLowerCase();

    if (accessType === 'all' || type === 'all') {
      suggestions.push({
        type: 'performance',
        severity: 'warn',
        message: '检测到全表扫描 (type=ALL)，建议添加合适的索引',
      });
    }

    if (extra.includes('filesort')) {
      suggestions.push({
        type: 'performance',
        severity: 'warn',
        message: '检测到文件排序 (Using filesort)，考虑为 ORDER BY 列添加索引',
      });
    }

    if (extra.includes('temporary')) {
      suggestions.push({
        type: 'performance',
        severity: 'warn',
        message: '检测到临时表 (Using temporary)，可能需要优化 GROUP BY 或 DISTINCT',
      });
    }
  }

  return suggestions;
}

function detectNoIndex(plan: Record<string, unknown>[]): Suggestion[] {
  const suggestions: Suggestion[] = [];

  for (const row of plan) {
    const key = String(row.key ?? row.Key ?? row.index_name ?? '').toLowerCase();
    const possibleKeys = String(row.possible_keys ?? row.Possible_keys ?? '');

    if (key === 'null' || key === '') {
      if (possibleKeys && possibleKeys !== 'null' && possibleKeys !== '') {
        suggestions.push({
          type: 'index',
          severity: 'warn',
          message: `EXPLAIN 显示 possible_keys=${possibleKeys} 但未使用索引（key=NULL），检查索引选择性`,
        });
      }
    }
  }

  return suggestions;
}

// ── 索引建议 ──────────────────────────────────────────

function extractWhereColumns(sql: string): string[] {
  const normalized = stripComments(sql).toLowerCase();
  const columns: string[] = [];

  // WHERE 子句中的列
  const whereMatch = normalized.match(/\bwhere\b(.+?)(?:order|group|limit|$)/is);
  if (whereMatch && whereMatch[1]) {
    const whereClause = whereMatch[1];
    // 匹配 column = value, column > value 等模式
    const colMatches = whereClause.matchAll(/\b([a-z_][a-z_0-9]*)\s*(?:=|>|<|>=|<=|<>|!=|like|in|between|is)\s/g);
    for (const m of colMatches) {
      const col = m[1];
      if (col && !['and', 'or', 'not', 'null', 'true', 'false'].includes(col)) {
        columns.push(col);
      }
    }
  }

  // ORDER BY 中的列
  const orderMatch = normalized.match(/\border\s+by\b(.+?)(?:limit|$)/is);
  if (orderMatch && orderMatch[1]) {
    const colMatches = orderMatch[1].matchAll(/\b([a-z_][a-z_0-9]*)\b\s*(?:asc|desc)?/g);
    for (const m of colMatches) {
      const col = m[1];
      if (col && !['asc', 'desc'].includes(col)) {
        columns.push(col);
      }
    }
  }

  return [...new Set(columns)];
}

function suggestIndexes(
  sql: string,
  tableInfo?: TableInfo[]
): Suggestion[] {
  if (!tableInfo || tableInfo.length === 0) return [];

  const suggestions: Suggestion[] = [];
  const whereCols = extractWhereColumns(sql);

  for (const table of tableInfo) {
    const indexedColumns = new Set<string>();
    for (const idx of table.indexes) {
      for (const col of idx.columns) {
        indexedColumns.add(col.toLowerCase());
      }
    }
    for (const col of table.columns) {
      if (col.isPrimaryKey) {
        indexedColumns.add(col.name.toLowerCase());
      }
    }

    const missingIndexCols = whereCols.filter((c) => !indexedColumns.has(c));
    if (missingIndexCols.length > 0) {
      suggestions.push({
        type: 'index',
        severity: 'info',
        message: `表 ${table.tableName} 的以下列缺少索引: ${missingIndexCols.join(', ')}。考虑创建索引以加速查询`,
        suggestedSql: `CREATE INDEX idx_${table.tableName}_${missingIndexCols.join('_')} ON ${table.tableName} (${missingIndexCols.join(', ')})`,
      });
    }
  }

  return suggestions;
}

// ── 主分析函数 ──────────────────────────────────────────

/**
 * 分析 SQL 并生成优化建议
 */
export function analyzeQuery(
  sql: string,
  tableInfo?: TableInfo[]
): Suggestion[] {
  const timeout = getSuggestTimeoutFromEnv();
  const startTime = Date.now();
  const suggestions: Suggestion[] = [];

  const checks = [
    detectSelectAll,
    detectMissingWhere,
    detectPrefixWildcard,
    detectSubquery,
    detectOrderByRand,
    detectOrInWhere,
    detectImplicitConversion,
  ];

  for (const check of checks) {
    if (isTimedOut(startTime, timeout)) {
      const elapsed = Date.now() - startTime;
      logTimeout('analyzeQuery 静态规则', elapsed, timeout);
      break;
    }
    const result = check(sql);
    if (result) suggestions.push(result);
  }

  // 索引建议（可能涉及复杂表结构，需独立检查超时）
  if (!isTimedOut(startTime, timeout)) {
    const indexSuggestions = suggestIndexes(sql, tableInfo);
    suggestions.push(...indexSuggestions);
  } else {
    const elapsed = Date.now() - startTime;
    logTimeout('suggestIndexes 跳过', elapsed, timeout);
  }

  return suggestions;
}

/**
 * 分析 EXPLAIN 结果并生成建议
 */
export function analyzeExplainPlan(
  plan: Record<string, unknown>[],
  engine: string
): Suggestion[] {
  const timeout = getSuggestTimeoutFromEnv();
  const startTime = Date.now();
  const suggestions: Suggestion[] = [];

  if (isTimedOut(startTime, timeout)) {
    logTimeout('analyzeExplainPlan', Date.now() - startTime, timeout);
    return suggestions;
  }

  suggestions.push(...detectFullTableScan(plan, engine));

  if (!isTimedOut(startTime, timeout)) {
    suggestions.push(...detectNoIndex(plan));
  } else {
    logTimeout('detectNoIndex 跳过', Date.now() - startTime, timeout);
  }

  return suggestions;
}

/**
 * 综合分析：SQL 静态分析 + EXPLAIN 结果分析
 */
export function generateAnalysis(
  sql: string,
  tableInfo?: TableInfo[],
  executionPlan?: Record<string, unknown>[],
  engine?: string
): AnalysisResult {
  const timeout = getSuggestTimeoutFromEnv();
  const startTime = Date.now();
  const suggestions: Suggestion[] = [];

  suggestions.push(...analyzeQuery(sql, tableInfo));

  if (executionPlan && engine && !isTimedOut(startTime, timeout)) {
    suggestions.push(...analyzeExplainPlan(executionPlan, engine));
  } else if (executionPlan && engine) {
    logTimeout('analyzeExplainPlan 跳过', Date.now() - startTime, timeout);
  }

  return {
    sql,
    suggestions,
    executionPlan,
  };
}
