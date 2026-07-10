import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  discoverPlugins,
  loadPlugins,
  parsePluginManifest,
  safePluginDiscoverySummary,
  setRuntimePluginExtensions,
} from '../core/plugins.js';
import { setPluginToolActionsForRuntime } from '../core/tool-action-map.js';

export async function registerExternalPluginTools(server: McpServer): Promise<void> {
  const discovered = discoverPlugins();
  const toolManifests = discovered.flatMap((plugin) =>
    plugin.manifest.type.includes('tool') ? plugin.manifest.tools : [],
  );
  setPluginToolActionsForRuntime(toolManifests);
  const runtimePlugins = discovered.filter((plugin) =>
    plugin.manifest.type.some((type) => type === 'tool' || type === 'policy' || type === 'export'),
  );
  const loaded = await loadPlugins(runtimePlugins);
  setRuntimePluginExtensions(loaded);
  if (toolManifests.length === 0) return;

  for (const plugin of loaded) {
    if (!plugin.manifest.type.includes('tool')) continue;
    await plugin.module.registerTools?.(server, {
      manifest: plugin.manifest,
      pluginPath: plugin.path,
    });
  }
}

export function registerPluginTools(server: McpServer): void {
  server.registerTool(
    'plugin_list',
    {
      description: '列出通过 DB_PLUGIN_PATHS 发现并验证通过的本地插件 manifest 摘要。',
      inputSchema: {},
    },
    async () => {
      try {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(safePluginDiscoverySummary(discoverPlugins())),
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
    'plugin_validate_manifest',
    {
      description: '验证插件 manifest JSON，不加载或执行插件入口文件。',
      inputSchema: {
        manifest_json: z.string().describe('插件 plugin.json 内容'),
      },
    },
    async ({ manifest_json }) => {
      try {
        const manifest = parsePluginManifest(JSON.parse(manifest_json));
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                valid: true,
                manifest: {
                  name: manifest.name,
                  version: manifest.version,
                  polyglotPluginVersion: manifest.polyglotPluginVersion,
                  type: manifest.type,
                  permissions: manifest.permissions,
                  tools: manifest.tools,
                },
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
