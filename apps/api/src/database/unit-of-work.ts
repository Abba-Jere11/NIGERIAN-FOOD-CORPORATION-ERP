import { Inject, Injectable } from '@nestjs/common';
import {
  type ActorContext,
  applyActorSession,
  type AuditEntryInput,
  type AuditEntryWritten,
  createDatabaseFromClient,
  type Database,
  type DomainEventInput,
  type DomainEventWritten,
  insertAuditEntry,
  insertDomainEvent,
  insertTimelineEvent,
  type SearchIndexInput,
  type TimelineEventInput,
  type TimelineEventRow,
  upsertSearchIndex,
} from '@nfc/db';
import type { Pool, PoolClient } from 'pg';
import { APP_POOL } from './tokens';

/**
 * One unit of work: one database transaction, one actor, one audit trail.
 *
 * This is the load-bearing piece of the audit engine. `write()` opens a
 * transaction, publishes the actor into the PostgreSQL session variables that
 * Row-Level Security reads (rule R5), and hands the caller an `audit()`
 * function bound to that same transaction. The consequence is structural rather
 * than procedural: a committed change cannot be missing its audit entry, and a
 * rolled-back change cannot leave a misleading one behind (rule R1).
 */
export interface TxScope {
  /** Raw client, for SQL that Drizzle cannot express. */
  client: PoolClient;
  /** Drizzle bound to this transaction. */
  db: Database;
  actor: ActorContext;
  /** Writes an audit entry inside this transaction. */
  audit: (entry: AuditEntryInput) => Promise<AuditEntryWritten>;
  publish: (event: DomainEventInput) => Promise<DomainEventWritten>;
  indexSearch: (input: SearchIndexInput) => Promise<void>;
  appendTimeline: (event: TimelineEventInput) => Promise<TimelineEventRow>;
}

@Injectable()
export class UnitOfWork {
  constructor(@Inject(APP_POOL) private readonly pool: Pool) {}

  /** Read-write transaction. Rolls back on any thrown error. */
  async write<T>(actor: ActorContext, fn: (tx: TxScope) => Promise<T>): Promise<T> {
    return this.run(actor, 'BEGIN', fn);
  }

  /**
   * Read-only transaction. Still opens one, because the session variables that
   * drive Row-Level Security are transaction-scoped: without a transaction
   * there is no scope, and a fail-closed policy returns nothing.
   */
  async read<T>(actor: ActorContext, fn: (tx: TxScope) => Promise<T>): Promise<T> {
    return this.run(actor, 'BEGIN READ ONLY', fn);
  }

  private async run<T>(
    actor: ActorContext,
    begin: string,
    fn: (tx: TxScope) => Promise<T>,
  ): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query(begin);
      await applyActorSession(client, actor);

      const scope: TxScope = {
        client,
        db: createDatabaseFromClient(client),
        actor,
        audit: (entry) => insertAuditEntry(client, actor, entry),
        publish: (event) => insertDomainEvent(client, actor, event),
        indexSearch: (input) => upsertSearchIndex(client, input),
        appendTimeline: (event) => insertTimelineEvent(client, actor, event),
      };

      const result = await fn(scope);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
