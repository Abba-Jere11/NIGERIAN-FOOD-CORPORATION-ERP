import type { PoolClient } from 'pg';
import { type ActorContext } from './session';

export interface DueReminder {
  holdId: string;
  referenceNumber: string;
  title: string;
  holderUserId: string;
  entityId: string;
  days: number;
}

/**
 * Writes one `workflow_reminders` row per crossed SLA threshold. Unique on
 * (hold, days) so a second pass with the same `now` is a no-op.
 */
export async function insertDueSlaReminders(
  client: PoolClient,
  actor: ActorContext,
  now: Date,
): Promise<DueReminder[]> {
  const thresholds = await client.query<{ days: number }>(
    'SELECT days FROM sla_thresholds ORDER BY days',
  );
  const holds = await client.query<{
    id: string;
    reference_number: string;
    title: string;
    holder_user_id: string;
    entity_id: string;
    pending_since: Date;
  }>(
    `SELECT id, reference_number, title, holder_user_id, entity_id, pending_since
       FROM workflow_holds
      WHERE status = 'open'`,
  );

  const due: DueReminder[] = [];
  for (const hold of holds.rows) {
    const daysPending = Math.floor((now.getTime() - hold.pending_since.getTime()) / 86_400_000);
    for (const { days } of thresholds.rows) {
      if (daysPending < days) continue;
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO workflow_reminders (hold_id, threshold_days, created_by)
         VALUES ($1, $2, $3)
         ON CONFLICT (hold_id, threshold_days) DO NOTHING
         RETURNING id`,
        [hold.id, days, actor.ref],
      );
      if (!inserted.rows[0]) continue;
      due.push({
        holdId: hold.id,
        referenceNumber: hold.reference_number,
        title: hold.title,
        holderUserId: hold.holder_user_id,
        entityId: hold.entity_id,
        days,
      });
    }
  }
  return due;
}
