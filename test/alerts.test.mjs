import assert from 'node:assert/strict';
import { beforeEach, describe, test } from 'node:test';

const enabledEnv = {
  DB_ALERT_ENABLED: 'true',
  DB_ALERT_WEBHOOK_URL: 'https://alerts.example.test/hook',
  DB_ALERT_WEBHOOK_SECRET: 'secret-value',
  DB_ALERT_COOLDOWN_MS: '0',
};

describe('alert webhook config', () => {
  let alerts;
  let calls;

  beforeEach(async () => {
    alerts = await import('../dist/core/alerts.js');
    alerts.resetAlertsForTests();
    calls = [];
    alerts.setAlertDispatchForTests(async (request) => {
      calls.push(request);
      return { ok: true, status: 202, statusText: 'Accepted' };
    });
  });

  test('defaults to disabled and validates explicit webhook settings', () => {
    assert.equal(alerts.parseAlertConfig({}).enabled, false);
    assert.equal(
      alerts.parseAlertConfig({
        DB_ALERT_ENABLED: 'false',
        DB_ALERT_WEBHOOK_URL: 'ftp://alerts.example.test/hook',
        DB_ALERT_TIMEOUT_MS: 'not-a-number',
      }).enabled,
      false,
    );
    assert.throws(() => alerts.parseAlertConfig({ DB_ALERT_ENABLED: 'true' }), /CFG_005/);
    assert.throws(
      () =>
        alerts.parseAlertConfig({
          DB_ALERT_ENABLED: 'true',
          DB_ALERT_WEBHOOK_URL: 'ftp://alerts.example.test/hook',
        }),
      /CFG_005/,
    );

    const config = alerts.parseAlertConfig(enabledEnv);
    assert.equal(config.enabled, true);
    assert.equal(config.webhookUrl, 'https://alerts.example.test/hook');

    const safe = alerts.safeAlertConfig(config);
    assert.equal(safe.webhook, 'configured');
    assert.equal(JSON.stringify(safe).includes('secret-value'), false);
  });

  test('dispatches alert payload with secret header only', async () => {
    const delivered = await alerts.publishAlert(
      {
        kind: 'test',
        severity: 'warning',
        title: 'Probe',
        message: 'hello',
        labels: { probe: 'yes' },
        details: { count: 1 },
      },
      enabledEnv,
    );

    assert.equal(delivered, true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://alerts.example.test/hook');
    assert.equal(calls[0].headers['x-db-mcp-alert-secret'], 'secret-value');
    assert.equal(calls[0].event.kind, 'test');
    assert.equal(calls[0].event.labels.probe, 'yes');
    assert.equal(calls[0].event.details.count, 1);
    assert.ok(calls[0].event.timestamp);
  });

  test('respects minimum severity', async () => {
    const delivered = await alerts.publishAlert(
      {
        kind: 'test',
        severity: 'warning',
        title: 'Skip',
        message: 'below minimum',
      },
      { ...enabledEnv, DB_ALERT_MIN_SEVERITY: 'critical' },
    );

    assert.equal(delivered, false);
    assert.equal(calls.length, 0);
  });

  test('publishes connection failure alerts with default connection severity', async () => {
    const delivered = await alerts.publishConnectionPingAlerts(
      [
        { id: 'pg', ok: false, latencyMs: 12, error: 'password=secret connection refused' },
        { id: 'redis', ok: false, latencyMs: 3, error: 'timeout' },
        { id: 'sqlite', ok: true, latencyMs: 1 },
      ],
      'pg',
      enabledEnv,
    );

    assert.equal(delivered, 2);
    assert.deepEqual(
      calls.map((call) => [call.event.kind, call.event.labels.connection_id, call.event.severity]),
      [
        ['connection_failure', 'pg', 'critical'],
        ['connection_failure', 'redis', 'warning'],
      ],
    );
    assert.equal(JSON.stringify(calls[0].event).includes('secret'), false);
  });

  test('publishes slow tool and error-rate alerts from observations', async () => {
    const delivered = await alerts.publishToolObservationAlerts(
      {
        tool: 'sql_query',
        action: 'read',
        transport: 'http',
        connectionId: 'pg',
        success: false,
        durationMs: 250,
        errorCode: 'SQL_002',
      },
      {
        tool: 'sql_query',
        action: 'read',
        transport: 'http',
        connectionId: 'pg',
        totalCalls: 5,
        failedCalls: 3,
        totalDurationMs: 500,
        maxDurationMs: 250,
        lastCalledAt: 0,
        byErrorCode: { SQL_002: 3 },
      },
      {
        ...enabledEnv,
        DB_ALERT_SLOW_TOOL_MS: '100',
        DB_ALERT_TOOL_ERROR_RATE_MIN_CALLS: '5',
        DB_ALERT_TOOL_ERROR_RATE_THRESHOLD: '50',
      },
    );

    assert.equal(delivered, 2);
    assert.deepEqual(
      calls.map((call) => call.event.kind),
      ['slow_tool_call', 'tool_error_rate'],
    );
    assert.equal(calls[1].event.details.failure_rate, 60);
    assert.equal(calls[1].event.labels.error_code, 'SQL_002');
  });
});
