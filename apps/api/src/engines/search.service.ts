import { Injectable } from '@nestjs/common';
import type { ActorContext } from '@nfc/db';
import { searchIndex } from '@nfc/db';
import { UnitOfWork } from '../database/unit-of-work';

@Injectable()
export class SearchService {
  constructor(private readonly unitOfWork: UnitOfWork) {}

  async search(actor: ActorContext, query: string) {
    return this.unitOfWork.read(actor, async (tx) => {
      const hits = await searchIndex(tx.client, query);
      const groups = new Map<string, typeof hits>();
      for (const hit of hits) {
        const list = groups.get(hit.recordType) ?? [];
        list.push(hit);
        groups.set(hit.recordType, list);
      }
      return {
        query,
        groups: [...groups.entries()].map(([type, groupHits]) => ({
          type,
          hits: groupHits,
        })),
      };
    });
  }
}
