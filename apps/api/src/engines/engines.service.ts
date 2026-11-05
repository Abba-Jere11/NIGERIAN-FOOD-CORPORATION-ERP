import { Injectable } from '@nestjs/common';
import type { ActorContext } from '@nfc/db';
import { isReferenceKind, type ReferenceKind } from '@nfc/shared';
import { ValidationFailedError, ForbiddenError } from '../common/errors/domain-error';
import { UnitOfWork } from '../database/unit-of-work';
import { JobsService } from './jobs.service';
import { NotificationsService } from './notifications.service';

@Injectable()
export class EnginesService {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly jobs: JobsService,
    private readonly notifications: NotificationsService,
  ) {}

  async createRecord(
    actor: ActorContext,
    input: { title: string; kind?: string; entityId?: string },
  ) {
    const kind = (input.kind ?? 'PR').toUpperCase();
    if (!isReferenceKind(kind)) {
      throw new ValidationFailedError(`Unknown reference kind "${kind}".`);
    }
    const entityId = input.entityId ?? actor.entityIds[0];
    if (!entityId) {
      throw new ValidationFailedError('An entity is required to allocate a reference number.');
    }
    const title = input.title.trim();
    if (title === '') throw new ValidationFailedError('A title is required.');

    const record = await this.unitOfWork.write(actor, async (tx) => {
      const allocated = await tx.client.query<{ ref: string }>(
        'SELECT app.next_reference($1, NULL) AS ref',
        [kind],
      );
      const reference = allocated.rows[0]?.ref;
      if (!reference) throw new Error('The reference number was not allocated.');

      const inserted = await tx.client.query<{
        id: string;
        entity_id: string;
        kind: string;
        reference_number: string;
        title: string;
        status: string;
        row_version: number;
        created_at: Date;
      }>(
        `INSERT INTO engine_records (entity_id, kind, reference_number, title, created_by, updated_by)
         VALUES ($1, $2, $3, $4, $5, $5)
         RETURNING id, entity_id, kind, reference_number, title, status, row_version, created_at`,
        [entityId, kind, reference, title, actor.ref],
      );
      const row = inserted.rows[0];
      if (!row) throw new Error('The numbered record was not created.');

      await tx.audit({
        action: 'create',
        subjectType: 'engine_record',
        subjectId: row.id,
        subjectLabel: title,
        subjectReferenceNumber: reference,
        entityId,
        newValue: { kind, referenceNumber: reference, title },
      });
      await tx.publish({
        eventType: 'engine.record.created',
        subjectType: 'engine_record',
        subjectId: row.id,
        entityId,
        payload: {
          type: 'engine.created',
          reference,
          title,
          recipientUserId: actor.ref,
          href: `/engine/${row.id}`,
        },
      });
      await this.notifications.createFromEvent(tx.client, actor, {
        deliveryId: row.id,
        eventId: row.id,
        handlerKey: 'notify.generic',
        eventType: 'engine.record.created',
        subjectType: 'engine_record',
        subjectId: row.id,
        entityId,
        payload: {
          type: 'engine.created',
          reference,
          title,
          recipientUserId: actor.ref,
          href: `/engine/${row.id}`,
        },
        attempts: 0,
      });
      await tx.indexSearch({
        recordType: 'ENGINE',
        recordId: row.id,
        referenceNumber: reference,
        title,
        searchableText: `${title} ${reference}`,
        entityId,
        permissionKey: 'organization.view',
      });
      await tx.appendTimeline({
        subjectType: 'ENGINE',
        subjectId: row.id,
        text: `Created ${reference}.`,
        href: `/engine/${row.id}`,
        entityId,
      });

      return row;
    });

    try {
      await this.jobs.dispatchOutbox();
    } catch {
      // The numbered record is committed. The poller retries pending deliveries.
    }
    return toRecordView(record);
  }

  async getRecord(actor: ActorContext, id: string) {
    return this.unitOfWork.read(actor, async (tx) => {
      const result = await tx.client.query<{
        id: string;
        entity_id: string;
        kind: string;
        reference_number: string;
        title: string;
        status: string;
        row_version: number;
        created_at: Date;
      }>(
        `SELECT id, entity_id, kind, reference_number, title, status, row_version, created_at
           FROM engine_records WHERE id = $1`,
        [id],
      );
      const row = result.rows[0];
      if (!row) throw new ForbiddenError('That record is not available.');
      return toRecordView(row);
    });
  }

  async listCounters(actor: ActorContext) {
    return this.unitOfWork.read(actor, async (tx) => {
      const result = await tx.client.query<{
        kind: string;
        year: number;
        last_value: number;
        updated_at: Date;
      }>(`SELECT kind, year, last_value, updated_at FROM reference_counters ORDER BY kind, year`);
      return result.rows.map((row) => ({
        kind: row.kind,
        year: row.year,
        lastValue: row.last_value,
        updatedAt: row.updated_at.toISOString(),
      }));
    });
  }
}

function toRecordView(row: {
  id: string;
  entity_id: string;
  kind: string;
  reference_number: string;
  title: string;
  status: string;
  row_version: number;
  created_at: Date;
}) {
  return {
    id: row.id,
    entityId: row.entity_id,
    kind: row.kind as ReferenceKind,
    referenceNumber: row.reference_number,
    title: row.title,
    status: row.status,
    rowVersion: row.row_version,
    createdAt: row.created_at.toISOString(),
  };
}
