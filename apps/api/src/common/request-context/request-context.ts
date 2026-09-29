import { AsyncLocalStorage } from 'node:async_hooks';
import type { ActorContext } from '@nfc/db';
import type { Logger } from 'pino';

/**
 * Per-request provenance, carried implicitly so that services do not have to
 * thread it through every signature. The audit engine reads from here, which is
 * why an audit entry always knows the IP, device, session and request id behind
 * a change (M1 item 5).
 */
export interface RequestContext {
  requestId: string;
  ipAddress: string | null;
  userAgent: string | null;
  /** Populated in M2, when real sessions exist. */
  sessionId: string | null;
  method: string;
  path: string;
  startedAt: number;
  logger: Logger;
  actor: ActorContext | null;
}

const storage = new AsyncLocalStorage<RequestContext>();

export function runWithRequestContext<T>(context: RequestContext, fn: () => T): T {
  return storage.run(context, fn);
}

export function getRequestContext(): RequestContext | undefined {
  return storage.getStore();
}

export function requireRequestContext(): RequestContext {
  const context = storage.getStore();
  if (!context) {
    throw new Error('No request context is active. This code must run inside a request.');
  }
  return context;
}

export function setContextActor(actor: ActorContext): void {
  const context = storage.getStore();
  if (context) context.actor = actor;
}
