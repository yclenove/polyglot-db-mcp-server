import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  applyMasking,
  getDefaultMaskingConfig,
  DEFAULT_MASKING_RULES,
} from '../dist/core/data-masking.js';

// ── strict-v2 模式 ──────────────────────────────────────────

describe('strict-v2 mode', () => {
  test('masks when field name AND value pattern both match', () => {
    const config = makeConfig({ mode: 'strict-v2' });
    const rows = [{ phone: '13812345678' }];
    const result = applyMasking(rows, config);
    assert.equal(result[0].phone, '138****5678');
  });

  test('does NOT mask when field name matches but value does not', () => {
    const config = makeConfig({ mode: 'strict-v2' });
    const rows = [{ phone: 'not-a-phone' }];
    const result = applyMasking(rows, config);
    // strict-v2: 值不匹配正则则不脱敏（比 strict 更安全）
    assert.equal(result[0].phone, 'not-a-phone');
  });

  test('does NOT mask when value matches but field name does not', () => {
    const config = makeConfig({ mode: 'strict-v2' });
    const rows = [{ random_field: '13812345678' }];
    const result = applyMasking(rows, config);
    // 字段名不匹配任何规则
    assert.equal(result[0].random_field, '13812345678');
  });

  test('masks email when both field and value match', () => {
    const config = makeConfig({ mode: 'strict-v2' });
    const rows = [{ email: 'test@example.com' }];
    const result = applyMasking(rows, config);
    assert.equal(result[0].email, 't***@example.com');
  });

  test('does NOT mask email when value is not email format', () => {
    const config = makeConfig({ mode: 'strict-v2' });
    const rows = [{ email: 'not-an-email' }];
    const result = applyMasking(rows, config);
    assert.equal(result[0].email, 'not-an-email');
  });

  test('respects excludeFields in strict-v2 mode', () => {
    const config = makeConfig({ mode: 'strict-v2', excludeFields: ['phone'] });
    const rows = [{ phone: '13812345678' }];
    const result = applyMasking(rows, config);
    assert.equal(result[0].phone, '13812345678');
  });

  test('masks id_card when both field and value match', () => {
    const config = makeConfig({ mode: 'strict-v2' });
    const rows = [{ id_card: '110101199001011234' }];
    const result = applyMasking(rows, config);
    assert.equal(result[0].id_card, '110101****1234');
  });

  test('does NOT mask id_card when value is short', () => {
    const config = makeConfig({ mode: 'strict-v2' });
    const rows = [{ id_card: '12345' }];
    const result = applyMasking(rows, config);
    assert.equal(result[0].id_card, '12345');
  });
});

function makeConfig(overrides = {}) {
  return {
    ...getDefaultMaskingConfig(),
    enabled: true,
    mode: 'loose',
    ...overrides,
  };
}

// ── 基础功能 ──────────────────────────────────────────

describe('applyMasking', () => {
  test('returns rows unchanged when mode is off', () => {
    const config = makeConfig({ mode: 'off', enabled: false });
    const rows = [{ phone: '13812345678' }];
    const result = applyMasking(rows, config);
    assert.deepStrictEqual(result, rows);
  });

  test('returns rows unchanged when rows are empty', () => {
    const config = makeConfig();
    const result = applyMasking([], config);
    assert.deepStrictEqual(result, []);
  });

  test('does not mutate original rows', () => {
    const config = makeConfig();
    const original = [{ phone: '13812345678' }];
    const copy = JSON.parse(JSON.stringify(original));
    applyMasking(original, config);
    assert.deepStrictEqual(original, copy);
  });
});

// ── 手机号脱敏 ──────────────────────────────────────────

describe('phone masking', () => {
  test('masks phone number by field name in loose mode', () => {
    const config = makeConfig({ mode: 'loose' });
    const rows = [{ phone: '13812345678', name: 'Alice' }];
    const result = applyMasking(rows, config);
    assert.equal(result[0].phone, '138****5678');
    assert.equal(result[0].name, 'Alice');
  });

  test('masks phone in strict mode by field name', () => {
    const config = makeConfig({ mode: 'strict' });
    const rows = [{ phone: '13812345678' }];
    const result = applyMasking(rows, config);
    assert.equal(result[0].phone, '138****5678');
  });

  test('masks mobile field name', () => {
    const config = makeConfig({ mode: 'loose' });
    const rows = [{ mobile: '13900001111' }];
    const result = applyMasking(rows, config);
    assert.equal(result[0].mobile, '139****1111');
  });
});

// ── 邮箱脱敏 ──────────────────────────────────────────

describe('email masking', () => {
  test('masks email in loose mode', () => {
    const config = makeConfig({ mode: 'loose' });
    const rows = [{ email: 'test@example.com' }];
    const result = applyMasking(rows, config);
    assert.equal(result[0].email, 't***@example.com');
  });

  test('masks email in strict mode', () => {
    const config = makeConfig({ mode: 'strict' });
    const rows = [{ email: 'alice@company.org' }];
    const result = applyMasking(rows, config);
    assert.equal(result[0].email, 'a***@company.org');
  });
});

// ── 身份证脱敏 ──────────────────────────────────────────

describe('id_card masking', () => {
  test('masks id_card in loose mode', () => {
    const config = makeConfig({ mode: 'loose' });
    const rows = [{ id_card: '110101199001011234' }];
    const result = applyMasking(rows, config);
    assert.equal(result[0].id_card, '110101****1234');
  });
});

