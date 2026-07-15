import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { createRegistryFromSpecs } from '../dist/bootstrap.js';

function createSqlHandle(spec, closed) {
  return {
    id: spec.id,
    spec,
    kind: 'sql',
    driver: {
      engine: 'sqlite',
      ping: async () => ({ ok: true }),
      execute: async () => ({ success: true }),
      beginTransaction: async () => {
        throw new Error('not used');
      },
      close: async () => {
        closed.push(spec.id);
      },
    },
  };
}

describe('registry bootstrap cleanup', () => {
  test('closes every fulfilled handle when one connection fails', async () => {
    const specs = [
      { id: 'first', engine: 'sqlite', url: ':memory:' },
      { id: 'broken', engine: 'sqlite', url: ':memory:' },
      { id: 'late', engine: 'sqlite', url: ':memory:' },
    ];
    const closed = [];

    await assert.rejects(
      createRegistryFromSpecs(specs, 'first', async (spec) => {
        if (spec.id === 'broken') throw new Error('connection failed');
        if (spec.id === 'late') await new Promise((resolve) => setTimeout(resolve, 20));
        return createSqlHandle(spec, closed);
      }),
      /connection failed/,
    );

    assert.deepEqual(closed.sort(), ['first', 'late']);
  });

  test('closes handles when registry validation fails', async () => {
    const specs = [{ id: 'only', engine: 'sqlite', url: ':memory:' }];
    const closed = [];

    await assert.rejects(
      createRegistryFromSpecs(specs, 'missing', async (spec) => createSqlHandle(spec, closed)),
      /默认连接 id/,
    );

    assert.deepEqual(closed, ['only']);
  });
});
