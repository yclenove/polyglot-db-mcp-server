import { URL } from 'node:url';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import {
  BatchSpanProcessor,
  ConsoleSpanExporter,
  SimpleSpanProcessor,
  TraceIdRatioBasedSampler,
} from '@opentelemetry/sdk-trace-base';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';
import type { SpanProcessor } from '@opentelemetry/sdk-trace-base';
import { withErrorCode } from './error-codes.js';
import { getVersion } from './version.js';
import { logger } from './logger.js';

export const TELEMETRY_EXPORTERS = ['none', 'console', 'otlp_http'] as const;
export type TelemetryExporter = (typeof TELEMETRY_EXPORTERS)[number];

export interface TelemetryConfig {
  enabled: boolean;
  exporter: TelemetryExporter;
  serviceName: string;
  otlpEndpoint?: string;
  headers: Record<string, string>;
  samplingRatio: number;
  batch: boolean;
  exportIntervalMs: number;
  exportTimeoutMs: number;
  maxQueueSize: number;
  maxExportBatchSize: number;
  resourceAttributes: Record<string, string>;
}

export interface TelemetryRuntime {
  enabled: boolean;
  config: TelemetryConfig;
  shutdown(): Promise<void>;
}

type EnvLike = Record<string, string | undefined>;

const DEFAULT_SERVICE_NAME = 'polyglot-db-mcp-server';
const DEFAULT_OTLP_TRACES_ENDPOINT = 'http://localhost:4318/v1/traces';
const DEFAULT_EXPORT_INTERVAL_MS = 5000;
const DEFAULT_EXPORT_TIMEOUT_MS = 30000;
const DEFAULT_MAX_QUEUE_SIZE = 2048;
const DEFAULT_MAX_EXPORT_BATCH_SIZE = 512;

let activeRuntime: TelemetryRuntime | undefined;

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function parseBoolean(name: string, value: string | undefined, defaultValue: boolean): boolean {
  const raw = nonEmpty(value);
  if (!raw) return defaultValue;
  const normalized = raw.toLowerCase();
  if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) return false;
  throw new Error(withErrorCode('CFG_005', `${name} 必须是布尔值`));
}

function parsePositiveInt(name: string, value: string | undefined, defaultValue: number): number {
  const raw = nonEmpty(value);
  if (!raw) return defaultValue;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(withErrorCode('CFG_005', `${name} 必须是正整数`));
  }
  return parsed;
}

function parseRatio(name: string, value: string | undefined, defaultValue: number): number {
  const raw = nonEmpty(value);
  if (!raw) return defaultValue;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    throw new Error(withErrorCode('CFG_005', `${name} 必须是 0 到 1 之间的数字`));
  }
  return parsed;
}

function parseExporter(value: string | undefined): TelemetryExporter {
  const normalized = (nonEmpty(value) ?? 'otlp_http').toLowerCase();
  if (TELEMETRY_EXPORTERS.includes(normalized as TelemetryExporter)) {
    return normalized as TelemetryExporter;
  }
  throw new Error(
    withErrorCode('CFG_005', `DB_OTEL_EXPORTER 必须是 ${TELEMETRY_EXPORTERS.join(', ')}`),
  );
}

function parseHttpUrl(name: string, value: string): string {
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new Error('unsupported protocol');
    }
    return url.toString();
  } catch {
    throw new Error(withErrorCode('CFG_005', `${name} 必须是 http(s) URL`));
  }
}

function appendTracesPath(baseEndpoint: string): string {
  const url = new URL(baseEndpoint);
  const path = url.pathname.endsWith('/')
    ? `${url.pathname}v1/traces`
    : `${url.pathname}/v1/traces`;
  url.pathname = path.replace(/\/+/g, '/');
  return url.toString();
}

