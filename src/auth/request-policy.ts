import { AsyncLocalStorage } from 'node:async_hooks';
import type { PolicyConditions } from './rbac.js';

export interface RequestPolicyContext {
  conditions?: PolicyConditions;
}

const requestPolicyStorage = new AsyncLocalStorage<RequestPolicyContext>();

export function getRequestPolicyConditions(): PolicyConditions | undefined {
  return requestPolicyStorage.getStore()?.conditions;
}

export function runWithRequestPolicy<T>(conditions: PolicyConditions | undefined, fn: () => T): T {
  return requestPolicyStorage.run({ conditions }, fn);
}