// ── 信用卡/银行卡脱敏 ──────────────────────────────────────

describe('credit_card masking', () => {
  test('masks credit card number in loose mode', () => {
    const config = makeConfig({ mode: 'loose' });
    const rows = [{ credit_card: '6222021234567890123' }];
    const result = applyMasking(rows, config);
    assert.equal(result[0].credit_card, '6222 **** **** 0123');
  });
});

describe('bank_card masking', () => {
  test('masks bank card number in loose mode', () => {
    const config = makeConfig({ mode: 'loose' });
    const rows = [{ bank_card: '6222021234567890' }];
    const result = applyMasking(rows, config);
    assert.equal(result[0].bank_card, '6222 **** **** 7890');
  });
});

// ── IP 地址脱敏 ──────────────────────────────────────────

describe('ip_address masking', () => {
  test('masks ip_address field in loose mode', () => {
    const config = makeConfig({ mode: 'loose' });
    const rows = [{ ip_address: '192.168.1.100' }];
    const result = applyMasking(rows, config);
    assert.equal(result[0].ip_address, '192.168.*.*');
  });
});

// ── 白名单排除 ──────────────────────────────────────────

describe('excludeFields', () => {
  test('excluded fields are not masked', () => {
    const config = makeConfig({
      mode: 'loose',
      excludeFields: ['phone'],
    });
    const rows = [{ phone: '13812345678', email: 'test@example.com' }];
    const result = applyMasking(rows, config);
    assert.equal(result[0].phone, '13812345678');
    assert.equal(result[0].email, 't***@example.com');
  });

  test('case-insensitive exclude', () => {
    const config = makeConfig({
      mode: 'loose',
      excludeFields: ['PHONE'],
    });
    const rows = [{ phone: '13812345678' }];
    const result = applyMasking(rows, config);
    assert.equal(result[0].phone, '13812345678');
  });
});

// ── strict vs loose 模式差异 ──────────────────────────────────

describe('mode differences', () => {
  test('strict mode masks by field name even if value does not match pattern', () => {
    const config = makeConfig({ mode: 'strict' });
    const rows = [{ phone: 'not-a-phone' }];
    const result = applyMasking(rows, config);
    // strict mode: 只要字段名匹配就脱敏，不管值是否符合正则
    // maskPhone: slice(0,3) + '****' + slice(-4) => 'not' + '****' + 'hone'
    assert.equal(result[0].phone, 'not****hone');
  });

  test('loose mode does not mask if value does not match pattern', () => {
    const config = makeConfig({ mode: 'loose' });
    const rows = [{ phone: 'not-a-phone' }];
    const result = applyMasking(rows, config);
    // loose mode: 值不匹配正则则不脱敏
    assert.equal(result[0].phone, 'not-a-phone');
  });
});

// ── 多行处理 ──────────────────────────────────────────

describe('multiple rows', () => {
  test('processes all rows', () => {
    const config = makeConfig({ mode: 'loose' });
    const rows = [
      { phone: '13800001111' },
      { phone: '13900002222' },
      { phone: '15000003333' },
    ];
    const result = applyMasking(rows, config);
    assert.equal(result[0].phone, '138****1111');
    assert.equal(result[1].phone, '139****2222');
    assert.equal(result[2].phone, '150****3333');
  });
});

// ── 默认规则集 ──────────────────────────────────────────

describe('DEFAULT_MASKING_RULES', () => {
  test('has expected rule count', () => {
    assert.ok(DEFAULT_MASKING_RULES.length >= 6);
  });

  test('each rule has required properties', () => {
    for (const rule of DEFAULT_MASKING_RULES) {
      assert.ok(typeof rule.name === 'string');
      assert.ok(Array.isArray(rule.fieldPatterns));
      assert.ok(Array.isArray(rule.valuePatterns));
      assert.ok(typeof rule.mask === 'function');
    }
  });
});

// ── 非字符串值 ──────────────────────────────────────────

describe('non-string values', () => {
  test('does not mask non-string values in loose mode', () => {
    const config = makeConfig({ mode: 'loose' });
    const rows = [{ phone: 13812345678 }];
    const result = applyMasking(rows, config);
    assert.equal(result[0].phone, 13812345678);
  });

  test('passes through null/undefined', () => {
    const config = makeConfig({ mode: 'loose' });
    const rows = [{ phone: null, email: undefined }];
    const result = applyMasking(rows, config);
    assert.equal(result[0].phone, null);
    assert.equal(result[0].email, undefined);
  });
});

// ── getDefaultMaskingConfig ──────────────────────────────

describe('getDefaultMaskingConfig', () => {
  test('returns off mode by default', () => {
    const config = getDefaultMaskingConfig();
    assert.equal(config.mode, 'off');
    assert.equal(config.enabled, false);
  });

  test('has rules array', () => {
    const config = getDefaultMaskingConfig();
    assert.ok(Array.isArray(config.rules));
    assert.ok(config.rules.length > 0);
  });

  test('has empty exclude arrays', () => {
    const config = getDefaultMaskingConfig();
    assert.deepStrictEqual(config.excludeFields, []);
    assert.deepStrictEqual(config.excludeConnections, []);
  });
});
