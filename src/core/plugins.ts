import { existsSync, readFileSync, statSync } from 'node:fs';
import { isAbsolute, normalize, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { withErrorCode } from './error-codes.js';
import type { AuthAction } from '../auth/rbac.js';
import type { ConnectionSpec, RuntimeHandle } from './types.js';

export type PluginType = 'driver' | 'tool' | 'policy' | 'export';

export interface PluginToolManifest {
  name: string;
  action: AuthAction;
  description: string;
}

export interface PluginPermissions {
  connections: string[];
  actions: AuthAction[];
  network: boolean;
  filesystem: boolean;
}

export interface PluginManifest {
  name: string;
  version: string;
  polyglotPluginVersion: '1';
  type: PluginType[];
  main: string;
  driverEngines: string[];
  engines?: Record<string, string>;
  permissions: PluginPermissions;
  tools: PluginToolManifest[];
  configSchema?: Record<string, unknown>;
}

export interface PluginDiscoveryConfig {
  paths: string[];
}

export interface DiscoveredPlugin {
  path: string;
  manifestPath: string;
  mainPath: string;
  manifest: PluginManifest;
}

export interface PluginRuntimeContext {
  manifest: PluginManifest;
  pluginPath: string;
}

export interface PluginPolicyInput {
  subject: string;
  tenant?: string;
  action: AuthAction;
  resources: string[];
  input: Record<string, unknown>;
  transport: 'stdio' | 'http';
}

export interface PluginPolicyDecision {
  allowed: boolean;
  reason?: string;
}

export interface PluginModule {
  createDriver?: (spec: ConnectionSpec, context: PluginRuntimeContext) => Promise<RuntimeHandle>;
  registerTools?: (server: unknown, context: PluginRuntimeContext) => void | Promise<void>;
  evaluatePolicy?: (
    input: PluginPolicyInput,
    context: PluginRuntimeContext,
  ) => PluginPolicyDecision;
  exportEvent?: (
    event: Record<string, unknown>,
    context: PluginRuntimeContext,
  ) => void | Promise<void>;
}

export interface LoadedPlugin extends DiscoveredPlugin {
  module: PluginModule;
}

interface RuntimePolicyPlugin {
  plugin: LoadedPlugin;
  evaluatePolicy: NonNullable<PluginModule['evaluatePolicy']>;
}

interface RuntimeExportPlugin {
  plugin: LoadedPlugin;
  exportEvent: NonNullable<PluginModule['exportEvent']>;
}

type EnvLike = Record<string, string | undefined>;

const PLUGIN_TYPES = new Set<PluginType>(['driver', 'tool', 'policy', 'export']);
const AUTH_ACTIONS = new Set<AuthAction>([
  'read',
  'write',
  'admin',
  'diagnose',
  'export',
  'replay',
]);
const PLUGIN_NAME_REGEX = /^(@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;
const TOOL_NAME_REGEX = /^[a-z][a-z0-9_]*$/;
const DRIVER_ENGINE_REGEX = /^[a-z][a-z0-9_-]*$/;
let runtimePolicyPlugins: RuntimePolicyPlugin[] = [];
let runtimeExportPlugins: RuntimeExportPlugin[] = [];

function asObject(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(withErrorCode('CFG_005', `${label} 必须是对象`));
  }
  return value as Record<string, unknown>;
}

function asNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(withErrorCode('CFG_005', `${label} 必须是非空字符串`));
  }
  return value.trim();
}

function asStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new Error(withErrorCode('CFG_005', `${label} 必须是字符串数组`));
  }
  return (value as string[]).map((item) => item.trim()).filter(Boolean);
}

function parsePluginTypes(value: unknown): PluginType[] {
  const types = asStringArray(value, 'plugin.type');
  if (types.length === 0) {
    throw new Error(withErrorCode('CFG_005', 'plugin.type 不能为空'));
  }
  for (const type of types) {
    if (!PLUGIN_TYPES.has(type as PluginType)) {
      throw new Error(withErrorCode('CFG_005', `未知 plugin.type: ${type}`));
    }
  }
  return types as PluginType[];
}

