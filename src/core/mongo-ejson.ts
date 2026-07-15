import { BSON } from 'mongodb';

export function isMongoBsonValue(value: unknown): value is InstanceType<typeof BSON.BSONValue> {
  return value instanceof BSON.BSONValue;
}

function parseMongoEjson(raw: string, fieldName: string): unknown {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw new Error(`${fieldName} 不是合法 JSON/EJSON`);
  }
  return BSON.EJSON.deserialize(parsed as Parameters<typeof BSON.EJSON.deserialize>[0], {
    relaxed: false,
  });
}

export function parseMongoEjsonObject(
  raw: string | undefined,
  fieldName: string,
): Record<string, unknown> {
  if (raw === undefined) throw new Error(`${fieldName} 为必填 JSON/EJSON 对象字符串`);
  const parsed = parseMongoEjson(raw, fieldName);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${fieldName} 须为 JSON/EJSON 对象`);
  }
  return parsed as Record<string, unknown>;
}

export function parseMongoEjsonObjectArray(
  raw: string | undefined,
  fieldName: string,
): Record<string, unknown>[] {
  if (raw === undefined) throw new Error(`${fieldName} 为必填 JSON/EJSON 数组字符串`);
  const parsed = parseMongoEjson(raw, fieldName);
  if (!Array.isArray(parsed)) throw new Error(`${fieldName} 须为 JSON/EJSON 数组`);
  if (!parsed.every((item) => typeof item === 'object' && item !== null && !Array.isArray(item))) {
    throw new Error(`${fieldName} 的每一项都必须是 JSON/EJSON 对象`);
  }
  return parsed as Record<string, unknown>[];
}

export function parseMongoEjsonArray(raw: string, fieldName: string): unknown[] {
  const parsed = parseMongoEjson(raw, fieldName);
  if (!Array.isArray(parsed)) throw new Error(`${fieldName} 须为 JSON/EJSON 数组`);
  return parsed;
}

export function toMongoJsonSafe(value: unknown): unknown {
  if (typeof value === 'bigint') return value.toString();
  if (Array.isArray(value)) return value.map(toMongoJsonSafe);
  if (value instanceof Date) return value.toISOString();
  if (value === null || typeof value !== 'object') return value;

  if (isMongoBsonValue(value)) {
    return BSON.EJSON.serialize(value, { relaxed: false });
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, nested]) => [key, toMongoJsonSafe(nested)]),
  );
}

export function stringifyMongoResult(value: unknown): string {
  return JSON.stringify(toMongoJsonSafe(value));
}
