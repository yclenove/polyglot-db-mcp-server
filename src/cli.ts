/**
 * CLI 入口。
 *
 * 支持的子命令：
 *   init  — 生成最小可运行 .env 配置
 *   test  — 测试所有配置的连接
 *   (无参数) — 启动 MCP 服务器（默认行为）
 */

import { createInterface } from 'node:readline';
import { existsSync, writeFileSync } from 'node:fs';
import { closeAll, createRegistryFromEnv, pingAll } from './bootstrap.js';
import {
  createErrorPayload,
  maskErrorCredentials,
  withErrorCode,
  type ErrorCode,
} from './core/error-codes.js';

const USAGE = `
polyglot-db-mcp-server - 多引擎数据库 MCP 服务器

用法:
  polyglot-db-mcp-server                    启动 MCP 服务器（默认）
  polyglot-db-mcp-server init               生成最小 SQLite .env
  polyglot-db-mcp-server init --stdout      仅打印模板，不写文件
  polyglot-db-mcp-server init --force       覆盖现有 .env
  polyglot-db-mcp-server init --interactive 打开旧版交互式向导
  polyglot-db-mcp-server test               测试所有配置的连接
  polyglot-db-mcp-server --transport http   启动 Streamable HTTP 服务器
  polyglot-db-mcp-server --help             显示帮助

HTTP 常用参数:
  --transport stdio|http
  --host 127.0.0.1
  --port 3000
  --endpoint /mcp
`.trim();

const INIT_USAGE = `
polyglot-db-mcp-server init [--stdout] [--force] [--path <file>] [--interactive]

默认行为:
  - 生成本地 SQLite 配置: file:./data/local.db
  - 写入 .env
  - 如果目标文件已存在，不覆盖

选项:
  --stdout       打印模板，不写文件
  --force        覆盖目标文件
  --path <file>  写入指定文件，默认 .env
  --interactive  使用旧版交互式多引擎向导
`.trim();

interface InitOptions {
  stdout: boolean;
  force: boolean;
  path: string;
  interactive: boolean;
  help: boolean;
}

export function buildDefaultEnvContent(generatedAt: Date = new Date()): string {
  return `# polyglot-db-mcp-server 配置
# 由 init 生成于 ${generatedAt.toISOString()}
# 默认 SQLite 配置无需外部数据库服务。

DB_MCP_CONNECTIONS=[{"id":"local","engine":"sqlite","url":"file:./data/local.db","readonly":false}]
DB_MCP_DEFAULT_CONNECTION_ID=local

# 查询限制
DB_QUERY_TIMEOUT=30000
DB_MAX_ROWS=100
DB_MAX_SQL_LENGTH=102400
DB_RETRY_COUNT=2
DB_RETRY_DELAY_MS=200

# 安全与日志
DB_MASKING_MODE=off
LOG_LEVEL=info
LOG_FORMAT=human
`;
}

export function parseInitOptions(args: readonly string[]): InitOptions {
  const options: InitOptions = {
    stdout: false,
    force: false,
    path: '.env',
    interactive: false,
    help: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case '--stdout':
        options.stdout = true;
        break;
      case '--force':
        options.force = true;
        break;
      case '--interactive':
        options.interactive = true;
        break;
      case '--help':
      case '-h':
        options.help = true;
        break;
      case '--path': {
        const next = args[i + 1];
        if (!next) {
          throw new Error(withErrorCode('CLI_002', '--path 需要文件路径'));
        }
        options.path = next;
        i++;
        break;
      }
      default:
        throw new Error(withErrorCode('CLI_002', `未知参数 ${arg}`));
    }
  }

  return options;
}

function formatCliError(code: ErrorCode, details?: Record<string, unknown>): string {
  const payload = createErrorPayload(code, details);
  return `[${payload.code}] ${payload.message}\nHint: ${payload.hint}`;
}

