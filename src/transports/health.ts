import type { ConnectionRegistry } from '../core/registry.js';
import { getVersion } from '../core/version.js';

export interface PingSummary {
  id: string;
  ok: boolean;
  latencyMs: number;
  error?: string;
}

export function healthPayload(startedAt: Date = new Date()): Record<string, unknown> {
  return {
    status: 'healthy',
    service: 'polyglot-db-mcp-server',
    version: getVersion(),
    uptime_ms: Math.max(0, Date.now() - startedAt.getTime()),
  };
}

export function readinessPayload(
  registry: ConnectionRegistry | undefined,
  pings: readonly PingSummary[] | undefined,
): { statusCode: number; payload: Record<string, unknown> } {
  if (!registry) {
    return {
      statusCode: 503,
      payload: {
        status: 'not_ready',
        version: getVersion(),
        reason: 'registry_not_loaded',
      },
    };
  }

  const defaultId = registry.getDefaultId();
  const defaultPing = pings?.find((p) => p.id === defaultId);
  const failed = (pings ?? []).filter((p) => !p.ok);
  const ready = defaultPing?.ok !== false;

  return {
    statusCode: ready ? 200 : 503,
    payload: {
      status: ready ? (failed.length > 0 ? 'degraded' : 'ready') : 'not_ready',
      version: getVersion(),
      default_connection: defaultId,
      total_connections: registry.listMeta().length,
      failed_connections: failed.map((p) => ({ id: p.id, error: p.error })),
    },
  };
}
