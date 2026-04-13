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
  return null;
}
