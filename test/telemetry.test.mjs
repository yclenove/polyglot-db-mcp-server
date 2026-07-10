import assert from 'node:assert/strict';
import { beforeEach, describe, test } from 'node:test';

describe('OpenTelemetry exporter config', () => {
  let telemetry;

  beforeEach(async () => {
    telemetry = await import('../dist/core/telemetry.js');
    telemetry.resetTelemetryForTests();
  });

  test('defaults to disabled and ignores stale exporter values', () => {
    const config = telemetry.parseTelemetryConfig({
      DB_OTEL_EXPORTER: 'not-real',
      DB_OTEL_OTLP_ENDPOINT: 'ftp://collector.example.test/v1/traces',
      DB_OTEL_OTLP_HEADERS: 'broken-header',
    });

    assert.equal(config.enabled, false);
    assert.equal(config.exporter, 'none');
    assert.equal(config.serviceName, 'polyglot-db-mcp-server');

    const runtime = telemetry.initializeTelemetry({});
    assert.equal(runtime.enabled, false);
    assert.equal(runtime.config.exporter, 'none');
  });

  test('parses explicit OTLP HTTP exporter configuration without leaking headers', () => {
    const config = telemetry.parseTelemetryConfig({
      DB_OTEL_ENABLED: 'true',
      DB_OTEL_EXPORTER: 'otlp_http',
      DB_OTEL_SERVICE_NAME: 'db-mcp-prod',
      DB_OTEL_OTLP_ENDPOINT: 'https://collector.example.test/v1/traces',
      DB_OTEL_OTLP_HEADERS: 'authorization=Bearer secret-value,x-tenant=prod',
      DB_OTEL_SAMPLING_RATIO: '0.25',
      DB_OTEL_BATCH: 'true',
      DB_OTEL_EXPORT_INTERVAL_MS: '1000',
      DB_OTEL_EXPORT_TIMEOUT_MS: '2000',
      DB_OTEL_MAX_QUEUE_SIZE: '64',
      DB_OTEL_MAX_EXPORT_BATCH_SIZE: '16',
      DB_OTEL_RESOURCE_ATTRIBUTES: 'deployment.environment=prod',
    });

    assert.equal(config.enabled, true);
    assert.equal(config.exporter, 'otlp_http');
    assert.equal(config.otlpEndpoint, 'https://collector.example.test/v1/traces');
    assert.equal(config.headers.authorization, 'Bearer secret-value');
    assert.equal(config.headers['x-tenant'], 'prod');
    assert.equal(config.samplingRatio, 0.25);
    assert.equal(config.maxExportBatchSize, 16);
    assert.equal(config.resourceAttributes['service.name'], 'db-mcp-prod');
    assert.equal(config.resourceAttributes['deployment.environment'], 'prod');

    const safe = telemetry.safeTelemetryConfig(config);
    assert.equal(safe.otlp_endpoint, 'configured');
    assert.equal(safe.headers, 'configured');
    assert.equal(JSON.stringify(safe).includes('secret-value'), false);
    assert.equal(JSON.stringify(safe).includes('collector.example.test'), false);
  });

  test('supports standard OTEL base endpoint and console exporter', () => {
    const otlp = telemetry.parseTelemetryConfig({
      DB_OTEL_ENABLED: 'true',
      OTEL_EXPORTER_OTLP_ENDPOINT: 'https://collector.example.test',
    });
    assert.equal(otlp.otlpEndpoint, 'https://collector.example.test/v1/traces');

    const consoleConfig = telemetry.parseTelemetryConfig({
      DB_OTEL_ENABLED: 'true',
      DB_OTEL_EXPORTER: 'console',
      OTEL_SERVICE_NAME: 'db-mcp-console',
    });
    assert.equal(consoleConfig.exporter, 'console');
    assert.equal(consoleConfig.otlpEndpoint, undefined);
    assert.equal(consoleConfig.serviceName, 'db-mcp-console');
  });

  test('rejects invalid enabled configuration', () => {
    assert.throws(
      () =>
        telemetry.parseTelemetryConfig({
          DB_OTEL_ENABLED: 'true',
          DB_OTEL_EXPORTER: 'ftp',
        }),
      /CFG_005/,
    );
    assert.throws(
      () =>
        telemetry.parseTelemetryConfig({
          DB_OTEL_ENABLED: 'true',
          DB_OTEL_OTLP_ENDPOINT: 'ftp://collector.example.test',
        }),
      /CFG_005/,
    );
    assert.throws(
      () =>
        telemetry.parseTelemetryConfig({
          DB_OTEL_ENABLED: 'true',
          DB_OTEL_SAMPLING_RATIO: '2',
        }),
      /CFG_005/,
    );
    assert.throws(
      () =>
        telemetry.parseTelemetryConfig({
          DB_OTEL_ENABLED: 'true',
          DB_OTEL_MAX_QUEUE_SIZE: '8',
          DB_OTEL_MAX_EXPORT_BATCH_SIZE: '16',
        }),
      /CFG_005/,
    );
  });
});
