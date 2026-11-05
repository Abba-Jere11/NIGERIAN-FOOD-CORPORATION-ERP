import { Injectable } from '@nestjs/common';
import type { ActorContext } from '@nfc/db';
import { listTimelineEvents } from '@nfc/db';
import { UnitOfWork } from '../database/unit-of-work';

@Injectable()
export class TimelineService {
  constructor(private readonly unitOfWork: UnitOfWork) {}

  async list(actor: ActorContext, subjectType: string, subjectId: string) {
    return this.unitOfWork.read(actor, async (tx) => {
      const rows = await listTimelineEvents(tx.client, subjectType, subjectId);
      return rows.map((row) => ({
        id: row.id,
        occurredAt: row.occurredAt.toISOString(),
        actor: row.actorName,
        text: row.text,
        href: row.href,
      }));
    });
  }
}
