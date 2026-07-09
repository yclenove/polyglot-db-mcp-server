import assert from 'node:assert/strict';
import { describe, test, beforeEach } from 'node:test';
import {
  addCustomMaskingRule,
  removeCustomMaskingRule,
  listMaskingRules,
  resetMaskingConfig,
  getMaskingConfig,
} from '../dist/tools/masking.js';
import { applyMasking } from '../dist/core/data-masking.js';

// ── 自定义规则管理 ──────────────────────────────────────────

describe('manage_masking_rules', () => {
  beforeEach(() => {
    resetMaskingConfig();
  });

  test('list returns built-in rules', () => {
    const rules = listMaskingRules();
    assert.ok(rules.length >= 6);
    // 内置规则标记为 isCustom=false
    for (const rule of rules) {
      assert.equal(rule.isCustom, false);
    }
  });

  test('add creates a custom rule', () => {
    addCustomMaskingRule({
      name: 'ssn',
      fieldPattern: 'ssn|social_security',
      valuePattern: '^\\d{3}-\\d{2}-\\d{4}$',
      replacement: '***-**-****',
    });
    const rules = listMaskingRules();
    const custom = rules.find((r) => r.name === 'ssn');
    assert.ok(custom);
    assert.equal(custom.isCustom, true);
    assert.equal(custom.fieldPatterns[0], 'ssn|social_security');
  });

  test('add rejects duplicate rule name', () => {
    addCustomMaskingRule({
      name: 'test_rule',
      fieldPattern: 'test',
      valuePattern: '.*',
      replacement: '***',
    });
    assert.throws(
      () => addCustomMaskingRule({ name: 'test_rule', fieldPattern: 'x', valuePattern: '.*', replacement: '***' }),
      /已存在/
    );
  });

  test('remove deletes a custom rule', () => {
    addCustomMaskingRule({
      name: 'temp_rule',
      fieldPattern: 'temp',
      valuePattern: '.*',
      replacement: '***',
    });
    const removed = removeCustomMaskingRule('temp_rule');
    assert.equal(removed, true);
    const rules = listMaskingRules();
    assert.ok(!rules.find((r) => r.name === 'temp_rule'));
  });

  test('remove returns false for non-existent rule', () => {
    const removed = removeCustomMaskingRule('non_existent');
    assert.equal(removed, false);
  });

  test('remove returns false for built-in rule', () => {
    const removed = removeCustomMaskingRule('phone');
    assert.equal(removed, false);
    // 确认内置规则仍然存在
    const rules = listMaskingRules();
    assert.ok(rules.find((r) => r.name === 'phone'));
  });

  test('custom rule is applied during masking', () => {
    addCustomMaskingRule({
      name: 'passport',
      fieldPattern: 'passport',
      valuePattern: '^[A-Z]\\d{8}$',
      replacement: '*********',
    });
    const config = getMaskingConfig();
    config.mode = 'loose';
    config.enabled = true;
    const rows = [{ passport: 'E12345678' }];
    const result = applyMasking(rows, config);
    assert.equal(result[0].passport, '*********');
  });

  test('custom rule with strict-v2 mode', () => {
    addCustomMaskingRule({
      name: 'custom_ssn',
      fieldPattern: 'ssn',
      valuePattern: '^\\d{3}-\\d{2}-\\d{4}$',
      replacement: '***-**-****',
    });
    const config = getMaskingConfig();
    config.mode = 'strict-v2';
    config.enabled = true;

    // 值匹配时脱敏
    const rows1 = [{ ssn: '123-45-6789' }];
    const result1 = applyMasking(rows1, config);
    assert.equal(result1[0].ssn, '***-**-****');

    // 值不匹配时不脱敏
    const rows2 = [{ ssn: 'not-an-ssn' }];
    const result2 = applyMasking(rows2, config);
    assert.equal(result2[0].ssn, 'not-an-ssn');
  });

  test('custom rule does not affect built-in rules', () => {
    const beforeCount = listMaskingRules().length;
    addCustomMaskingRule({
      name: 'new_rule',
      fieldPattern: 'new_field',
      valuePattern: '.*',
      replacement: '***',
    });
    const afterCount = listMaskingRules().length;
    assert.equal(afterCount, beforeCount + 1);
    // 内置规则仍在
    const rules = listMaskingRules();
    assert.ok(rules.find((r) => r.name === 'phone'));
    assert.ok(rules.find((r) => r.name === 'email'));
  });
});
