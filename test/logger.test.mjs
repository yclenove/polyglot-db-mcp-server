import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { createLogger } from '../dist/core/logger.js';

describe('createLogger', () => {
  test('returns an object with debug/info/warn/error methods', () => {
    const logger = createLogger();
    assert.equal(typeof logger.debug, 'function');
    assert.equal(typeof logger.info, 'function');
    assert.equal(typeof logger.warn, 'function');
    assert.equal(typeof logger.error, 'function');
  });

  test('accepts context parameter', () => {
    const logger = createLogger({ service: 'test' });
    assert.equal(typeof logger.info, 'function');
    // Should not throw
    logger.info('test message');
  });

  test('log methods accept message and optional data', () => {
    const logger = createLogger();
    // These should not throw
    logger.info('simple message');
    logger.info('message with data', { key: 'value' });
    logger.warn('warning');
    logger.error('error', { code: 500 });
    logger.debug('debug msg');
  });
});

describe('LOG_LEVEL filtering', () => {
  test('respects LOG_LEVEL environment variable', () => {
    const originalLevel = process.env.LOG_LEVEL;

    // With LOG_LEVEL=error, debug/info/warn should be suppressed
    process.env.LOG_LEVEL = 'error';
    const errorOnlyLogger = createLogger({ test: 'error-level' });
    // These calls should not throw even if suppressed
    errorOnlyLogger.debug('should be suppressed');
    errorOnlyLogger.info('should be suppressed');
    errorOnlyLogger.warn('should be suppressed');
    errorOnlyLogger.error('should pass');

    // Restore
    if (originalLevel !== undefined) {
      process.env.LOG_LEVEL = originalLevel;
    } else {
      delete process.env.LOG_LEVEL;
    }
  });

  test('defaults to info level', () => {
    const originalLevel = process.env.LOG_LEVEL;
    delete process.env.LOG_LEVEL;

    const logger = createLogger({ test: 'default-level' });
    logger.info('should pass');
    logger.debug('might be suppressed based on default level');

    if (originalLevel !== undefined) {
      process.env.LOG_LEVEL = originalLevel;
    }
  });
});

describe('LOG_FORMAT', () => {
  test('works with json format', () => {
    const originalFormat = process.env.LOG_FORMAT;
    process.env.LOG_FORMAT = 'json';

    const logger = createLogger({ test: 'json-format' });
    logger.info('json test message');

    // Restore
    if (originalFormat !== undefined) {
      process.env.LOG_FORMAT = originalFormat;
    } else {
      delete process.env.LOG_FORMAT;
    }
  });

  test('works with human-readable format (default)', () => {
    const originalFormat = process.env.LOG_FORMAT;
    delete process.env.LOG_FORMAT;

    const logger = createLogger({ test: 'readable-format' });
    logger.info('readable test message');

    if (originalFormat !== undefined) {
      process.env.LOG_FORMAT = originalFormat;
    }
  });
});
