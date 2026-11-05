import { Injectable } from '@nestjs/common';
import type { ActorContext } from '@nfc/db';
import { UnitOfWork } from '../database/unit-of-work';

@Injectable()
export class OverdueService {
  constructor(private readonly unitOfWork: UnitOfWork) {}

  async list(actor: ActorContext, now: Date = new Date()) {
    return this.unitOfWork.read(actor, async (tx) => {
      const result = await tx.client.query<{
        id: string;
        subject_type: string;
        subject_id: string;
        reference_number: string;
        title: string;
        holder_user_id: string;
        holder_name: string;
        entity_id: string;
        entity_code: string;
        entity_name: string;
        pending_since: Date;
      }>(
        `SELECT h.id, h.subject_type, h.subject_id, h.reference_number, h.title,
                h.holder_user_id, app.user_public_name(h.holder_user_id) AS holder_name,
                h.entity_id, e.code AS entity_code, e.name AS entity_name,
                h.pending_since
           FROM workflow_holds h
           JOIN entities e ON e.id = h.entity_id
          WHERE h.status = 'open'
            AND h.pending_since <= $1::timestamptz
              - make_interval(days => (SELECT coalesce(min(days), 2) FROM sla_thresholds))
          ORDER BY h.pending_since ASC`,
        [now.toISOString()],
      );
      return result.rows.map((row) => {
        const daysPending = Math.floor(
          (now.getTime() - row.pending_since.getTime()) / 86_400_000,
        );
        return {
          id: row.id,
          subjectType: row.subject_type,
          subjectId: row.subject_id,
          referenceNumber: row.reference_number,
          title: row.title,
          holderName: row.holder_name,
          holderUserId: row.holder_user_id,
          daysPending,
          entityId: row.entity_id,
          entityCode: row.entity_code,
          entityName: row.entity_name,
          pendingSince: row.pending_since.toISOString(),
        };
      });
    });
  }
}
