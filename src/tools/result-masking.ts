import type { MaskingConfig, MaskingMode } from '../core/data-masking.js';
import { applyMasking } from '../core/data-masking.js';
import { getRequestPolicyConditions } from '../auth/request-policy.js';
import { getMaskingConfig } from './masking.js';

type Row = Record<string, unknown>;

const MASKING_MODE_RANK: Record<MaskingMode, number> = {
  off: 0,
  loose: 1,
  'strict-v2': 2,
  strict: 3,
};

function isRecord(value: unknown): value is Row {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function effectiveMaskingConfig(): MaskingConfig {
  const base = getMaskingConfig();
  const forcedMode = getRequestPolicyConditions()?.maskingMode;
  if (!forcedMode) return base;

  const shouldForce = MASKING_MODE_RANK[forcedMode] > MASKING_MODE_RANK[base.mode];
  if (!shouldForce) return base;

  return {
    ...base,
    mode: forcedMode,
    enabled: forcedMode !== 'off',
  };
}

export function maskResultRows<T>(rows: T[]): T[] {
  const config = effectiveMaskingConfig();
  if (!config.enabled || config.mode === 'off' || rows.length === 0) return rows;

  return rows.map((row) => {
    if (!isRecord(row)) return row;
    return applyMasking([row], config)[0] as T;
  });
}

export function withMaskedDataRows<T extends { data?: unknown[] }>(result: T): T {
  if (!result.data) return result;
  return { ...result, data: maskResultRows(result.data) };
}