function classifyConfigError(message: string): ErrorCode {
  if (message.includes('必须设置') || message.includes('未设置')) return 'CFG_001';
  if (message.includes('合法 JSON')) return 'CFG_002';
  if (message.includes('重复')) return 'CFG_003';
  if (message.includes('engine') || message.includes('引擎')) return 'CFG_004';
  return 'CFG_005';
}

function classifyConnectionError(message: string): ErrorCode {
  const lower = message.toLowerCase();
  if (
    lower.includes('timeout') ||
    lower.includes('timed out') ||
    lower.includes('etimedout') ||
    lower.includes('eai_again')
  ) {
    return 'CONN_002';
  }
  if (
    lower.includes('closed') ||
    lower.includes('reset') ||
    lower.includes('econnreset') ||
    lower.includes('lost') ||
    lower.includes('gone away')
  ) {
    return 'CONN_003';
  }
  if (lower.includes('pool') && (lower.includes('exhaust') || lower.includes('acquire'))) {
    return 'CONN_004';
  }
  return 'CONN_001';
}

function writeEnvFile(path: string, content: string, force: boolean): number {
  if (existsSync(path) && !force) {
    console.error(formatCliError('CLI_001', { path }));
    return 1;
  }

  try {
    writeFileSync(path, content, 'utf-8');
  } catch (e) {
    const msg = maskErrorCredentials(e instanceof Error ? e.message : String(e));
    console.error(formatCliError('CLI_003', { path, error: msg }));
    return 1;
  }

  console.log(`[OK] 已生成 ${path}`);
  console.log('下一步:');
  console.log('  1. 运行 polyglot-db-mcp-server test');
  console.log('  2. 在 MCP 客户端中配置 polyglot-db-mcp-server');
  console.log('  3. 调用 sql_query 执行 SELECT 1');
  return 0;
}

/** 生成最小 .env 配置 */
async function initCommand(args: readonly string[]): Promise<number> {
  let options: InitOptions;
  try {
    options = parseInitOptions(args);
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    return 1;
  }

  if (options.help) {
    console.log(INIT_USAGE);
    return 0;
  }

  if (options.interactive) {
    return interactiveInitCommand(options);
  }

  const envContent = buildDefaultEnvContent();
  if (options.stdout) {
    console.log(envContent);
    return 0;
  }

  return writeEnvFile(options.path, envContent, options.force);
}

/** 旧版交互式生成 .env 配置 */
async function interactiveInitCommand(options: InitOptions): Promise<number> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q: string): Promise<string> =>
    new Promise((resolve) => rl.question(q, (a) => resolve(a.trim())));

  console.log('=== polyglot-db-mcp-server 初始化向导 ===\n');

  const connections: Record<string, unknown>[] = [];

  const engines = ['mysql', 'postgres', 'mssql', 'oracle', 'mongodb', 'redis', 'sqlite'] as const;
  console.log('支持的引擎: ' + engines.join(', '));
  console.log('输入引擎名称添加连接，输入空行结束\n');

  while (true) {
    const engine = await ask('引擎（或空行结束）：');
    if (!engine) break;

    if (!engines.includes(engine as (typeof engines)[number])) {
      console.log(`  不支持的引擎: ${engine}，跳过\n`);
      continue;
    }

    const id = await ask('  连接 ID（字母数字下划线）：');
    if (!id) {
      console.log('  ID 不能为空，跳过\n');
      continue;
    }

    const conn: Record<string, unknown> = { id, engine };

    if (engine === 'sqlite') {
      const url = await ask('  SQLite URL（默认 file:./data/local.db）：');
      conn.url = url || 'file:./data/local.db';
    } else if (engine === 'redis' || engine === 'mongodb') {
      const url = await ask(
        `  ${engine} URL（如 ${engine === 'redis' ? 'redis://localhost:6379' : 'mongodb://localhost:27017/db'}）：`,
      );
      if (url) conn.url = url;

      if (engine === 'redis') {
        const prefix = await ask('  Key 前缀（可选，如 app:）：');
        if (prefix) conn.keyPrefix = prefix;
      }
    } else {
      const useUrl = await ask('  使用 URL 连接？(y/N)：');
      if (useUrl.toLowerCase() === 'y') {
        const url = await ask(`  ${engine} URL：`);
        if (url) conn.url = url;
      } else {
        conn.host = (await ask('  主机（默认 localhost）：')) || 'localhost';
        const portStr = await ask(
          `  端口（默认 ${engine === 'postgres' ? '5432' : engine === 'mysql' ? '3306' : engine === 'mssql' ? '1433' : '1521'}）：`,
        );
        if (portStr) conn.port = parseInt(portStr, 10);
        conn.user = await ask('  用户名：');
        conn.password = await ask('  密码：');
        conn.database = await ask('  数据库名：');
      }
    }

    const readonly = await ask('  只读模式？(y/N)：');
    if (readonly.toLowerCase() === 'y') conn.readonly = true;

    connections.push(conn);
    console.log(`  [OK] 已添加 ${engine} 连接「${id}」\n`);
  }

  rl.close();

  if (connections.length === 0) {
    console.log('未添加任何连接，退出。');
    return 1;
  }

  const envContent = `# polyglot-db-mcp-server 配置
# 由交互式 init 生成于 ${new Date().toISOString()}

DB_MCP_CONNECTIONS=${JSON.stringify(connections)}
DB_MCP_DEFAULT_CONNECTION_ID=${connections[0]!.id}

DB_QUERY_TIMEOUT=30000
DB_MAX_ROWS=100
DB_MAX_SQL_LENGTH=102400
LOG_LEVEL=info
LOG_FORMAT=human
`;

  if (options.stdout) {
    console.log(envContent);
    return 0;
  }

  return writeEnvFile(options.path, envContent, options.force);
}

