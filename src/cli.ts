/**
 * CLI 入口
 * 支持的子命令：
 *   init  — 交互式生成 .env 配置
 *   test  — 测试所有配置的连接
 *   (无参数) — 启动 MCP 服务器（默认行为）
 */

import { createInterface } from 'node:readline';
import { writeFileSync, existsSync } from 'node:fs';
import { closeAll, createRegistryFromEnv, pingAll } from './bootstrap.js';

const USAGE = `
polyglot-db-mcp-server — 多引擎数据库 MCP 服务器

用法：
  polyglot-db-mcp-server          启动 MCP 服务器（默认）
  polyglot-db-mcp-server init     交互式生成 .env 配置
  polyglot-db-mcp-server test     测试所有配置的连接
  polyglot-db-mcp-server --help   显示帮助
`.trim();

/** 交互式生成 .env 配置 */
async function initCommand(): Promise<void> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q: string): Promise<string> =>
    new Promise((resolve) => rl.question(q, (a) => resolve(a.trim())));

  console.log('=== polyglot-db-mcp-server 初始化向导 ===\n');

  const connections: Record<string, unknown>[] = [];

  const engines = ['mysql', 'postgres', 'mssql', 'oracle', 'mongodb', 'redis'] as const;
  console.log('支持的引擎：' + engines.join(', '));
  console.log('输入引擎名称添加连接，输入空行结束\n');

  while (true) {
    const engine = await ask('引擎（或空行结束）：');
    if (!engine) break;

    if (!engines.includes(engine as (typeof engines)[number])) {
      console.log(`  不支持的引擎：${engine}，跳过\n`);
      continue;
    }

    const id = await ask('  连接 ID（字母数字下划线）：');
    if (!id) {
      console.log('  ID 不能为空，跳过\n');
      continue;
    }

    const conn: Record<string, unknown> = { id, engine };

    if (engine === 'redis' || engine === 'mongodb') {
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
    console.log(`  ✓ 已添加 ${engine} 连接「${id}」\n`);
  }

  rl.close();

  if (connections.length === 0) {
    console.log('未添加任何连接，退出。');
    return;
  }

  const envContent = `# polyglot-db-mcp-server 配置
# 由 init 向导生成于 ${new Date().toISOString()}

DB_MCP_CONNECTIONS='${JSON.stringify(connections, null, 2)}'
DB_MCP_DEFAULT_CONNECTION_ID=${connections[0]!.id}

# 可选配置
# DB_QUERY_TIMEOUT=30000
# DB_MAX_ROWS=100
# DB_MAX_SQL_LENGTH=102400
# DB_RETRY_COUNT=2
# DB_RETRY_DELAY_MS=200
# DB_SLOW_QUERY_MS=5000
# LOG_LEVEL=info
# LOG_FORMAT=human
`;

  if (existsSync('.env')) {
    console.log('⚠ .env 文件已存在，输出到 stdout：\n');
    console.log(envContent);
  } else {
    writeFileSync('.env', envContent, 'utf-8');
    console.log('✓ 已生成 .env 文件');
  }

  console.log('\n下一步：');
  console.log('  1. 检查 .env 中的连接信息');
  console.log('  2. 运行 polyglot-db-mcp-server test 测试连接');
  console.log('  3. 在 MCP 客户端中配置此服务器');
}

/** 测试所有连接 */
async function testCommand(): Promise<void> {
  console.log('=== 连接测试 ===\n');

  try {
    const registry = await createRegistryFromEnv();
    const pings = await pingAll(registry);

    for (const p of pings) {
      const icon = p.ok ? '✓' : '✗';
      const latency = p.ok ? ` (${p.latencyMs}ms)` : '';
      const error = p.error ? ` — ${p.error}` : '';
      console.log(`  ${icon} ${p.id}${latency}${error}`);
    }

    const allOk = pings.every((p) => p.ok);
    console.log(`\n结果：${allOk ? '全部通过' : '部分失败'}`);

    await closeAll(registry);
    process.exit(allOk ? 0 : 1);
  } catch (e) {
    console.error('错误：', e instanceof Error ? e.message : String(e));
    process.exit(1);
  }
}

/** CLI 主入口 */
export async function runCli(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0];

  switch (command) {
    case 'init':
      await initCommand();
      break;
    case 'test':
      await testCommand();
      break;
    case '--help':
    case '-h':
      console.log(USAGE);
      break;
    default:
      // 默认行为：启动 MCP 服务器（由 index.ts 处理）
      break;
  }
}
