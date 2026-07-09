/**
 * 简易令牌桶速率限制器。
 * 通过 DB_RATE_LIMIT_PER_SECOND 环境变量配置（默认 0 = 不限）。
 */

export class RateLimiter {
  private readonly buckets = new Map<string, { tokens: number; lastRefill: number }>();
  private readonly maxPerSecond: number;

  constructor(maxPerSecond: number = 0) {
    this.maxPerSecond = maxPerSecond;
  }

  /** 检查是否允许请求，返回 true 表示允许 */
  allow(key: string): boolean {
    if (this.maxPerSecond <= 0) return true;

    const now = Date.now();
    let bucket = this.buckets.get(key);
    if (!bucket) {
      bucket = { tokens: this.maxPerSecond, lastRefill: now };
      this.buckets.set(key, bucket);
    }

    // 补充令牌
    const elapsed = now - bucket.lastRefill;
    const refill = (elapsed / 1000) * this.maxPerSecond;
    bucket.tokens = Math.min(this.maxPerSecond, bucket.tokens + refill);
    bucket.lastRefill = now;

    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      return true;
    }
    return false;
  }
}

/** 从环境变量创建全局速率限制器 */
export function createRateLimiterFromEnv(): RateLimiter {
  const maxPerSecond = parseInt(process.env.DB_RATE_LIMIT_PER_SECOND || '0', 10);
  return new RateLimiter(maxPerSecond);
}
