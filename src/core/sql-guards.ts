/** 跨 SQL 引擎的只读判断与危险语句拦截。 */

import type { SqlEngine } from './types.js';

interface SqlScanResult {
  cleaned: string;
  statements: string[];
  terminatorIndexes: number[];
  tokens: SqlToken[];
  executableComment: boolean;
  unterminated: boolean;
}

interface SqlToken {
  kind: 'identifier' | 'literal' | 'symbol';
  value: string;
}

function scanSql(sql: string, engine: SqlEngine | 'generic' = 'generic'): SqlScanResult {
  let cleaned = '';
  const terminatorIndexes: number[] = [];
  const tokens: SqlToken[] = [];
  let executableComment = false;
  let unterminated = false;

  const readQuoted = (
    start: number,
    quote: string,
    doubledQuote: string,
  ): { end: number; value: string } => {
    let i = start + 1;
    let value = '';
    while (i < sql.length) {
      if (sql.startsWith(doubledQuote, i)) {
        value += quote;
        i += doubledQuote.length;
        continue;
      }
      if (sql[i] === quote) return { end: i + 1, value };
      value += sql[i];
      i++;
    }
    unterminated = true;
    return { end: sql.length, value };
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
    if (char === ';') terminatorIndexes.push(i);
    if (char === "'") {
      const quoted = readQuoted(i, "'", "''");
      cleaned += "''";
      tokens.push({ kind: 'literal', value: '' });
      i = quoted.end;
      continue;
    }
    if (char === '"') {
      const quoted = readQuoted(i, '"', '""');
      cleaned += '""';
      tokens.push({ kind: 'identifier', value: quoted.value.toLowerCase() });
      i = quoted.end;
      continue;
    }
    if (char === '`') {
      const quoted = readQuoted(i, '`', '``');
      cleaned += '``';
      tokens.push({ kind: 'identifier', value: quoted.value.toLowerCase() });
      i = quoted.end;
      continue;
    }
    if (char === '[') {
      const quoted = readQuoted(i, ']', ']]');
      cleaned += '[]';
      tokens.push({ kind: 'identifier', value: quoted.value.toLowerCase() });
      i = quoted.end;
      continue;
    }
    if (engine === 'postgres' && char === '$') {
      const match = /^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(i));
      if (match) {
        const delimiter = match[0];
        const end = sql.indexOf(delimiter, i + delimiter.length);
        cleaned += "''";
        tokens.push({ kind: 'literal', value: '' });
        if (end === -1) {
          unterminated = true;
          i = sql.length;
        } else {
          i = end + delimiter.length;
        }
        continue;
      }
    }

    if (/[a-z_]/i.test(char)) {
      let end = i + 1;
      while (end < sql.length && /[a-z0-9_$]/i.test(sql[end]!)) end++;
      const identifier = sql.slice(i, end).toLowerCase();
      cleaned += identifier;
      tokens.push({ kind: 'identifier', value: identifier });
      i = end;
      continue;
    }

    cleaned += char.toLowerCase();
    if (!/\s/.test(char)) tokens.push({ kind: 'symbol', value: char });
    i++;
  }

  const statements = cleaned
    .split(';')
    .map((statement) => statement.trim())
    .filter(Boolean);
  return { cleaned, statements, terminatorIndexes, tokens, executableComment, unterminated };
}

function stripQuotedContentAndComments(sql: string, engine?: SqlEngine): string {
  return scanSql(sql, engine).cleaned;
}

function topLevelKeywords(scan: SqlScanResult): string[] {
  if (scan.executableComment || scan.unterminated || scan.statements.length !== 1) return [];

  const keywords: string[] = [];
  const statement = scan.statements[0]!;
  let depth = 0;
  for (let i = 0; i < statement.length; ) {
    const char = statement[i]!;
    if (char === '(') {
      depth++;
      i++;
      continue;
    }
    if (char === ')') {
      depth = Math.max(0, depth - 1);
      i++;
      continue;
    }
    if (depth === 0 && /[a-z_]/.test(char)) {
      let end = i + 1;
      while (end < statement.length && /[a-z0-9_$]/.test(statement[end]!)) end++;
      keywords.push(statement.slice(i, end));
      i = end;
      continue;
    }
    i++;
  }
  return keywords;
}