function resolveOtlpEndpoint(env: EnvLike): string {
  const dbEndpoint = nonEmpty(env.DB_OTEL_OTLP_ENDPOINT);
  if (dbEndpoint) return parseHttpUrl('DB_OTEL_OTLP_ENDPOINT', dbEndpoint);

  const tracesEndpoint = nonEmpty(env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT);
  if (tracesEndpoint) {
    return parseHttpUrl('OTEL_EXPORTER_OTLP_TRACES_ENDPOINT', tracesEndpoint);
  }

  const baseEndpoint = nonEmpty(env.OTEL_EXPORTER_OTLP_ENDPOINT);
  if (baseEndpoint) {
    return parseHttpUrl('OTEL_EXPORTER_OTLP_ENDPOINT', appendTracesPath(baseEndpoint));
  }

  return DEFAULT_OTLP_TRACES_ENDPOINT;
}

function parseKeyValueList(name: string, value: string | undefined): Record<string, string> {
  const raw = nonEmpty(value);
  if (!raw) return {};
  const result: Record<string, string> = {};
  const parts = raw
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);

  for (const [index, part] of parts.entries()) {
    const separator = part.indexOf('=');
    if (separator <= 0) {
      throw new Error(withErrorCode('CFG_005', `${name} 第 ${index + 1} 项必须是 key=value`));
    }
    const key = part.slice(0, separator).trim();
    const rawValue = part.slice(separator + 1).trim();
    if (!key) {
      throw new Error(withErrorCode('CFG_005', `${name} 第 ${index + 1} 项 key 不能为空`));
    }
    result[key] = rawValue;
  }

  return result;
}

function mergeHeaders(env: EnvLike): Record<string, string> {
  return {
    ...parseKeyValueList('OTEL_EXPORTER_OTLP_HEADERS', env.OTEL_EXPORTER_OTLP_HEADERS),
    ...parseKeyValueList(
      'OTEL_EXPORTER_OTLP_TRACES_HEADERS',
      env.OTEL_EXPORTER_OTLP_TRACES_HEADERS,
    ),
    ...parseKeyValueList('DB_OTEL_OTLP_HEADERS', env.DB_OTEL_OTLP_HEADERS),
  };
}

function serviceNameFromAttributes(attributes: Record<string, string>): string | undefined {
  return nonEmpty(attributes[ATTR_SERVICE_NAME]);
}

export function parseTelemetryConfig(env: EnvLike = process.env): TelemetryConfig {
  const enabled = parseBoolean('DB_OTEL_ENABLED', env.DB_OTEL_ENABLED, false);
  if (!enabled) {
    return {
      enabled: false,
      exporter: 'none',
      serviceName: DEFAULT_SERVICE_NAME,
      headers: {},
      samplingRatio: 1,
      batch: true,
      exportIntervalMs: DEFAULT_EXPORT_INTERVAL_MS,
      exportTimeoutMs: DEFAULT_EXPORT_TIMEOUT_MS,
      maxQueueSize: DEFAULT_MAX_QUEUE_SIZE,
      maxExportBatchSize: DEFAULT_MAX_EXPORT_BATCH_SIZE,
      resourceAttributes: {
        [ATTR_SERVICE_NAME]: DEFAULT_SERVICE_NAME,
        [ATTR_SERVICE_VERSION]: getVersion(),
      },
    };
  }

  const resourceAttributes = parseKeyValueList(
    'OTEL_RESOURCE_ATTRIBUTES',
    env.DB_OTEL_RESOURCE_ATTRIBUTES ?? env.OTEL_RESOURCE_ATTRIBUTES,
  );
  const exporter = parseExporter(env.DB_OTEL_EXPORTER);
  const serviceName =
    nonEmpty(env.DB_OTEL_SERVICE_NAME) ??
    nonEmpty(env.OTEL_SERVICE_NAME) ??
    serviceNameFromAttributes(resourceAttributes) ??
    DEFAULT_SERVICE_NAME;

  resourceAttributes[ATTR_SERVICE_NAME] = serviceName;
  resourceAttributes[ATTR_SERVICE_VERSION] = getVersion();

  const maxQueueSize = parsePositiveInt(
    'DB_OTEL_MAX_QUEUE_SIZE',
    env.DB_OTEL_MAX_QUEUE_SIZE,
    DEFAULT_MAX_QUEUE_SIZE,
  );
  const maxExportBatchSize = parsePositiveInt(
    'DB_OTEL_MAX_EXPORT_BATCH_SIZE',
    env.DB_OTEL_MAX_EXPORT_BATCH_SIZE,
    DEFAULT_MAX_EXPORT_BATCH_SIZE,
  );
  if (maxExportBatchSize > maxQueueSize) {
    throw new Error(
      withErrorCode(
        'CFG_005',
        'DB_OTEL_MAX_EXPORT_BATCH_SIZE 必须小于或等于 DB_OTEL_MAX_QUEUE_SIZE',
      ),
    );
  }

  return {
    enabled,
    exporter,
    serviceName,
    otlpEndpoint: exporter === 'otlp_http' ? resolveOtlpEndpoint(env) : undefined,
    headers: mergeHeaders(env),
    samplingRatio: parseRatio('DB_OTEL_SAMPLING_RATIO', env.DB_OTEL_SAMPLING_RATIO, 1),
    batch: parseBoolean('DB_OTEL_BATCH', env.DB_OTEL_BATCH, true),
    exportIntervalMs: parsePositiveInt(
      'DB_OTEL_EXPORT_INTERVAL_MS',
      env.DB_OTEL_EXPORT_INTERVAL_MS,
      DEFAULT_EXPORT_INTERVAL_MS,
    ),
    exportTimeoutMs: parsePositiveInt(
      'DB_OTEL_EXPORT_TIMEOUT_MS',
      env.DB_OTEL_EXPORT_TIMEOUT_MS,
      DEFAULT_EXPORT_TIMEOUT_MS,
    ),
    maxQueueSize,
    maxExportBatchSize,
    resourceAttributes,
  };
}

