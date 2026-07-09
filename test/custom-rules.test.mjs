import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  applyMasking,
  getDefaultMaskingConfig,
  DEFAULT_MASKING_RULES,
} from '../dist/core/data-masking.js';

function makeConfig(overrides = {}) {
  return {
    ...getDefaultMaskingConfig(),
    enabled: true,
    mode: 'loose',
    ...overrides,
  };
}

// ── TC-CUST-001: 添加自定义规则 ──────────────────────────────────────────

describe('TC-CUST-001: add custom rule', () => {
  test('custom rule is applied when value matches', () => {
    const customRule = {
      name: 'employee_id',
      fieldPatterns: [/employee_id/i, /emp_id/i],
      valuePatterns: [/^EMP\d{6}$/],
      mask: (v) => v.slice(0, 3) + '***' + v.slice(-2),
    };
    const config = makeConfig({
      rules: [...DEFAULT_MASKING_RULES, customRule],
    });
    const rows = [{ employee_id: 'EMP123456' }];
    const result = applyMasking(rows, config);
    assert.equal(result[0].employee_id, 'EMP***56');
  });

  test('custom rule with multiple field patterns', () => {
    const customRule = {
      name: 'ssn',
      fieldPatterns: [/ssn/i, /social_security/i],
      valuePatterns: [/^\d{3}-\d{2}-\d{4}$/],
      mask: (v) => '***-**-' + v.slice(-4),
    };
    const config = makeConfig({
      rules: [...DEFAULT_MASKING_RULES, customRule],
    });
    const rows = [{ ssn: '123-45-6789' }];
    const result = applyMasking(rows, config);
    assert.equal(result[0].ssn, '***-**-6789');
  });
});

// ── TC-CUST-002: 删除自定义规则 ──────────────────────────────────────────

describe('TC-CUST-002: remove custom rule', () => {
  test('removed rule no longer masks values', () => {
    const customRule = {
      name: 'temp_field',
      fieldPatterns: [/temp_field/i],
      valuePatterns: [/^TEMP/],
      mask: (v) => '***' + v.slice(-2),
    };
    // 先添加规则
    const configWithRule = makeConfig({
      rules: [...DEFAULT_MASKING_RULES, customRule],
    });
    const rows = [{ temp_field: 'TEMP12345' }];
    const resultWith = applyMasking(rows, configWithRule);
    assert.equal(resultWith[0].temp_field, '***45');

    // 移除规则后
    const configWithoutRule = makeConfig({
      rules: DEFAULT_MASKING_RULES,
    });
    const resultWithout = applyMasking(rows, configWithoutRule);
    assert.equal(resultWithout[0].temp_field, 'TEMP12345');
  });

  test('removing built-in rule disables that masking', () => {
    // 移除 phone 规则
    const rulesWithoutPhone = DEFAULT_MASKING_RULES.filter((r) => r.name !== 'phone');
    const config = makeConfig({ rules: rulesWithoutPhone });
    const rows = [{ phone: '13812345678' }];
    const result = applyMasking(rows, config);
    // phone 规则被移除，不应脱敏
    assert.equal(result[0].phone, '13812345678');
  });
});

// ── TC-CUST-003: 列出所有规则 ──────────────────────────────────────────

describe('TC-CUST-003: list all rules', () => {
  test('DEFAULT_MASKING_RULES contains expected built-in rules', () => {
    assert.ok(Array.isArray(DEFAULT_MASKING_RULES));
    assert.ok(DEFAULT_MASKING_RULES.length >= 6);
    const names = DEFAULT_MASKING_RULES.map((r) => r.name);
    assert.ok(names.includes('phone'));
    assert.ok(names.includes('email'));
    assert.ok(names.includes('id_card'));
    assert.ok(names.includes('ip_address'));
  });

  test('each rule has required structure', () => {
    for (const rule of DEFAULT_MASKING_RULES) {
      assert.ok(typeof rule.name === 'string', 'rule.name should be string');
      assert.ok(Array.isArray(rule.fieldPatterns), 'rule.fieldPatterns should be array');
      assert.ok(rule.fieldPatterns.length > 0, 'rule.fieldPatterns should not be empty');
      assert.ok(Array.isArray(rule.valuePatterns), 'rule.valuePatterns should be array');
      assert.ok(typeof rule.mask === 'function', 'rule.mask should be function');
    }
  });

  test('config.rules returns combined list when custom rules added', () => {
    const customRule = {
      name: 'custom_field',
      fieldPatterns: [/custom/i],
      valuePatterns: [/^CUSTOM/],
      mask: (v) => '***',
    };
    const config = makeConfig({
      rules: [...DEFAULT_MASKING_RULES, customRule],
    });
    assert.equal(config.rules.length, DEFAULT_MASKING_RULES.length + 1);
    const names = config.rules.map((r) => r.name);
    assert.ok(names.includes('custom_field'));
    assert.ok(names.includes('phone'));
  });
});

// ── TC-CUST-004: 自定义规则与内置规则共存 ──────────────────────────────────────────

describe('TC-CUST-004: custom and built-in rules coexist', () => {
  test('both built-in and custom rules apply to different fields', () => {
    const customRule = {
      name: 'passport',
      fieldPatterns: [/passport/i],
      valuePatterns: [/^[A-Z]\d{8}$/],
      mask: (v) => v[0] + '****' + v.slice(-3),
    };
    const config = makeConfig({
      rules: [...DEFAULT_MASKING_RULES, customRule],
    });
    const rows = [{
      phone: '13812345678',
      email: 'test@example.com',
      passport: 'E12345678',
    }];
    const result = applyMasking(rows, config);
    // 内置规则生效
    assert.equal(result[0].phone, '138****5678');
    assert.equal(result[0].email, 't***@example.com');
    // 自定义规则生效
    assert.equal(result[0].passport, 'E****678');
  });

  test('custom rule does not interfere with built-in rules', () => {
    const customRule = {
      name: 'order_no',
      fieldPatterns: [/order_no/i],
      valuePatterns: [/^ORD-/],
      mask: (v) => 'ORD-****',
    };
    const config = makeConfig({
      rules: [...DEFAULT_MASKING_RULES, customRule],
    });
    const rows = [
      { phone: '13812345678', order_no: 'ORD-12345' },
      { email: 'a@b.com', order_no: 'ORD-67890' },
    ];
    const result = applyMasking(rows, config);
    // 所有字段均按各自规则脱敏
    assert.equal(result[0].phone, '138****5678');
    assert.equal(result[0].order_no, 'ORD-****');
    assert.equal(result[1].email, 'a***@b.com');
    assert.equal(result[1].order_no, 'ORD-****');
  });

  test('custom rule with same field pattern as built-in takes precedence (first match)', () => {
    const stricterPhoneRule = {
      name: 'strict_phone',
      fieldPatterns: [/phone/i],
      valuePatterns: [/^1[3-9]\d{9}$/],
      mask: () => '***REDACTED***',
    };
    // 自定义规则放在内置规则前面
    const config = makeConfig({
      rules: [stricterPhoneRule, ...DEFAULT_MASKING_RULES],
    });
    const rows = [{ phone: '13812345678' }];
    const result = applyMasking(rows, config);
    // 第一个匹配的规则生效
    assert.equal(result[0].phone, '***REDACTED***');
  });
});
