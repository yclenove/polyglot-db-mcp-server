/**
 * 跨 SQL 引擎的只读判断与危险语句拦截（启发式，与 mysql-mcp-server executor 对齐思路）
 */

function stripQuotedContentAndComments(sql: string): string {
  return sql
    .replace(/--.*$/gm, ' ')
    .replace(/#.*$/gm, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/'(?:''|[^'])*'/g, "''")
    .replace(/"(?:\\"|[^"])*"/g, '""')
    .replace(/`(?:``|[^`])*`/g, '``');
}

export function isReadOnlyQuery(sql: string): boolean {
  const t = sql.trim().toLowerCase();
  if (
    t.startsWith('select') ||
    t.startsWith('show') ||
    t.startsWith('describe') ||
    t.startsWith('desc') ||
    t.startsWith('explain')
  ) {
    return true;
  }
  if (t.startsWith('with')) {
    if (/\b(insert|update|delete|merge|truncate|drop|alter)\b/i.test(t)) return false;
    return true;
  }
  return false;
}

/**
 * 检测 SQL 注入模式
 */
export function detectInjectionPatterns(sql: string): string | null {
  const normalized = stripQuotedContentAndComments(sql).trim().toLowerCase();

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

export function checkDangerousOperation(sql: string): string | null {
  const normalized = stripQuotedContentAndComments(sql).trim().toLowerCase();

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
  const injection = detectInjectionPatterns(sql);
  if (injection) {
    return injection;
  }

  return null;
}
