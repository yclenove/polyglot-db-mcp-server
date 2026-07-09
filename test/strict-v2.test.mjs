import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  applyMasking,
  getDefaultMaskingConfig,
} from '../dist/core/data-masking.js';

function makeConfig(overrides = {}) {
  return {
    ...getDefaultMaskingConfig(),
    enabled: true,
    mode: 'strict-v2',
    ...overrides,
  };
}

// ── TC-V2-001: strict-v2 值正则匹配生效 ──────────────────────────────────────────

describe('TC-V2-001: strict-v2 value regex matching', () => {
  test('masks phone when value matches phone regex', () => {
    const config = makeConfig({ mode: 'strict-v2' });
    const rows = [{ phone: '13812345678' }];
    const result = applyMasking(rows, config);
    assert.equal(result[0].phone, '138****5678');
  });

  test('masks email when value matches email regex', () => {
    const config = makeConfig({ mode: 'strict-v2' });
    const rows = [{ email: 'test@example.com' }];
    const result = applyMasking(rows, config);
    assert.equal(result[0].email, 't***@example.com');
  });

  test('masks id_card when value matches id_card regex', () => {
    const config = makeConfig({ mode: 'strict-v2' });
    const rows = [{ id_card: '110101199001011234' }];
    const result = applyMasking(rows, config);
    assert.equal(result[0].id_card, '110101****1234');
  });
});

// ── TC-V2-002: strict-v2 字段名匹配仍生效 ──────────────────────────────────────────

describe('TC-V2-002: strict-v2 field name matching', () => {
  test('does NOT mask when field name matches but value does not match regex', () => {
    const config = makeConfig({ mode: 'strict-v2' });
    const rows = [{ phone: 'not-a-phone' }];
    const result = applyMasking(rows, config);
    // strict-v2: 字段名匹配但值不匹配正则 -> 不脱敏
    assert.equal(result[0].phone, 'not-a-phone');
  });

  test('does NOT mask when field name matches but value is random string', () => {
    const config = makeConfig({ mode: 'strict-v2' });
    const rows = [{ email: 'hello world' }];
    const result = applyMasking(rows, config);
    assert.equal(result[0].email, 'hello world');
  });
});

// ── TC-V2-003: strict 模式向后兼容 ──────────────────────────────────────────

describe('TC-V2-003: strict mode backward compatibility', () => {
  test('strict mode still masks by field name only (legacy behavior)', () => {
    const config = makeConfig({ mode: 'strict' });
    const rows = [{ phone: 'not-a-phone' }];
    const result = applyMasking(rows, config);
    // strict 模式: 只要字段名匹配就脱敏，不管值
    assert.equal(result[0].phone, 'not****hone');
  });

  test('strict mode masks email even if value is not email format', () => {
    const config = makeConfig({ mode: 'strict' });
    const rows = [{ email: 'no-at-sign' }];
    const result = applyMasking(rows, config);
    // strict 模式: 字段名匹配即脱敏
    assert.ok(result[0].email !== 'no-at-sign');
  });
});

// ── TC-V2-004: 自定义规则在 strict-v2 下生效 ──────────────────────────────────────────

describe('TC-V2-004: custom rules in strict-v2 mode', () => {
  test('custom rule applies in strict-v2 mode when value matches', () => {
    const customRule = {
      name: 'order_id',
      fieldPatterns: [/order_id/i],
      valuePatterns: [/^ORD\d+$/],
      mask: (v) => v.slice(0, 3) + '****' + v.slice(-2),
    };
    const config = makeConfig({
      mode: 'strict-v2',
      rules: [...getDefaultMaskingConfig().rules, customRule],
    });
    const rows = [{ order_id: 'ORD123456789' }];
    const result = applyMasking(rows, config);
    assert.equal(result[0].order_id, 'ORD****89');
  });

  test('custom rule does NOT apply in strict-v2 when value does not match', () => {
    const customRule = {
      name: 'order_id',
      fieldPatterns: [/order_id/i],
      valuePatterns: [/^ORD\d+$/],
      mask: (v) => v.slice(0, 3) + '****',
    };
    const config = makeConfig({
      mode: 'strict-v2',
      rules: [...getDefaultMaskingConfig().rules, customRule],
    });
    const rows = [{ order_id: 'not-an-order' }];
    const result = applyMasking(rows, config);
    assert.equal(result[0].order_id, 'not-an-order');
  });
});

// ── TC-V2-005: 非敏感值不被误匹配 ──────────────────────────────────────────

describe('TC-V2-005: non-sensitive values not falsely masked', () => {
  test('normal text in phone field is not masked in strict-v2', () => {
    const config = makeConfig({ mode: 'strict-v2' });
    const rows = [{ phone: 'hello' }];
    const result = applyMasking(rows, config);
    assert.equal(result[0].phone, 'hello');
  });

  test('short number in id_card field is not masked in strict-v2', () => {
    const config = makeConfig({ mode: 'strict-v2' });
    const rows = [{ id_card: '12345' }];
    const result = applyMasking(rows, config);
    assert.equal(result[0].id_card, '12345');
  });

  test('non-ip string in ip_address field is not masked in strict-v2', () => {
    const config = makeConfig({ mode: 'strict-v2' });
    const rows = [{ ip_address: 'not-an-ip' }];
    const result = applyMasking(rows, config);
    assert.equal(result[0].ip_address, 'not-an-ip');
  });

  test('unrelated fields are never affected', () => {
    const config = makeConfig({ mode: 'strict-v2' });
    const rows = [{ name: 'Alice', age: 30, city: 'Beijing' }];
    const result = applyMasking(rows, config);
    assert.equal(result[0].name, 'Alice');
    assert.equal(result[0].age, 30);
    assert.equal(result[0].city, 'Beijing');
  });
});
