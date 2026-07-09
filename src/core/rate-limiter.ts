/**
 * 简易令牌桶速率限制器。
 * 通过 DB_RATE_LIMIT_PER_SECOND 环境变量配置（默认 0 = 不限）。
 */

export class RateLimiter {
  private readonly buckets = new Map<
    string,
    { tokens: number; lastRefill: number; lastUsed: number }
  >();
  private readonly maxPerSecond: number;
  private readonly idleTtlMs: number;
  private readonly now: () => number;
  private readonly cleanupTimer?: ReturnType<typeof setInterval>;

  constructor(
    maxPerSecond: number = 0,
    options: { idleTtlMs?: number; cleanupIntervalMs?: number; now?: () => number } = {},
  ) {
    this.maxPerSecond = maxPerSecond;
    this.idleTtlMs = options.idleTtlMs ?? 300_000;
    this.now = options.now ?? Date.now;

    const cleanupIntervalMs = options.cleanupIntervalMs ?? 60_000;
    if (this.maxPerSecond > 0 && cleanupIntervalMs > 0 && this.idleTtlMs > 0) {
      this.cleanupTimer = setInterval(() => this.cleanup(), cleanupIntervalMs);
      this.cleanupTimer.unref?.();
    }
  }

  /** 检查是否允许请求，返回 true 表示允许 */
  allow(key: string): boolean {
    if (this.maxPerSecond <= 0) return true;

    const now = this.now();
    let bucket = this.buckets.get(key);
    if (!bucket) {
      bucket = { tokens: this.maxPerSecond, lastRefill: now, lastUsed: now };
      this.buckets.set(key, bucket);
    }

    // 补充令牌
    const elapsed = now - bucket.lastRefill;
    const refill = (elapsed / 1000) * this.maxPerSecond;
    bucket.tokens = Math.min(this.maxPerSecond, bucket.tokens + refill);
    bucket.lastRefill = now;
    bucket.lastUsed = now;

    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      return true;
    }
    return false;
  }

  cleanup(): number {
    if (this.idleTtlMs <= 0) return 0;
    const cutoff = this.now() - this.idleTtlMs;
    let removed = 0;
    for (const [key, bucket] of this.buckets) {
      if (bucket.lastUsed < cutoff) {
        this.buckets.delete(key);
        removed++;
      }
    }
    return removed;
  }

  dispose(): void {
    if (this.cleanupTimer) clearInterval(this.cleanupTimer);
  }

  get size(): number {
    return this.buckets.size;
  }
}

/** 从环境变量创建全局速率限制器 */
export function createRateLimiterFromEnv(): RateLimiter {
  const maxPerSecond = parseInt(process.env.DB_RATE_LIMIT_PER_SECOND || '0', 10);
  return new RateLimiter(maxPerSecond);
}
