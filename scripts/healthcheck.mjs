#!/usr/bin/env node
/**
 * MCP Server 容器健康检查脚本
 * 用法: node scripts/healthcheck.mjs
 *
 * 检查逻辑:
 *   1. 验证 DB_MCP_CONNECTIONS 可解析
 *   2. 验证关键环境变量格式合法
 *   3. HTTP 模式下请求 /readyz
 * 退出码 0 = 健康, 非 0 = 异常
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// 加载 .env（如果存在）
try {
  const envPath = resolve(__dirname, '..', '.env');
  const envContent = readFileSync(envPath, 'utf8');
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let value = trimmed.slice(eqIdx + 1).trim();
    if ((value.startsWith("'") && value.endsWith("'")) || (value.startsWith('"') && value.endsWith('"'))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
} catch {
  // .env 不存在时忽略
}

let exitCode = 0;

function check(label, fn) {
  try {
    fn();
    console.log(`[OK] ${label}`);
  } catch (e) {
    console.error(`[FAIL] ${label}: ${e.message}`);
    exitCode = 1;
  }
}

// 1. DB_MCP_CONNECTIONS 必须存在且为合法 JSON 数组
check('DB_MCP_CONNECTIONS', () => {
  const raw = process.env.DB_MCP_CONNECTIONS;
  if (!raw) throw new Error('未设置');
  const arr = JSON.parse(raw);
  if (!Array.isArray(arr) || arr.length === 0) {
    throw new Error('须为非空 JSON 数组');
  }
});

// 2. DB_MASKING_MODE 校验
check('DB_MASKING_MODE', () => {
  const val = process.env.DB_MASKING_MODE;
  if (val && !['strict', 'strict-v2', 'loose', 'off'].includes(val)) {
    throw new Error(`无效值 "${val}"，允许: strict, strict-v2, loose, off`);
  }
});

// 3. DB_REPLAY_BUFFER_SIZE 校验
check('DB_REPLAY_BUFFER_SIZE', () => {
  const val = process.env.DB_REPLAY_BUFFER_SIZE;
  if (val) {
    const n = parseInt(val, 10);
    if (!Number.isFinite(n) || n < 1) {
      throw new Error(`无效值 "${val}"，须为正整数`);
    }
  }
});

// 4. DB_SUGGEST_TIMEOUT_MS 校验
check('DB_SUGGEST_TIMEOUT_MS', () => {
  const val = process.env.DB_SUGGEST_TIMEOUT_MS;
  if (val) {
    const n = parseInt(val, 10);
    if (!Number.isFinite(n) || n < 100) {
      throw new Error(`无效值 "${val}"，须 >= 100`);
    }
  }
});

check('DB_MCP_TRANSPORT', () => {
  const val = process.env.DB_MCP_TRANSPORT || 'stdio';
  if (!['stdio', 'http'].includes(val)) {
    throw new Error(`无效值 "${val}"，允许: stdio, http`);
  }
});

async function checkHttpReadyz() {
  if ((process.env.DB_MCP_TRANSPORT || 'stdio') !== 'http') return;
  const configuredHost = process.env.DB_HTTP_HOST || '127.0.0.1';
  const host = configuredHost === '0.0.0.0' || configuredHost === '::' ? '127.0.0.1' : configuredHost;
  const port = process.env.DB_HTTP_PORT || '3000';
  const url = `http://${host}:${port}/readyz`;

  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    console.log(`[OK] HTTP readyz ${url}`);
  } catch (e) {
    console.error(`[FAIL] HTTP readyz ${url}: ${e.message}`);
    exitCode = 1;
  }
}

await checkHttpReadyz();
process.exit(exitCode);
