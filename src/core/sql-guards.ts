/** 跨 SQL 引擎的只读判断与危险语句拦截。 */

import type { SqlEngine } from './types.js';

interface SqlScanResult {
  cleaned: string;
  statements: string[];
  executableComment: boolean;
  unterminated: boolean;
}

function scanSql(sql: string, engine: SqlEngine | 'generic' = 'generic'): SqlScanResult {
  let cleaned = '';
  let executableComment = false;
  let unterminated = false;

  const skipQuoted = (start: number, quote: string, doubledQuote: string): number => {
    let i = start + 1;
    while (i < sql.length) {
      if (sql.startsWith(doubledQuote, i)) {
        i += doubledQuote.length;
        continue;
      }
      if (sql[i] === quote) return i + 1;
      i++;
    }
    unterminated = true;
    return sql.length;
  };

  for (let i = 0; i < sql.length; ) {
    const mysqlStyleDashComment =
      sql.startsWith('--', i) && (i + 2 === sql.length || /\s/.test(sql[i + 2]!));
    if (
      sql.startsWith('--', i) &&
      ((engine !== 'mysql' && engine !== 'generic') || mysqlStyleDashComment)
    ) {
      const end = sql.indexOf('\n', i + 2);
      cleaned += ' ';
      i = end === -1 ? sql.length : end + 1;
      continue;
    }

    if (engine === 'mysql' && sql[i] === '#') {
      const end = sql.indexOf('\n', i + 1);
      cleaned += ' ';
      i = end === -1 ? sql.length : end + 1;
      continue;
    }

    if (sql.startsWith('/*', i)) {
      const marker = sql.slice(i + 2, i + 4).toLowerCase();
      if (marker.startsWith('!') || marker === 'm!') executableComment = true;
      const supportsNestedComments = engine === 'postgres' || engine === 'mssql';
      let j: number;
      if (supportsNestedComments) {
        let depth = 1;
        j = i + 2;
        while (j < sql.length && depth > 0) {
          if (sql.startsWith('/*', j)) {
            depth++;
            j += 2;
          } else if (sql.startsWith('*/', j)) {
            depth--;
            j += 2;
          } else {
            j++;
          }
        }
        if (depth > 0) unterminated = true;
      } else {
        const end = sql.indexOf('*/', i + 2);
        if (end === -1) {
          unterminated = true;
          j = sql.length;
        } else {
          j = end + 2;
        }
      }
      cleaned += ' ';
      i = j;
      continue;
    }

    const char = sql[i]!;
    if (char === "'") {
      cleaned += "''";
      i = skipQuoted(i, "'", "''");
      continue;
    }
    if (char === '"') {
      cleaned += '""';
      i = skipQuoted(i, '"', '""');
      continue;
    }
    if (char === '`') {
      cleaned += '``';
      i = skipQuoted(i, '`', '``');
      continue;
    }
    if (char === '[') {
      const end = sql.indexOf(']', i + 1);
      cleaned += '[]';
      if (end === -1) {
        unterminated = true;
        i = sql.length;
      } else {
        i = end + 1;
      }
      continue;
    }
    if (engine === 'postgres' && char === '$') {
      const match = /^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(i));
      if (match) {
        const delimiter = match[0];
        const end = sql.indexOf(delimiter, i + delimiter.length);
        cleaned += "''";
        if (end === -1) {
          unterminated = true;
          i = sql.length;
        } else {
          i = end + delimiter.length;
        }
        continue;
      }
    }

    cleaned += char.toLowerCase();
    i++;
  }

  const statements = cleaned
    .split(';')
    .map((statement) => statement.trim())
    .filter(Boolean);
  return { cleaned, statements, executableComment, unterminated };
}

function stripQuotedContentAndComments(sql: string, engine?: SqlEngine): string {
  return scanSql(sql, engine).cleaned;
}

export function isReadOnlyQuery(sql: string, engine?: SqlEngine): boolean {
  const scan = scanSql(sql, engine);
  if (scan.executableComment || scan.unterminated || scan.statements.length !== 1) return false;

  const statement = scan.statements[0]!;
  const firstKeyword = /^([a-z]+)/.exec(statement)?.[1];
  if (firstKeyword === 'show' || firstKeyword === 'describe' || firstKeyword === 'desc') {
    return true;
  }
  if (!['select', 'with', 'explain'].includes(firstKeyword ?? '')) return false;

  const mutatingOrDynamic =
    /\b(insert|update|delete|merge|truncate|drop|alter|create|grant|revoke|call|exec|execute|sp_executesql|xp_cmdshell|copy|attach|detach|vacuum|reindex|refresh|cluster)\b/;
  if (mutatingOrDynamic.test(statement)) return false;
  if (/\bselect\b[\s\S]*\binto\b/.test(statement)) return false;
  if (/\bfor\s+(?:no\s+key\s+)?update\b|\bfor\s+(?:key\s+)?share\b/.test(statement)) {
    return false;
  }
  return true;
}

