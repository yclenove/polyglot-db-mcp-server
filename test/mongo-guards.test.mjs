import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  detectNoSqlInjection,
  findDisallowedMongoPipelineCollection,
  getMongoPipelineReferencedCollections,
} from '../dist/core/mongo-guards.js';
import {
  parseMongoEjsonObject,
  stringifyMongoResult,
  toMongoJsonSafe,
} from '../dist/core/mongo-ejson.js';

describe('MongoDB guards', () => {
  test('detects dangerous operators nested inside arrays', () => {
    const input = {
      $and: [{ status: 'active' }, { nested: [{ $where: 'return true' }] }],
    };
    assert.match(detectNoSqlInjection(input), /\$where/);
  });

  test('rejects write-capable aggregation stages', () => {
    assert.match(detectNoSqlInjection([{ $out: 'leaked' }]), /\$out/);
    assert.match(detectNoSqlInjection([{ $merge: { into: 'leaked' } }]), /\$merge/);
  });

  test('does not trust a forged _bsontype field', () => {
    const input = {
      _bsontype: 'Long',
      nested: [{ $where: 'return true' }],
    };
    assert.match(detectNoSqlInjection(input), /\$where/);
    assert.deepEqual(toMongoJsonSafe({ _bsontype: 'business-field', value: 'safe' }), {
      _bsontype: 'business-field',
      value: 'safe',
    });
  });

  test('collects direct and nested cross-collection references', () => {
    const pipeline = [
      { $lookup: { from: 'accounts', localField: 'accountId', foreignField: '_id', as: 'a' } },
      { $graphLookup: { from: 'orgs', startWith: '$orgId', connectFromField: 'parent', connectToField: '_id', as: 'o' } },
      { $facet: { related: [{ $unionWith: { coll: 'archives', pipeline: [] } }] } },
    ];
    assert.deepEqual(getMongoPipelineReferencedCollections(pipeline), [
      'accounts',
      'orgs',
      'archives',
    ]);
    assert.equal(
      findDisallowedMongoPipelineCollection(pipeline, ['accounts', 'orgs']),
      'archives',
    );
    assert.equal(
      findDisallowedMongoPipelineCollection(pipeline, ['accounts', 'orgs', 'archives']),
      null,
    );
  });
});

describe('MongoDB Extended JSON', () => {
  test('parses and serializes Int64 without precision loss', () => {
    const parsed = parseMongoEjsonObject(
      '{"id":{"$numberLong":"9007199254740993"}}',
      'filter_json',
    );
    assert.equal(parsed.id?._bsontype, 'Long');
    assert.equal(parsed.id?.toString(), '9007199254740993');
    assert.deepEqual(JSON.parse(stringifyMongoResult(parsed)), {
      id: { $numberLong: '9007199254740993' },
    });
  });

  test('preserves regular JSON values while using canonical BSON wrappers', () => {
    const parsed = parseMongoEjsonObject(
      '{"name":"alpha","count":1,"oid":{"$oid":"507f1f77bcf86cd799439011"}}',
      'document_json',
    );
    const safe = toMongoJsonSafe(parsed);
    assert.equal(safe.name, 'alpha');
    assert.deepEqual(safe.count, { $numberInt: '1' });
    assert.deepEqual(safe.oid, { $oid: '507f1f77bcf86cd799439011' });
  });

  test('rejects Extended JSON regular expressions through the common guard', () => {
    const parsed = parseMongoEjsonObject(
      '{"name":{"$regularExpression":{"pattern":".*","options":""}}}',
      'filter_json',
    );
    assert.match(detectNoSqlInjection(parsed), /正则表达式/);
  });
});