function parseActions(value: unknown, label: string): AuthAction[] {
  const actions = asStringArray(value, label);
  for (const action of actions) {
    if (!AUTH_ACTIONS.has(action as AuthAction)) {
      throw new Error(withErrorCode('CFG_005', `未知插件 action: ${action}`));
    }
  }
  return actions as AuthAction[];
}

function parsePermissions(value: unknown): PluginPermissions {
  const raw = asObject(value, 'plugin.permissions');
  if (typeof raw.network !== 'boolean') {
    throw new Error(withErrorCode('CFG_005', 'plugin.permissions.network 必须是布尔值'));
  }
  if (typeof raw.filesystem !== 'boolean') {
    throw new Error(withErrorCode('CFG_005', 'plugin.permissions.filesystem 必须是布尔值'));
  }
  return {
    connections: asStringArray(raw.connections, 'plugin.permissions.connections'),
    actions: parseActions(raw.actions, 'plugin.permissions.actions'),
    network: raw.network,
    filesystem: raw.filesystem,
  };
}

function parseTools(value: unknown): PluginToolManifest[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    throw new Error(withErrorCode('CFG_005', 'plugin.tools 必须是数组'));
  }
  return value.map((item, index) => {
    const tool = asObject(item, `plugin.tools[${index}]`);
    const name = asNonEmptyString(tool.name, `plugin.tools[${index}].name`);
    if (!TOOL_NAME_REGEX.test(name)) {
      throw new Error(withErrorCode('CFG_005', `插件工具名无效: ${name}`));
    }
    const action = parseActions([tool.action], `plugin.tools[${index}].action`)[0]!;
    return {
      name,
      action,
      description: asNonEmptyString(tool.description, `plugin.tools[${index}].description`),
    };
  });
}

function parseDriverEngines(value: unknown, types: readonly PluginType[]): string[] {
  const engines = value === undefined ? [] : asStringArray(value, 'plugin.driverEngines');
  for (const engine of engines) {
    if (!DRIVER_ENGINE_REGEX.test(engine)) {
      throw new Error(withErrorCode('CFG_005', `插件 driver engine 无效: ${engine}`));
    }
  }
  if (types.includes('driver') && engines.length === 0) {
    throw new Error(withErrorCode('CFG_005', 'driver 插件必须声明 plugin.driverEngines'));
  }
  return engines.map((engine) => engine.toLowerCase());
}

function assertSafeMainPath(pluginRoot: string, main: string): string {
  if (isAbsolute(main) || main.includes('://')) {
    throw new Error(withErrorCode('CFG_005', 'plugin.main 必须是插件目录内的相对路径'));
  }
  const normalized = normalize(main);
  if (normalized.startsWith('..') || normalized.includes(`${sep}..${sep}`)) {
    throw new Error(withErrorCode('CFG_005', 'plugin.main 不能跳出插件目录'));
  }
  const root = resolve(pluginRoot);
  const mainPath = resolve(root, normalized);
  if (mainPath !== root && !mainPath.startsWith(`${root}${sep}`)) {
    throw new Error(withErrorCode('CFG_005', 'plugin.main 不能跳出插件目录'));
  }
  return mainPath;
}

export function parsePluginDiscoveryConfig(env: EnvLike = process.env): PluginDiscoveryConfig {
  const raw = env.DB_PLUGIN_PATHS?.trim();
  return {
    paths: raw
      ? raw
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean)
      : [],
  };
}