/**
 * 检测 SQL 注入模式
 */
export function detectInjectionPatterns(sql: string, engine?: SqlEngine): string | null {
  const scan = scanSql(sql, engine);
  if (scan.executableComment) {
    return '潜在 SQL 注入风险：可执行条件注释';
  }
  const normalized = scan.cleaned.trim().toLowerCase();

  // 检测常见的 SQL 注入模式
  const injectionPatterns = [
    { pattern: /;\s*(drop|truncate|alter|delete|update|insert)\b/i, desc: '多语句注入' },
    { pattern: /;\s*exec\s*\(/i, desc: '堆叠查询执行' },
    { pattern: /union\s+select/i, desc: 'UNION 注入' },
    { pattern: /or\s+1\s*=\s*1/i, desc: '永真条件注入' },
    { pattern: /or\s+'[^']*'\s*=\s*'[^']*'/i, desc: '字符串永真注入' },
    { pattern: /or\s+\d+\s*=\s*\d+/i, desc: '数字永真注入' },
    { pattern: /and\s+1\s*=\s*1/i, desc: '条件探测' },
    { pattern: /sleep\s*\(/i, desc: '时间盲注' },
    { pattern: /benchmark\s*\(/i, desc: '时间盲注' },
    { pattern: /waitfor\s+delay/i, desc: '时间盲注' },
    { pattern: /pg_sleep\s*\(/i, desc: 'PostgreSQL 时间盲注' },
    { pattern: /load_file\s*\(/i, desc: '文件读取注入' },
    { pattern: /into\s+outfile/i, desc: '文件写入注入' },
    { pattern: /into\s+dumpfile/i, desc: '文件写入注入' },
    { pattern: /information_schema/i, desc: '系统表探测' },
    { pattern: /sys\.all_tables/i, desc: 'Oracle 系统表探测' },
    { pattern: /sys\.all_tab_columns/i, desc: 'Oracle 系统列探测' },
    { pattern: /xp_cmdshell/i, desc: 'MSSQL 命令执行' },
    { pattern: /sp_executesql/i, desc: 'MSSQL 动态执行' },
    { pattern: /char\s*\(\s*\d+(\s*,\s*\d+)+\s*\)/i, desc: 'CHAR 编码绕过' },
    { pattern: /0x[0-9a-f]{6,}/i, desc: '十六进制编码注入' },
    { pattern: /having\s+\d+\s*=\s*\d+/i, desc: 'HAVING 注入探测' },
    { pattern: /;\s*shutdown\b/i, desc: '数据库关闭注入' },
    { pattern: /@@version/i, desc: '版本信息泄露探测' },
    { pattern: /@@datadir/i, desc: '数据目录探测' },
    { pattern: /\/etc\/passwd/i, desc: '系统文件读取' },
    { pattern: /\/etc\/shadow/i, desc: '系统文件读取' },
  ];

  for (const { pattern, desc } of injectionPatterns) {
    if (pattern.test(normalized)) {
      return `潜在 SQL 注入风险：${desc}`;
    }
  }

  return null;
}

export function checkDangerousOperation(sql: string, engine?: SqlEngine): string | null {
  const normalized = stripQuotedContentAndComments(sql, engine).trim().toLowerCase();

  if (normalized.startsWith('truncate')) {
    return '危险操作：TRUNCATE 会清空整张表数据，拒绝执行';
  }
  if (normalized.startsWith('drop')) {
    return '危险操作：DROP 会删除数据库对象，拒绝执行';
  }
  if (normalized.startsWith('alter')) {
    return '危险操作：ALTER 会修改表结构，拒绝执行';
  }

  const isDeleteOrUpdate = normalized.startsWith('delete') || normalized.startsWith('update');
  const hasWhere = /\bwhere\b/.test(normalized);
  if (isDeleteOrUpdate && !hasWhere) {
    return '危险操作：DELETE 或 UPDATE 语句缺少 WHERE 子句，拒绝执行';
  }

  // 检测注入模式
  const injection = detectInjectionPatterns(sql, engine);
  if (injection) {
    return injection;
  }

  return null;
}