export function safeTelemetryConfig(config: TelemetryConfig): Record<string, unknown> {
  return {
    enabled: config.enabled,
    exporter: config.exporter,
    service_name: config.serviceName,
    otlp_endpoint: config.otlpEndpoint ? 'configured' : 'none',
    headers: Object.keys(config.headers).length > 0 ? 'configured' : 'none',
    sampling_ratio: config.samplingRatio,
    batch: config.batch,
    export_interval_ms: config.exportIntervalMs,
    export_timeout_ms: config.exportTimeoutMs,
    max_queue_size: config.maxQueueSize,
    max_export_batch_size: config.maxExportBatchSize,
  };
}

function buildSpanProcessor(config: TelemetryConfig): SpanProcessor {
  const exporter =
    config.exporter === 'console'
      ? new ConsoleSpanExporter()
      : new OTLPTraceExporter({
          url: config.otlpEndpoint,
          headers: config.headers,
          timeoutMillis: config.exportTimeoutMs,
          userAgent: 'polyglot-db-mcp-server',
        });

  if (!config.batch || config.exporter === 'console') {
    return new SimpleSpanProcessor(exporter);
  }

  return new BatchSpanProcessor(exporter, {
    scheduledDelayMillis: config.exportIntervalMs,
    exportTimeoutMillis: config.exportTimeoutMs,
    maxQueueSize: config.maxQueueSize,
    maxExportBatchSize: config.maxExportBatchSize,
  });
}

export function initializeTelemetry(env: EnvLike = process.env): TelemetryRuntime {
  if (activeRuntime) return activeRuntime;

  const config = parseTelemetryConfig(env);
  if (!config.enabled || config.exporter === 'none') {
    activeRuntime = {
      enabled: false,
      config,
      async shutdown() {
        // no-op
      },
    };
    return activeRuntime;
  }

  const spanProcessor = buildSpanProcessor(config);
  const provider = new NodeTracerProvider({
    resource: resourceFromAttributes(config.resourceAttributes),
    sampler: new TraceIdRatioBasedSampler(config.samplingRatio),
    spanProcessors: [spanProcessor],
    forceFlushTimeoutMillis: config.exportTimeoutMs,
  });
  provider.register();

  activeRuntime = {
    enabled: true,
    config,
    async shutdown() {
      await provider.shutdown();
    },
  };

  logger.info('opentelemetry initialized', safeTelemetryConfig(config));
  return activeRuntime;
}

export async function shutdownTelemetry(): Promise<void> {
  if (!activeRuntime) return;
  const runtime = activeRuntime;
  activeRuntime = undefined;
  if (!runtime.enabled) return;
  await runtime.shutdown();
}

export function resetTelemetryForTests(): void {
  activeRuntime = undefined;
}