export function parsePluginManifest(value: unknown, pluginRoot = process.cwd()): PluginManifest {
  const raw = asObject(value, 'plugin');
  const name = asNonEmptyString(raw.name, 'plugin.name');
  if (!PLUGIN_NAME_REGEX.test(name)) {
    throw new Error(withErrorCode('CFG_005', `插件 name 无效: ${name}`));
  }
  const main = asNonEmptyString(raw.main, 'plugin.main');
  assertSafeMainPath(pluginRoot, main);

  const version = asNonEmptyString(raw.version, 'plugin.version');
  const polyglotPluginVersion = asNonEmptyString(
    raw.polyglotPluginVersion,
    'plugin.polyglotPluginVersion',
  );
  if (polyglotPluginVersion !== '1') {
    throw new Error(withErrorCode('CFG_005', 'plugin.polyglotPluginVersion 必须为 1'));
  }

  const engines =
    raw.engines === undefined
      ? undefined
      : (asObject(raw.engines, 'plugin.engines') as Record<string, string>);
  if (engines) {
    for (const [key, value] of Object.entries(engines)) {
      if (typeof value !== 'string' || value.trim() === '' || key.trim() === '') {
        throw new Error(withErrorCode('CFG_005', 'plugin.engines 必须是字符串键值对象'));
      }
    }
  }

  const configSchema =
    raw.configSchema === undefined ? undefined : asObject(raw.configSchema, 'plugin.configSchema');

  const type = parsePluginTypes(raw.type);

  return {
    name,
    version,
    polyglotPluginVersion: '1',
    type,
    main,
    driverEngines: parseDriverEngines(raw.driverEngines, type),
    engines,
    permissions: parsePermissions(raw.permissions),
    tools: parseTools(raw.tools),
    configSchema,
  };
}

export function discoverPlugins(
  config: PluginDiscoveryConfig = parsePluginDiscoveryConfig(),
): DiscoveredPlugin[] {
  const plugins: DiscoveredPlugin[] = [];
  for (const pluginPath of config.paths) {
    const root = resolve(pluginPath);
    if (!existsSync(root) || !statSync(root).isDirectory()) {
      throw new Error(withErrorCode('CFG_005', `插件目录不存在: ${pluginPath}`));
    }
    const manifestPath = resolve(root, 'plugin.json');
    if (!existsSync(manifestPath) || !statSync(manifestPath).isFile()) {
      throw new Error(withErrorCode('CFG_005', `插件目录缺少 plugin.json: ${pluginPath}`));
    }

    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(manifestPath, 'utf8')) as unknown;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(withErrorCode('CFG_005', `插件 manifest JSON 无效: ${message}`));
    }
    const manifest = parsePluginManifest(raw, root);
    const mainPath = assertSafeMainPath(root, manifest.main);
    if (!existsSync(mainPath) || !statSync(mainPath).isFile()) {
      throw new Error(withErrorCode('CFG_005', `插件 main 文件不存在: ${manifest.main}`));
    }
    plugins.push({ path: root, manifestPath, mainPath, manifest });
  }
  return plugins;
}

function asPluginModule(value: unknown, plugin: DiscoveredPlugin): PluginModule {
  const module = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  const candidate = (
    module.default && typeof module.default === 'object'
      ? { ...module, ...(module.default as Record<string, unknown>) }
      : module
  ) as Record<string, unknown>;

  const pluginModule: PluginModule = {};
  if (candidate.createDriver !== undefined) {
    if (typeof candidate.createDriver !== 'function') {
      throw new Error(withErrorCode('CFG_005', `${plugin.manifest.name} createDriver 必须是函数`));
    }
    pluginModule.createDriver = candidate.createDriver as PluginModule['createDriver'];
  }
  if (candidate.registerTools !== undefined) {
    if (typeof candidate.registerTools !== 'function') {
      throw new Error(withErrorCode('CFG_005', `${plugin.manifest.name} registerTools 必须是函数`));
    }
    pluginModule.registerTools = candidate.registerTools as PluginModule['registerTools'];
  }
  if (candidate.evaluatePolicy !== undefined) {
    if (typeof candidate.evaluatePolicy !== 'function') {
      throw new Error(
        withErrorCode('CFG_005', `${plugin.manifest.name} evaluatePolicy 必须是函数`),
      );
    }
    pluginModule.evaluatePolicy = candidate.evaluatePolicy as PluginModule['evaluatePolicy'];
  }
  if (candidate.exportEvent !== undefined) {
    if (typeof candidate.exportEvent !== 'function') {
      throw new Error(withErrorCode('CFG_005', `${plugin.manifest.name} exportEvent 必须是函数`));
    }
    pluginModule.exportEvent = candidate.exportEvent as PluginModule['exportEvent'];
  }

  if (plugin.manifest.type.includes('driver') && !pluginModule.createDriver) {
    throw new Error(withErrorCode('CFG_005', `${plugin.manifest.name} 缺少 createDriver 导出`));
  }
  if (plugin.manifest.type.includes('tool') && !pluginModule.registerTools) {
    throw new Error(withErrorCode('CFG_005', `${plugin.manifest.name} 缺少 registerTools 导出`));
  }
  if (plugin.manifest.type.includes('policy') && !pluginModule.evaluatePolicy) {
    throw new Error(withErrorCode('CFG_005', `${plugin.manifest.name} 缺少 evaluatePolicy 导出`));
  }
  if (plugin.manifest.type.includes('export') && !pluginModule.exportEvent) {
    throw new Error(withErrorCode('CFG_005', `${plugin.manifest.name} 缺少 exportEvent 导出`));
  }

  return pluginModule;
}

