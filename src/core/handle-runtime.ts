import type { RuntimeHandle } from './types.js';

export function pingRuntime(h: RuntimeHandle): Promise<{ ok: boolean; error?: string }> {
  return h.driver.ping();
}

export async function closeRuntime(h: RuntimeHandle): Promise<void> {
  await h.driver.close();
}
