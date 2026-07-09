import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  type MaskingConfig,
  type MaskingRule,
  parseMaskingConfigFromEnv,
  DEFAULT_MASKING_RULES,
} from '../core/data-masking.js';

// 模块级单例配置
let maskingConfig: MaskingConfig = parseMaskingConfigFromEnv();

export function getMaskingConfig(): MaskingConfig {
  return maskingConfig;
}

export function setMaskingConfig(config: Partial<MaskingConfig>): void {
  maskingConfig = {
    ...maskingConfig,
    ...config,
    enabled: (config.mode ?? maskingConfig.mode) !== 'off',
  };
}

export function resetMaskingConfig(): void {
  maskingConfig = parseMaskingConfigFromEnv();
}

// ── 自定义规则管理 ──────────────────────────────────────────

function isCustomRule(rule: MaskingRule): boolean {
  return !DEFAULT_MASKING_RULES.some((r) => r.name === rule.name);
}

export function addCustomMaskingRule(rule: {
  name: string;
  fieldPattern: string;
  valuePattern: string;
  replacement: string;
}): void {
  // 检查名称冲突
  const existing = maskingConfig.rules.find((r) => r.name === rule.name);
  if (existing) {
    throw new Error(`规则 "${rule.name}" 已存在，请先移除或使用不同名称`);
  }

  const newRule: MaskingRule = {
    name: rule.name,
    fieldPatterns: [new RegExp(rule.fieldPattern, 'i')],
    valuePatterns: [new RegExp(rule.valuePattern)],
    mask: (value: string) => {
      // 替换匹配值正则的部分
      return value.replace(new RegExp(rule.valuePattern), rule.replacement);
    },
  };
  maskingConfig.rules.push(newRule);
}

export function removeCustomMaskingRule(name: string): boolean {
  const idx = maskingConfig.rules.findIndex((r) => r.name === name && isCustomRule(r));
  if (idx < 0) return false;
  maskingConfig.rules.splice(idx, 1);
  return true;
}

export function listMaskingRules(): Array<{
  name: string;
  fieldPatterns: string[];
  valuePatterns: string[];
  isCustom: boolean;
}> {
  return maskingConfig.rules.map((r) => ({
    name: r.name,
    fieldPatterns: r.fieldPatterns.map((p) => p.source),
    valuePatterns: r.valuePatterns.map((p) => p.source),
    isCustom: isCustomRule(r),
  }));
}

export function registerMaskingTools(server: McpServer): void {
  server.registerTool(
    'set_masking_mode',
    {
      description: '设置数据脱敏模式。off=关闭，loose=仅脱敏匹配值模式的字段，strict=脱敏所有匹配字段名的字段，strict-v2=字段名+值双重匹配才脱敏。',
      inputSchema: {
        mode: z.enum(['off', 'loose', 'strict', 'strict-v2']).describe('脱敏模式：off=关闭，loose=值匹配脱敏，strict=字段名匹配脱敏，strict-v2=字段名+值双重匹配脱敏'),
        enabled: z.boolean().optional().describe('是否启用脱敏（默认根据 mode 自动判断）'),
        excludeFields: z.array(z.string()).optional().describe('白名单字段列表，这些字段不参与脱敏'),
        excludeConnections: z.array(z.string()).optional().describe('排除的连接 ID 列表'),
      },
    },
    async ({ mode, enabled, excludeFields, excludeConnections }) => {
      try {
        const newConfig: Partial<MaskingConfig> = { mode };
        if (enabled !== undefined) newConfig.enabled = enabled;
        if (excludeFields !== undefined) newConfig.excludeFields = excludeFields;
        if (excludeConnections !== undefined) newConfig.excludeConnections = excludeConnections;
        setMaskingConfig(newConfig);
        const cfg = getMaskingConfig();
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                mode: cfg.mode,
                enabled: cfg.enabled,
                rulesCount: cfg.rules.length,
                excludeFields: cfg.excludeFields,
                excludeConnections: cfg.excludeConnections,
              }),
            },
          ],
        };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return { content: [{ type: 'text', text: msg }], isError: true };
      }
    }
  );

  server.registerTool(
    'get_masking_config',
    {
      description: '获取当前数据脱敏配置，包括模式、规则列表和白名单字段。',
      inputSchema: {},
    },
    async () => {
      try {
        const cfg = getMaskingConfig();
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                mode: cfg.mode,
                enabled: cfg.enabled,
                rules: cfg.rules.map((r) => ({
                  name: r.name,
                  fieldPatterns: r.fieldPatterns.map((p) => p.source),
                  valuePatterns: r.valuePatterns.map((p) => p.source),
                })),
                excludeFields: cfg.excludeFields,
                excludeConnections: cfg.excludeConnections,
              }),
            },
          ],
        };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return { content: [{ type: 'text', text: msg }], isError: true };
      }
    }
  );

  server.registerTool(
    'manage_masking_rules',
    {
      description: '管理自定义脱敏规则。支持 add（添加）、remove（移除）、list（列出所有规则）操作。',
      inputSchema: {
        action: z.enum(['add', 'remove', 'list']).describe('操作类型'),
        name: z.string().optional().describe('规则名称（add/remove 时必填）'),
        fieldPattern: z.string().optional().describe('字段名正则表达式（add 时必填）'),
        valuePattern: z.string().optional().describe('值正则表达式（add 时必填）'),
        replacement: z.string().optional().describe('替换字符串（add 时必填，如 "***"）'),
      },
    },
    async ({ action, name, fieldPattern, valuePattern, replacement }) => {
      try {
        if (action === 'list') {
          const rules = listMaskingRules();
          return {
            content: [{ type: 'text', text: JSON.stringify({ rules, count: rules.length }) }],
          };
        }

        if (action === 'add') {
          if (!name || !fieldPattern || !valuePattern || !replacement) {
            return {
              content: [{ type: 'text', text: 'add 操作需要 name、fieldPattern、valuePattern、replacement 四个参数' }],
              isError: true,
            };
          }
          // 验证正则合法性
          try {
            new RegExp(fieldPattern);
          } catch {
            return {
              content: [{ type: 'text', text: `fieldPattern 正则无效: ${fieldPattern}` }],
              isError: true,
            };
          }
          try {
            new RegExp(valuePattern);
          } catch {
            return {
              content: [{ type: 'text', text: `valuePattern 正则无效: ${valuePattern}` }],
              isError: true,
            };
          }
          addCustomMaskingRule({ name, fieldPattern, valuePattern, replacement });
          return {
            content: [{ type: 'text', text: JSON.stringify({ success: true, message: `规则 "${name}" 已添加`, totalRules: listMaskingRules().length }) }],
          };
        }

        if (action === 'remove') {
          if (!name) {
            return {
              content: [{ type: 'text', text: 'remove 操作需要 name 参数' }],
              isError: true,
            };
          }
          const removed = removeCustomMaskingRule(name);
          if (!removed) {
            return {
              content: [{ type: 'text', text: `未找到自定义规则 "${name}"（内置规则不可移除）` }],
              isError: true,
            };
          }
          return {
            content: [{ type: 'text', text: JSON.stringify({ success: true, message: `规则 "${name}" 已移除`, totalRules: listMaskingRules().length }) }],
          };
        }

        return {
          content: [{ type: 'text', text: `未知操作: ${action}` }],
          isError: true,
        };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return { content: [{ type: 'text', text: msg }], isError: true };
      }
    }
  );
}