const DANGEROUS_SQL_CAPABILITIES: Record<SqlEngine, Readonly<Record<string, string>>> = {
  postgres: {
    pg_read_file: '可读取数据库服务器文件',
    pg_read_binary_file: '可读取数据库服务器文件',
    pg_stat_file: '可探测数据库服务器文件',
    pg_ls_dir: '可枚举数据库服务器目录',
    pg_ls_logdir: '可枚举数据库服务器日志目录',
    pg_ls_waldir: '可枚举数据库服务器 WAL 目录',
    pg_ls_archive_statusdir: '可枚举数据库服务器归档目录',
    pg_ls_tmpdir: '可枚举数据库服务器临时目录',
    pg_ls_logicalsnapdir: '可枚举数据库服务器逻辑快照目录',
    pg_ls_logicalmapdir: '可枚举数据库服务器逻辑映射目录',
    pg_ls_replslotdir: '可枚举数据库服务器复制槽目录',
    pg_file_write: '可写入数据库服务器文件',
    pg_write_file: '可写入数据库服务器文件',
    pg_file_rename: '可重命名数据库服务器文件',
    pg_file_unlink: '可删除数据库服务器文件',
    pg_file_sync: '可操作数据库服务器文件',
    lo_import: '可从数据库服务器文件导入大对象',
    lo_export: '可向数据库服务器文件导出大对象',
    nextval: '会修改数据库序列状态',
    setval: '会修改数据库序列状态',
    set_config: '会修改数据库会话配置',
    pg_notify: '会向数据库会话发送通知',
    pg_sleep: '可阻塞数据库会话',
    pg_sleep_for: '可阻塞数据库会话',
    pg_sleep_until: '可阻塞数据库会话',
    pg_cancel_backend: '可中断其他数据库会话',
    pg_terminate_backend: '可终止其他数据库会话',
    pg_reload_conf: '可重载数据库服务器配置',
    pg_advisory_lock: '会占用数据库咨询锁',
    pg_advisory_lock_shared: '会占用数据库咨询锁',
    pg_try_advisory_lock: '会占用数据库咨询锁',
    pg_try_advisory_lock_shared: '会占用数据库咨询锁',
    pg_advisory_xact_lock: '会占用数据库咨询锁',
    pg_advisory_xact_lock_shared: '会占用数据库咨询锁',
    pg_try_advisory_xact_lock: '会占用数据库咨询锁',
    pg_try_advisory_xact_lock_shared: '会占用数据库咨询锁',
    pg_advisory_unlock: '会修改数据库咨询锁状态',
    pg_advisory_unlock_shared: '会修改数据库咨询锁状态',
    pg_advisory_unlock_all: '会修改数据库咨询锁状态',
    dblink: '可访问外部 PostgreSQL 连接',
    dblink_exec: '可在外部 PostgreSQL 连接执行 SQL',
    dblink_connect: '可建立外部 PostgreSQL 连接',
    dblink_connect_u: '可用明文凭据建立外部 PostgreSQL 连接',
  },
  mysql: {
    load_file: '可读取数据库服务器文件',
    sleep: '可阻塞数据库会话',
    benchmark: '可长时间占用数据库 CPU',
    get_lock: '会占用数据库命名锁',
    release_lock: '会修改数据库命名锁状态',
    release_all_locks: '会修改数据库命名锁状态',
    master_pos_wait: '可阻塞数据库会话等待复制进度',
    source_pos_wait: '可阻塞数据库会话等待复制进度',
    wait_for_executed_gtid_set: '可阻塞数据库会话等待复制进度',
    sys_exec: '可执行数据库服务器系统命令',
    sys_eval: '可执行数据库服务器系统命令',
  },
  mssql: {
    openrowset: '可读取数据库服务器文件或访问外部数据源',
    openquery: '可访问链接服务器',
    opendatasource: '可访问临时外部数据源',
    fn_get_audit_file: '可读取数据库服务器审计文件',
    fn_xe_file_target_read_file: '可读取数据库服务器扩展事件文件',
    fn_trace_gettable: '可读取数据库服务器跟踪文件',
    dm_os_file_exists: '可探测数据库服务器文件',
  },
  oracle: {
    'utl_file.fopen': '可访问数据库服务器文件',
    'utl_file.fopen_nchar': '可访问数据库服务器文件',
    'utl_file.fremove': '可删除数据库服务器文件',
    'utl_file.frename': '可重命名数据库服务器文件',
    'utl_file.fcopy': '可复制数据库服务器文件',
    'utl_http.request': '可访问外部网络',
    'utl_http.request_pieces': '可访问外部网络',
    'utl_http.begin_request': '可访问外部网络',
    'utl_tcp.open_connection': '可建立外部网络连接',
    'utl_inaddr.get_host_address': '可执行外部 DNS 查询',
    'utl_inaddr.get_host_name': '可执行外部 DNS 查询',
    'dbms_ldap.init': '可建立外部 LDAP 连接',
    'dbms_lock.sleep': '可阻塞数据库会话',
    'dbms_pipe.receive_message': '可阻塞数据库会话',
  },
  sqlite: {
    load_extension: '可加载数据库进程本地扩展',
    readfile: '可读取数据库服务器文件',
    writefile: '可写入数据库服务器文件',
  },
  duckdb: {},
};

