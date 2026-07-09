import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { authContextFromInfo } from '../auth/auth-context.js';
import {
  listRbacPolicyTemplates,
  loadRbacPolicyTemplate,
  parseRbacPolicy,
  RBAC_POLICY_TEMPLATE_NAMES,
} from '../auth/rbac.js';

const templateNameSchema = z.enum(RBAC_POLICY_TEMPLATE_NAMES);

export function registerAuthTools(server: McpServer): void {
  server.registerTool(
    'auth_whoami',
    {
      description: '返回当前认证主体、tenant、scope 和 token roles。不会返回 token 原文。',
      inputSchema: {},
    },
    async (_args, extra) => {
      const context = authContextFromInfo(extra.authInfo);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              subject: context.subject,
              tenant: context.tenant,
              scopes: context.scopes,
              token_roles: context.tokenRoles,
              transport: context.transport,
              auth_mode: context.authMode,
            }),
          },
        ],
      };
    },
  );

  server.registerTool(
    'auth_policy_validate',
    {
      description: '验证 RBAC policy JSON，返回版本、角色和绑定数量。',
      inputSchema: {
        policy_json: z.string().describe('RBAC policy JSON 字符串'),
      },
    },
    async ({ policy_json }) => {
      try {
        const policy = parseRbacPolicy(JSON.parse(policy_json));
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                valid: true,
                version: policy.version,
                roles: Object.keys(policy.roles),
                binding_count: policy.bindings.length,
              }),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                valid: false,
                error: error instanceof Error ? error.message : String(error),
              }),
            },
          ],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    'auth_policy_template',
    {
      description: '返回内置 RBAC policy 模板 JSON，可作为生产 policy 文件的起点。',
      inputSchema: {
        name: templateNameSchema.describe(`模板名称：${RBAC_POLICY_TEMPLATE_NAMES.join(' / ')}`),
      },
    },
    async ({ name }) => {
      try {
        const policy = loadRbacPolicyTemplate(name);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                name,
                available_templates: listRbacPolicyTemplates(),
                policy,
              }),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                valid: false,
                error: error instanceof Error ? error.message : String(error),
              }),
            },
          ],
          isError: true,
        };
      }
    },
  );
}