export async function loadPlugins(
  plugins: readonly DiscoveredPlugin[] = discoverPlugins(),
): Promise<LoadedPlugin[]> {
  const loaded: LoadedPlugin[] = [];
  for (const plugin of plugins) {
    const module = asPluginModule(await import(pathToFileURL(plugin.mainPath).href), plugin);
    loaded.push({ ...plugin, module });
  }
  return loaded;
}

export function pluginDriverEngines(plugins: readonly DiscoveredPlugin[]): string[] {
  return [
    ...new Set(
      plugins.flatMap((plugin) =>
        plugin.manifest.type.includes('driver') ? plugin.manifest.driverEngines : [],
      ),
    ),
  ].sort();
}

export function findDriverPlugin(
  plugins: readonly LoadedPlugin[],
  engine: string,
): LoadedPlugin | undefined {
  return plugins.find(
    (plugin) =>
      plugin.manifest.type.includes('driver') &&
      plugin.manifest.driverEngines.includes(engine.toLowerCase()),
  );
}

export function setRuntimePluginExtensions(plugins: readonly LoadedPlugin[]): void {
  runtimePolicyPlugins = plugins
    .filter((plugin) => plugin.manifest.type.includes('policy') && plugin.module.evaluatePolicy)
    .map((plugin) => ({
      plugin,
      evaluatePolicy: plugin.module.evaluatePolicy!,
    }));
  runtimeExportPlugins = plugins
    .filter((plugin) => plugin.manifest.type.includes('export') && plugin.module.exportEvent)
    .map((plugin) => ({
      plugin,
      exportEvent: plugin.module.exportEvent!,
    }));
}

export function evaluateRuntimePolicyPlugins(input: PluginPolicyInput): PluginPolicyDecision {
  for (const runtimePlugin of runtimePolicyPlugins) {
    const decision = runtimePlugin.evaluatePolicy(input, {
      manifest: runtimePlugin.plugin.manifest,
      pluginPath: runtimePlugin.plugin.path,
    });
    if (decision.allowed === false) {
      return {
        allowed: false,
        reason: decision.reason ?? `${runtimePlugin.plugin.manifest.name} denied by policy plugin`,
      };
    }
  }
  return { allowed: true };
}

export function dispatchRuntimeExportEvent(event: Record<string, unknown>): void {
  for (const runtimePlugin of runtimeExportPlugins) {
    void Promise.resolve(
      runtimePlugin.exportEvent(
        { ...event },
        {
          manifest: runtimePlugin.plugin.manifest,
          pluginPath: runtimePlugin.plugin.path,
        },
      ),
    ).catch(() => {
      // Export plugin failures must not block tool execution or audit writes.
    });
  }
}

export function safePluginDiscoverySummary(
  plugins: readonly DiscoveredPlugin[],
): Record<string, unknown> {
  return {
    enabled: plugins.length > 0,
    count: plugins.length,
    plugins: plugins.map((plugin) => ({
      name: plugin.manifest.name,
      version: plugin.manifest.version,
      type: plugin.manifest.type,
      driver_engines: plugin.manifest.driverEngines,
      permissions: {
        actions: plugin.manifest.permissions.actions,
        network: plugin.manifest.permissions.network,
        filesystem: plugin.manifest.permissions.filesystem,
      },
      tools: plugin.manifest.tools.map((tool) => ({
        name: tool.name,
        action: tool.action,
      })),
    })),
  };
}
