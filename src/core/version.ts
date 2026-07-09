import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

let _version: string | undefined;

export function getVersion(): string {
  if (_version) return _version;

  // 方式 1: createRequire（ESM 中加载 JSON）
  try {
    const require = createRequire(import.meta.url);
    _version = require('../../package.json').version;
    return _version!;
  } catch {
    // 方式 2: 直接读文件（fallback）
  }

  try {
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const pkg = JSON.parse(readFileSync(join(__dirname, '../../package.json'), 'utf-8'));
    _version = pkg.version;
    return _version!;
  } catch {
    _version = '0.0.0-unknown';
    return _version;
  }
}
