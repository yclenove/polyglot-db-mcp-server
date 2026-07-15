import { BSON } from 'mongodb';

const DANGEROUS_MONGO_OPERATORS = new Map<string, string>([
  ['$where', '可执行服务器端 JavaScript'],
  ['$function', '可执行服务器端 JavaScript'],
  ['$accumulator', '可执行服务器端 JavaScript'],
  ['$expr', '可执行动态表达式'],
  ['$regex', '可执行高开销正则查询'],
  ['$regularExpression', '可执行高开销正则查询'],
  ['$out', '可从只读聚合工具写入集合'],
  ['$merge', '可从只读聚合工具写入集合'],
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** 递归检查 MongoDB 输入，数组中的嵌套 operator 也必须被扫描。 */
export function detectNoSqlInjection(value: unknown, path = ''): string | null {
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index++) {
      const nested = detectNoSqlInjection(value[index], `${path}[${index}]`);
      if (nested) return nested;
    }
    return null;
  }
  if (!isRecord(value)) return null;

  if (value instanceof BSON.BSONRegExp) {
    return `潜在 NoSQL 注入风险：字段「${path || '<root>'}」使用了 Extended JSON 正则表达式`;
  }
  if (value instanceof BSON.BSONValue) return null;

  for (const [key, nestedValue] of Object.entries(value)) {
    const currentPath = path ? `${path}.${key}` : key;
    const reason = DANGEROUS_MONGO_OPERATORS.get(key);
    if (reason) {
      return `潜在 NoSQL 注入风险：字段「${currentPath}」使用了 ${key}，${reason}`;
    }
    const nested = detectNoSqlInjection(nestedValue, currentPath);
    if (nested) return nested;
  }
  return null;
}

export function getMongoPipelineReferencedCollections(pipeline: unknown[]): string[] {
  const collections = new Set<string>();

  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (!isRecord(value)) return;

    for (const [key, nestedValue] of Object.entries(value)) {
      if ((key === '$lookup' || key === '$graphLookup') && isRecord(nestedValue)) {
        if (typeof nestedValue.from === 'string') collections.add(nestedValue.from);
      } else if (key === '$unionWith') {
        if (typeof nestedValue === 'string') {
          collections.add(nestedValue);
        } else if (isRecord(nestedValue) && typeof nestedValue.coll === 'string') {
          collections.add(nestedValue.coll);
        }
      }
      visit(nestedValue);
    }
  };

  visit(pipeline);
  return [...collections];
}

export function findDisallowedMongoPipelineCollection(
  pipeline: unknown[],
  allowlist: readonly string[] | undefined,
): string | null {
  if (!allowlist?.length) return null;
  const allowed = new Set(allowlist);
  return getMongoPipelineReferencedCollections(pipeline).find((name) => !allowed.has(name)) ?? null;
}
