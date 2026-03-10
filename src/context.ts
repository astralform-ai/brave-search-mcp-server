/**
 * Per-request context using AsyncLocalStorage.
 *
 * Allows the Brave API key to be provided via HTTP request headers
 * instead of (or in addition to) a global environment variable.
 * Each incoming request can carry its own key, enabling multi-tenant usage.
 */
import { AsyncLocalStorage } from 'node:async_hooks';

export interface RequestContext {
  braveApiKey: string;
}

export const requestContext = new AsyncLocalStorage<RequestContext>();
