/**
 * 数据脱敏模块 —— 纯函数，工具层拦截，驱动层无感知
 * ADR-005: 工具层纯函数方案
 */

export type MaskingMode = 'off' | 'loose' | 'strict' | 'strict-v2';

export interface MaskingRule {
  name: string;
  fieldPatterns: RegExp[];
  valuePatterns: RegExp[];
  mask: (value: string) => string;
}

export interface MaskingConfig {
  mode: MaskingMode;
  enabled: boolean;
  rules: MaskingRule[];
  excludeFields: string[];
  excludeConnections: string[];
}

// ── 内置脱敏函数 ──────────────────────────────────────────

function maskPhone(value: string): string {
  if (value.length < 7) return value;
  return value.slice(0, 3) + '****' + value.slice(-4);
}

function maskEmail(value: string): string {
  const atIdx = value.indexOf('@');
  if (atIdx < 0) {
    if (value.length === 0) return value;
    if (value.length <= 2) return value[0] + '***';
    return value[0] + '***' + value.slice(-1);
  }
  const local = value.slice(0, atIdx);
  const domain = value.slice(atIdx);
  if (local.length === 0) return '*' + domain;
  return local[0] + '***' + domain;
}

function maskIdCard(value: string): string {
  if (value.length < 10) return value;
  return value.slice(0, 6) + '****' + value.slice(-4);
}

function maskCreditCard(value: string): string {
  const digits = value.replace(/\D/g, '');
  if (digits.length < 8) return value;
  return digits.slice(0, 4) + ' **** **** ' + digits.slice(-4);
}

function maskBankCard(value: string): string {
  const digits = value.replace(/\D/g, '');
  if (digits.length < 8) return value;
  return digits.slice(0, 4) + ' **** **** ' + digits.slice(-4);
}

function maskIpAddress(value: string): string {
  const parts = value.split('.');
  if (parts.length !== 4) return value;
  return parts[0] + '.' + parts[1] + '.*.*';
}

// ── 默认规则集 ──────────────────────────────────────────

export const DEFAULT_MASKING_RULES: MaskingRule[] = [
  {
    name: 'phone',
    fieldPatterns: [/phone/i, /mobile/i, /tel/i, /手机/i, /电话/i],
    valuePatterns: [/^1[3-9]\d{9}$/],
    mask: maskPhone,
  },
  {
    name: 'email',
    fieldPatterns: [/email/i, /mail/i, /邮箱/i],
    valuePatterns: [/^[^\s@]+@[^\s@]+\.[^\s@]+$/],
    mask: maskEmail,
  },
  {
    name: 'id_card',
    fieldPatterns: [/id_card/i, /identity/i, /身份证/i, /证件/i],
    valuePatterns: [/^\d{17}[\dXx]$/],
    mask: maskIdCard,
  },
  {
    name: 'credit_card',
    fieldPatterns: [/credit_card/i, /card_number/i, /信用卡/i, /卡号/i],
    valuePatterns: [/^\d{13,19}$/],
    mask: maskCreditCard,
  },
  {
    name: 'bank_card',
    fieldPatterns: [/bank_card/i, /account_no/i, /银行卡/i, /账号/i],
    valuePatterns: [/^\d{16,19}$/],
    mask: maskBankCard,
  },
  {
    name: 'ip_address',
    fieldPatterns: [/ip_addr/i, /ip_address/i, /ip$/i],
    valuePatterns: [/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/],
    mask: maskIpAddress,
  },
];

// ── 默认配置 ──────────────────────────────────────────

export function getDefaultMaskingConfig(): MaskingConfig {
  return {
    mode: 'off',
    enabled: false,
    rules: [...DEFAULT_MASKING_RULES],
    excludeFields: [],
    excludeConnections: [],
  };
}

// ── 从环境变量读取配置 ──────────────────────────────────────

export function parseMaskingConfigFromEnv(): MaskingConfig {
  const mode = (process.env.DB_MASKING_MODE ?? 'off') as MaskingMode;
  const enabled = mode !== 'off';
  const excludeFieldsRaw = process.env.DB_MASKING_EXCLUDE_FIELDS ?? '';
  const excludeFields = excludeFieldsRaw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const excludeConnectionsRaw = process.env.DB_MASKING_EXCLUDE_CONNECTIONS ?? '';
  const excludeConnections = excludeConnectionsRaw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  return {
    mode,
    enabled,
    rules: [...DEFAULT_MASKING_RULES],
    excludeFields,
    excludeConnections,
  };
}

// ── 脱敏核心逻辑 ──────────────────────────────────────────

function shouldMaskField(
  fieldName: string,
  excludeFields: string[],
  rules: MaskingRule[],
): MaskingRule | undefined {
  const lower = fieldName.toLowerCase();
  if (excludeFields.some((ef) => ef.toLowerCase() === lower)) {
    return undefined;
  }
  for (const rule of rules) {
    if (rule.fieldPatterns.some((p) => p.test(fieldName))) {
      return rule;
    }
  }
  return undefined;
}

function maskValue(value: unknown, rule: MaskingRule): unknown {
  if (typeof value !== 'string') return value;
  if (rule.valuePatterns.some((p) => p.test(value))) {
    return rule.mask(value);
  }
  return value;
}

function applyStrictMode(
  row: Record<string, unknown>,
  config: MaskingConfig,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    const rule = shouldMaskField(key, config.excludeFields, config.rules);
    if (rule) {
      result[key] = typeof value === 'string' ? rule.mask(value) : value;
    } else {
      result[key] = value;
    }
  }
  return result;
}

/**
 * strict-v2 模式：字段名匹配 AND 值正则匹配，双重校验
 * 比 strict 更严格：仅字段名匹配不够，值也必须符合敏感数据格式才脱敏
 */
function applyStrictV2Mode(
  row: Record<string, unknown>,
  config: MaskingConfig,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    const rule = shouldMaskField(key, config.excludeFields, config.rules);
    if (rule) {
      // 字段名匹配后，还需值正则匹配
      result[key] = maskValue(value, rule);
    } else {
      result[key] = value;
    }
  }
  return result;
}

function applyLooseMode(
  row: Record<string, unknown>,
  config: MaskingConfig,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const excludeSet = new Set(config.excludeFields.map((f) => f.toLowerCase()));
  for (const [key, value] of Object.entries(row)) {
    if (excludeSet.has(key.toLowerCase())) {
      result[key] = value;
      continue;
    }
    if (typeof value === 'string') {
      let masked = false;
      for (const rule of config.rules) {
        if (rule.valuePatterns.some((p) => p.test(value))) {
          result[key] = rule.mask(value);
          masked = true;
          break;
        }
      }
      if (!masked) result[key] = value;
    } else {
      result[key] = value;
    }
  }
  return result;
}

/**
 * 对查询结果应用数据脱敏
 * 纯函数，不修改原始数据
 */
export function applyMasking(
  rows: Record<string, unknown>[],
  config: MaskingConfig,
): Record<string, unknown>[] {
  if (!config.enabled || config.mode === 'off' || rows.length === 0) {
    return rows;
  }

  if (config.mode === 'strict') {
    return rows.map((row) => applyStrictMode(row, config));
  }

  if (config.mode === 'strict-v2') {
    return rows.map((row) => applyStrictV2Mode(row, config));
  }

  // loose mode: 只脱敏匹配值正则的字段
  return rows.map((row) => applyLooseMode(row, config));
}