function sqlFunctionCandidates(scan: SqlScanResult): string[][] {
  const calls: string[][] = [];
  for (let i = 1; i < scan.tokens.length; i++) {
    const token = scan.tokens[i]!;
    const previous = scan.tokens[i - 1]!;
    if (token.kind !== 'symbol' || token.value !== '(' || previous.kind !== 'identifier') {
      continue;
    }

    const parts = [previous.value];
    let cursor = i - 2;
    while (
      parts.length < 2 &&
      cursor >= 1 &&
      scan.tokens[cursor]!.kind === 'symbol' &&
      scan.tokens[cursor]!.value === '.' &&
      scan.tokens[cursor - 1]!.kind === 'identifier'
    ) {
      parts.unshift(scan.tokens[cursor - 1]!.value);
      cursor -= 2;
    }
    const qualifiedName = parts.join('.');
    calls.push(
      qualifiedName === previous.value ? [previous.value] : [qualifiedName, previous.value],
    );
  }
  return calls;
}

function dangerousSqlCapabilityFromScan(scan: SqlScanResult, engine?: SqlEngine): string | null {
  const engines: readonly SqlEngine[] = engine
    ? [engine]
    : ['postgres', 'mysql', 'mssql', 'oracle', 'sqlite', 'duckdb'];

  for (const candidates of sqlFunctionCandidates(scan)) {
    for (const candidateEngine of engines) {
      const rules = DANGEROUS_SQL_CAPABILITIES[candidateEngine];
      for (const candidate of candidates) {
        const description = rules[candidate];
        if (description) {
          return `危险 SQL 能力：${candidate} ${description}，拒绝执行`;
        }
      }
    }
  }
  return null;
}

/** Detect function-shaped SQL that can escape a read-only data boundary. */
export function detectDangerousSqlCapability(sql: string, engine?: SqlEngine): string | null {
  return dangerousSqlCapabilityFromScan(scanSql(sql, engine), engine);
}

export function isReadOnlyQuery(sql: string, engine?: SqlEngine): boolean {
  const scan = scanSql(sql, engine);
  if (scan.executableComment || scan.unterminated || scan.statements.length !== 1) return false;
  if (dangerousSqlCapabilityFromScan(scan, engine)) return false;

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

export function firstSqlKeyword(sql: string, engine?: SqlEngine): string | undefined {
  const scan = scanSql(sql, engine);
  if (scan.executableComment || scan.unterminated || scan.statements.length !== 1) {
    return undefined;
  }
  return /^([a-z]+)/.exec(scan.statements[0]!)?.[1];
}

export interface SqlPaginationAnalysis {
  hasTopLevelOrderBy: boolean;
  hasTopLevelRowLimit: boolean;
}

/** Inspect only executable, outer-query keywords used by automatic pagination. */
export function analyzeSqlPagination(sql: string, engine?: SqlEngine): SqlPaginationAnalysis {
  const keywords = topLevelKeywords(scanSql(sql, engine));
  const hasTopLevelOrderBy = keywords.some(
    (keyword, index) => keyword === 'order' && keywords[index + 1] === 'by',
  );
  const rowLimitKeywords = new Set(['limit', 'offset', 'fetch']);
  if (engine === 'mssql') rowLimitKeywords.add('top');
  return {
    hasTopLevelOrderBy,
    hasTopLevelRowLimit: keywords.some((keyword) => rowLimitKeywords.has(keyword)),
  };
}

/** Remove statement terminators while preserving quoted/commented semicolons. */
export function stripSqlStatementTerminators(sql: string, engine?: SqlEngine): string {
  const scan = scanSql(sql, engine);
  if (scan.executableComment || scan.unterminated) return sql;
  const terminators = new Set(scan.terminatorIndexes);
  return sql
    .split('')
    .map((char, index) => (terminators.has(index) ? ' ' : char))
    .join('');
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

  const dangerousCapability = detectDangerousSqlCapability(sql, engine);
  if (dangerousCapability) {
    return dangerousCapability;
  }

  // 检测注入模式
  const injection = detectInjectionPatterns(sql, engine);
  if (injection) {
    return injection;
  }

  return null;
}
