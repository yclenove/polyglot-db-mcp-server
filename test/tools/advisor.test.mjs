import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { registerAdvisorTools } from '../../dist/tools/advisor.js';

class MockServer {
  tools = new Map();

  registerTool(name, config, handler) {
    this.tools.set(name, { config, handler });
  }
}

function resultValue(result) {
  return JSON.parse(result.content[0].text);
}

const metadataByEngine = {
  mysql: {
    columns: [
      { Field: 'id', Type: 'int', Key: 'PRI' },
      { Field: 'score', Type: 'int', Key: '' },
      { Field: 'name', Type: 'varchar', Key: '' },
    ],
    indexes: [
      { Key_name: 'PRIMARY', Column_name: 'id' },
      { Key_name: 'idx_score', Column_name: 'score' },
    ],
  },
  postgres: {
    columns: [
      { column_name: 'id', data_type: 'integer' },
      { column_name: 'score', data_type: 'integer' },
      { column_name: 'name', data_type: 'character varying' },
    ],
    indexes: [
      { name: 't_pkey', column_name: 'id' },
      { name: 'idx_score', column_name: 'score' },
    ],
  },
  mssql: {
    columns: [
      { COLUMN_NAME: 'id', DATA_TYPE: 'int' },
      { COLUMN_NAME: 'score', DATA_TYPE: 'int' },
      { COLUMN_NAME: 'name', DATA_TYPE: 'varchar' },
    ],
    indexes: [
      { name: 't_pkey', column_name: 'id' },
      { name: 'idx_score', column_name: 'score' },
    ],
  },
  oracle: {
    columns: [
      { COLUMN_NAME: 'ID', DATA_TYPE: 'NUMBER' },
      { COLUMN_NAME: 'SCORE', DATA_TYPE: 'NUMBER' },
      { COLUMN_NAME: 'NAME', DATA_TYPE: 'VARCHAR2' },
    ],
    indexes: [
      { NAME: 'T_PKEY', COLUMN_NAME: 'ID' },
      { NAME: 'IDX_SCORE', COLUMN_NAME: 'SCORE' },
    ],
  },
  sqlite: {
    columns: [
      { cid: 0, name: 'id', type: 'INTEGER', pk: 1 },
      { cid: 1, name: 'score', type: 'INTEGER', pk: 0 },
      { cid: 2, name: 'name', type: 'TEXT', pk: 0 },
    ],
    indexes: [
      { name: 'idx_score', column_name: 'score' },
    ],
  },
  duckdb: {
    columns: [
      { column_name: 'id', data_type: 'INTEGER' },
      { column_name: 'score', data_type: 'INTEGER' },
      { column_name: 'name', data_type: 'VARCHAR' },
    ],
    indexes: [
      { name: 'idx_score', definition: '[score]' },
      { name: 'idx_lower_name', definition: '[lower("name")]' },
    ],
  },
};

function createHarness(engine, metadata) {
  const server = new MockServer();
  let calls = 0;
  const driver = {
    engine,
    async execute() {
      const data = calls++ % 2 === 0 ? metadata.columns : metadata.indexes;
      return { success: true, data };
    },
  };
  const registry = {
    resolveConnectionId() {
      return engine;
    },
    requireSql() {
      return driver;
    },
  };
  registerAdvisorTools(server, registry);
  return server;
}

describe('advisor cross-engine metadata normalization', () => {
  for (const [engine, metadata] of Object.entries(metadataByEngine)) {
    test(`${engine} recognizes existing indexes and unindexed columns`, async () => {
      const server = createHarness(engine, metadata);
      const suggest = server.tools.get('query_suggest').handler;

      const indexed = resultValue(
        await suggest({ sql: 'SELECT id FROM t WHERE score = 1', connectionId: engine }),
      );
      assert.equal(indexed.analyzedWithSchema, true);
      assert.equal(indexed.tableCount, 1);
      assert.equal(
        indexed.suggestions.some(
          (item) => item.type === 'index' && item.message.includes('score'),
        ),
        false,
      );

      const unindexed = resultValue(
        await suggest({ sql: "SELECT id FROM t WHERE name = 'x'", connectionId: engine }),
      );
      assert.equal(
        unindexed.suggestions.some(
          (item) => item.type === 'index' && item.message.includes('name'),
        ),
        true,
      );
    });
  }
});
