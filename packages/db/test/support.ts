import type { Pool, PoolClient } from 'pg';
import { createPool } from '../src/client';
import { appConnection, ownerConnection } from '../src/env';
import type { ActorContext } from '../src/session';
import { applyActorSession } from '../src/session';

/**
 * Two pools, because the distinction matters to what these tests prove.
 *
 * `owner` is the migrating superuser: it bypasses Row-Level Security, so it is
 * used to set up fixtures and to read what the application role cannot see.
 * `app` is `nfc_app`, the role the API actually connects as, which holds no
 * BYPASSRLS and no DELETE privilege. Anything asserted through `app` is a
 * statement about what the running system can and cannot do.
 */
export function ownerPool(name = 'nfc-erp-test-owner'): Pool {
  return createPool({ ...ownerConnection('test'), applicationName: name, max: 4 });
}

export function appPool(name = 'nfc-erp-test-app'): Pool {
  return createPool({ ...appConnection('test'), applicationName: name, max: 4 });
}

export interface ActorOverrides {
  ref?: string;
  name?: string;
  role?: ActorContext['role'];
  scopeType?: ActorContext['scopeType'];
  entityIds?: string[];
  isCorporate?: boolean;
  requestId?: string;
  ipAddress?: string;
  userAgent?: string;
  sessionId?: string;
}

/** A synthetic user actor. M2 replaces these with real users. */
export function userActor(overrides: ActorOverrides = {}): ActorContext {
  return {
    ref: overrides.ref ?? '00000000-0000-4000-8000-000000000001',
    name: overrides.name ?? 'Test Actor',
    role: overrides.role ?? 'md',
    scopeType: overrides.scopeType ?? 'CORPORATE',
    entityIds: overrides.entityIds ?? [],
    isCorporate: overrides.isCorporate ?? true,
    requestId: overrides.requestId,
    ipAddress: overrides.ipAddress,
    userAgent: overrides.userAgent,
    sessionId: overrides.sessionId,
  };
}

export function systemActor(ref = 'system:seed'): ActorContext {
  return {
    ref,
    name: 'Seed process',
    role: null,
    scopeType: null,
    entityIds: [],
    isCorporate: true,
  };
}

/**
 * Runs a function inside one transaction with the actor's session variables set,
 * exactly as the API's unit of work does, then rolls back so the test leaves
 * nothing behind.
 */
export async function inRolledBackTransaction<T>(
  pool: Pool,
  actor: ActorContext,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await applyActorSession(client, actor);
    return await fn(client);
  } finally {
    await client.query('ROLLBACK').catch(() => undefined);
    client.release();
  }
}

/** Runs a function in a committed transaction. Used where a test needs durable rows. */
export async function inCommittedTransaction<T>(
  pool: Pool,
  actor: ActorContext,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await applyActorSession(client, actor);
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function entityIdFor(pool: Pool, code: string): Promise<string> {
  const result = await pool.query<{ id: string }>('SELECT id FROM entities WHERE code = $1', [code]);
  const id = result.rows[0]?.id;
  if (!id) throw new Error(`The test database has no entity with code ${code}.`);
  return id;
}

/** Captures the error PostgreSQL raised, so tests can assert on the code and message. */
export interface CapturedError {
  message: string;
  code: string | undefined;
  hint: string | undefined;
}

export async function captureError(fn: () => Promise<unknown>): Promise<CapturedError> {
  try {
    await fn();
  } catch (error) {
    const pgError = error as { message?: string; code?: string; hint?: string };
    return {
      message: pgError.message ?? String(error),
      code: pgError.code,
      hint: pgError.hint,
    };
  }
  throw new Error('Expected the statement to be refused, but it succeeded.');
}