/** 测试所有连接 */
async function testCommand(): Promise<number> {
  console.log('=== 连接测试 ===\n');

  let registry: Awaited<ReturnType<typeof createRegistryFromEnv>> | undefined;
  try {
    registry = await createRegistryFromEnv();
    const meta = registry.listMeta();
    console.log(`解析到连接: ${meta.length}`);
    console.log(`默认连接: ${registry.getDefaultId()}`);
    for (const m of meta) {
      console.log(`  - ${m.id} engine=${m.engine} readonly=${m.readonly}`);
    }
    console.log('');

    const pings = await pingAll(registry);
    for (const p of pings) {
      const m = meta.find((item) => item.id === p.id);
      const prefix = p.ok ? '[OK]' : '[FAIL]';
      const engine = m ? ` engine=${m.engine}` : '';
      const readonly = m ? ` readonly=${m.readonly}` : '';
      console.log(`  ${prefix} ${p.id}${engine}${readonly} (${p.latencyMs}ms)`);
      if (!p.ok) {
        const error = maskErrorCredentials(p.error ?? 'ping 失败');
        const errorInfo = createErrorPayload(classifyConnectionError(error), {
          connection_id: p.id,
          error,
        });
        console.log(`       error: ${error}`);
        console.log(`       code: ${errorInfo.code}`);
        console.log(`       hint: ${errorInfo.hint}`);
      }
    }

    const allOk = pings.every((p) => p.ok);
    console.log(`\n结果: ${allOk ? '全部通过' : '部分失败'}`);
    return allOk ? 0 : 1;
  } catch (e) {
    const msg = maskErrorCredentials(e instanceof Error ? e.message : String(e));
    const code = classifyConfigError(msg);
    console.error(formatCliError(code, { error: msg }));
    console.error(`Detail: ${msg}`);
    return 1;
  } finally {
    if (registry) {
      await closeAll(registry);
    }
  }
}

/** CLI 主入口 */
export async function runCli(): Promise<number> {
  const args = process.argv.slice(2);
  const command = args[0];

  switch (command) {
    case 'init':
      return initCommand(args.slice(1));
    case 'test':
      return testCommand();
    case '--help':
    case '-h':
      console.log(USAGE);
      return 0;
    default:
      console.error(withErrorCode('CLI_002', `未知命令 ${command ?? ''}`));
      return 1;
  }
}
