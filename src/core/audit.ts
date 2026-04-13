import { appendFileSync, existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';

export function auditLog(entry: Record<string, unknown>): void {
  const path = process.env.MCP_AUDIT_LOG;
  if (!path) return;
  try {
    const dir = dirname(path);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    appendFileSync(path, JSON.stringify({ ts: new Date().toISOString(), ...entry }) + '\n', 'utf8');
  } catch {
    // 审计失败不阻断主流程
  }
}
