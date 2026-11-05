import { Injectable } from '@nestjs/common';
import type { ActorContext } from '@nfc/db';
import type { IntercompanyTransactionView } from '@nfc/shared';
import { assertCan, can } from '../auth/can';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  StaleRecordError,
  ValidationFailedError,
} from '../common/errors/domain-error';
import type { TxScope } from '../database/unit-of-work';
import { UnitOfWork } from '../database/unit-of-work';
import type { CreateIntercompanyInput } from './finance.dto';
import { LedgerPostingService } from './ledger-posting.service';

@Injectable()
export class IntercompanyService {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly ledger: LedgerPostingService,
  ) {}

  async list(actor: ActorContext): Promise<IntercompanyTransactionView[]> {
    if (!can(actor, 'finance.view') && !can(actor, 'finance.intercompany.create') && !can(actor, 'finance.intercompany.acknowledge')) {
      throw new ForbiddenError('You cannot view inter-company transactions.');
    }
    return this.unitOfWork.read(actor, async (tx) => {
      const ids = await tx.client.query<{ id: string }>(
        `SELECT id FROM intercompany_transactions ORDER BY created_at DESC`,
      );
      return Promise.all(ids.rows.map((row) => this.getInTx(tx, row.id)));
    });
  }

  async mismatches(actor: ActorContext): Promise<IntercompanyTransactionView[]> {
    const rows = await this.list(actor);
    return rows.filter((row) => row.mismatched);
  }

  async get(actor: ActorContext, id: string): Promise<IntercompanyTransactionView> {
    if (!can(actor, 'finance.view') && !can(actor, 'finance.intercompany.create') && !can(actor, 'finance.intercompany.acknowledge')) {
      throw new ForbiddenError('You cannot view inter-company transactions.');
    }
    return this.unitOfWork.read(actor, async (tx) => this.getInTx(tx, id));
  }

  async create(actor: ActorContext, input: CreateIntercompanyInput): Promise<IntercompanyTransactionView> {
    assertCan(actor, 'finance.intercompany.create', input.sourceEntityId);
    if (input.sourceEntityId === input.destinationEntityId) {
      throw new ValidationFailedError('Inter-company transactions must link two different entities.');
    }
    return this.unitOfWork.write(actor, async (tx) => this.createInTx(tx, actor, {
      ...input,
      fundingTransferId: null,
      referenceKind: input.type === 'funding_allocation' ? 'TRF' : 'ICT',
    }));
  }

  async createInTx(
    tx: TxScope,
    actor: ActorContext,
    input: CreateIntercompanyInput & { fundingTransferId?: string | null; referenceKind?: 'TRF' | 'ICT'; existingReference?: string },
  ): Promise<IntercompanyTransactionView> {
    const sourceBank = await this.loadBank(tx, input.sourceBankAccountId, input.sourceEntityId);
    const destBank = await this.loadBank(tx, input.destBankAccountId, input.destinationEntityId);
    const reference = input.existingReference
      ?? (await tx.client.query<{ ref: string }>(
        `SELECT app.next_reference($1) AS ref`,
        [input.referenceKind ?? (input.type === 'funding_allocation' ? 'TRF' : 'ICT')],
      )).rows[0]?.ref;
    if (!reference) throw new Error('The inter-company reference was not allocated.');
    const inserted = await tx.client.query<{ id: string }>(
      `INSERT INTO intercompany_transactions (
         reference_number, type, source_entity_id, destination_entity_id, amount_kobo, occurred_on,
         narration, funding_transfer_id, source_bank_account_id, dest_bank_account_id, created_by, updated_by
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $11)
       RETURNING id`,
      [
        reference,
        input.type,
        input.sourceEntityId,
        input.destinationEntityId,
        input.amountKobo,
        input.occurredOn,
        input.narration.trim(),
        input.fundingTransferId ?? null,
        input.sourceBankAccountId,
        input.destBankAccountId,
        actor.ref,
      ],
    );
    const id = inserted.rows[0]?.id;
    if (!id) throw new Error('The inter-company transaction was not created.');
    const sourceRecv = await this.ledger.accountIdByCode(tx, input.sourceEntityId, '1210');
    const destPay = await this.ledger.accountIdByCode(tx, input.destinationEntityId, '2120');
    const sourceJournal = await this.ledger.postTwoSided(tx, actor, {
      entityId: input.sourceEntityId,
      occurredOn: input.occurredOn,
      narration: `${reference} to destination`,
      idempotencyKey: `ict-src:${id}`,
      source: input.type === 'funding_allocation' ? 'FUNDING_TRANSFER' : 'INTERCOMPANY',
      debitAccountId: sourceRecv,
      creditAccountId: sourceBank.gl_account_id,
      amountKobo: input.amountKobo,
      intercompanyTransactionId: id,
    });
    const destJournal = await this.ledger.postTwoSided(tx, actor, {
      entityId: input.destinationEntityId,
      occurredOn: input.occurredOn,
      narration: `${reference} from source`,
      idempotencyKey: `ict-dst:${id}`,
      source: input.type === 'funding_allocation' ? 'FUNDING_TRANSFER' : 'INTERCOMPANY',
      debitAccountId: destBank.gl_account_id,
      creditAccountId: destPay,
      amountKobo: input.amountKobo,
      intercompanyTransactionId: id,
    });
    await tx.client.query(
      `UPDATE intercompany_transactions
          SET source_journal_id = $1, destination_journal_id = $2, updated_by = $3
        WHERE id = $4`,
      [sourceJournal.id, destJournal.id, actor.ref, id],
    );
    await this.ledger.insertBankTransaction(tx, actor, {
      accountId: input.sourceBankAccountId,
      entityId: input.sourceEntityId,
      kind: 'FUNDING_OUT',
      amountKobo: -input.amountKobo,
      occurredOn: input.occurredOn,
      narration: reference,
      journalId: sourceJournal.id,
    });
    await this.ledger.insertBankTransaction(tx, actor, {
      accountId: input.destBankAccountId,
      entityId: input.destinationEntityId,
      kind: 'FUNDING_IN',
      amountKobo: input.amountKobo,
      occurredOn: input.occurredOn,
      narration: reference,
      journalId: destJournal.id,
    });
    await this.ledger.applyBankDelta(tx, actor, input.sourceBankAccountId, -input.amountKobo, input.occurredOn);
    await this.ledger.applyBankDelta(tx, actor, input.destBankAccountId, input.amountKobo, input.occurredOn);
    await tx.indexSearch({
      recordType: 'INTERCOMPANY',
      recordId: id,
      referenceNumber: reference,
      title: input.narration,
      searchableText: `${reference} ${input.narration}`,
      entityId: input.sourceEntityId,
      permissionKey: 'finance.view',
    });
    await tx.publish({
      eventType: 'intercompany.recorded',
      subjectType: 'INTERCOMPANY',
      subjectId: id,
      entityId: input.destinationEntityId,
      payload: {
        type: 'intercompany.recorded',
        reference,
        title: input.narration,
        href: `/finance/intercompany/${id}`,
      },
    });
    await tx.audit({
      action: 'transfer',
      subjectType: 'intercompany',
      subjectId: id,
      subjectReferenceNumber: reference,
      entityId: input.sourceEntityId,
      newValue: { amountKobo: input.amountKobo, destinationEntityId: input.destinationEntityId },
    });
    return this.getInTx(tx, id);
  }

  async acknowledge(actor: ActorContext, id: string, rowVersion: number, reason?: string): Promise<IntercompanyTransactionView> {
    return this.unitOfWork.write(actor, async (tx) => {
      const current = await tx.client.query<{
        destination_entity_id: string;
        acknowledged_at: Date | null;
        row_version: number;
        reference_number: string;
        narration: string;
      }>(
        `SELECT destination_entity_id, acknowledged_at, row_version, reference_number, narration
           FROM intercompany_transactions WHERE id = $1 FOR UPDATE`,
        [id],
      );
      const row = current.rows[0];
      if (!row) throw new NotFoundError('That inter-company transaction does not exist.');
      assertCan(actor, 'finance.intercompany.acknowledge', row.destination_entity_id);
      if (row.acknowledged_at) throw new ConflictError('This transfer has already been acknowledged.');
      if (row.row_version !== rowVersion) {
        throw new StaleRecordError('This transfer has changed. Refresh and try again.');
      }
      await tx.client.query(
        `UPDATE intercompany_transactions
            SET acknowledged_at = now(), acknowledged_by = $1, updated_by = $1
          WHERE id = $2`,
        [actor.ref, id],
      );
      await tx.publish({
        eventType: 'intercompany.acknowledged',
        subjectType: 'INTERCOMPANY',
        subjectId: id,
        entityId: row.destination_entity_id,
        payload: {
          type: 'intercompany.acknowledged',
          reference: row.reference_number,
          title: row.narration,
          href: `/finance/intercompany/${id}`,
        },
      });
      await tx.audit({
        action: 'approve',
        subjectType: 'intercompany',
        subjectId: id,
        subjectReferenceNumber: row.reference_number,
        entityId: row.destination_entity_id,
        reason: reason?.trim() || undefined,
        newValue: { acknowledged: true },
      });
      return this.getInTx(tx, id);
    });
  }

  async getInTx(tx: TxScope, id: string): Promise<IntercompanyTransactionView> {
    const result = await tx.client.query<{
      id: string;
      reference_number: string;
      type: IntercompanyTransactionView['type'];
      source_entity_id: string;
      source_entity_code: string | null;
      destination_entity_id: string;
      destination_entity_code: string | null;
      amount_kobo: string;
      occurred_on: Date;
      narration: string;
      funding_transfer_id: string | null;
      source_journal_id: string | null;
      destination_journal_id: string | null;
      acknowledged_at: Date | null;
      acknowledged_by_name: string | null;
      row_version: number;
      source_status: string | null;
      dest_status: string | null;
    }>(
      `SELECT t.id, t.reference_number, t.type, t.source_entity_id, s.code AS source_entity_code,
              t.destination_entity_id, d.code AS destination_entity_code, t.amount_kobo::text,
              t.occurred_on, t.narration, t.funding_transfer_id, t.source_journal_id, t.destination_journal_id,
              t.acknowledged_at, t.row_version,
              app.user_public_name(
                CASE WHEN t.acknowledged_by ~ '^[0-9a-f-]{36}$' THEN t.acknowledged_by::uuid ELSE NULL END
              ) AS acknowledged_by_name,
              sj.status AS source_status, dj.status AS dest_status
         FROM intercompany_transactions t
         JOIN entities s ON s.id = t.source_entity_id
         JOIN entities d ON d.id = t.destination_entity_id
         LEFT JOIN journals sj ON sj.id = t.source_journal_id
         LEFT JOIN journals dj ON dj.id = t.destination_journal_id
        WHERE t.id = $1`,
      [id],
    );
    const row = result.rows[0];
    if (!row) throw new NotFoundError('That inter-company transaction does not exist.');
    return {
      id: row.id,
      referenceNumber: row.reference_number,
      type: row.type,
      sourceEntityId: row.source_entity_id,
      sourceEntityCode: row.source_entity_code,
      destinationEntityId: row.destination_entity_id,
      destinationEntityCode: row.destination_entity_code,
      amountKobo: Number(row.amount_kobo),
      occurredOn: row.occurred_on.toISOString().slice(0, 10),
      narration: row.narration,
      fundingTransferId: row.funding_transfer_id,
      sourceJournalId: row.source_journal_id,
      destinationJournalId: row.destination_journal_id,
      acknowledgedAt: row.acknowledged_at?.toISOString() ?? null,
      acknowledgedByName: row.acknowledged_by_name,
      mismatched: row.source_status !== 'POSTED' || row.dest_status !== 'POSTED',
      rowVersion: row.row_version,
    };
  }

  private async loadBank(tx: TxScope, id: string, entityId: string) {
    const result = await tx.client.query<{ gl_account_id: string | null; entity_id: string }>(
      `SELECT gl_account_id, entity_id FROM entity_bank_accounts WHERE id = $1 AND status = 'ACTIVE'`,
      [id],
    );
    const row = result.rows[0];
    if (!row || row.entity_id !== entityId || !row.gl_account_id) {
      throw new ValidationFailedError('Both bank accounts must be active and mapped to the ledger.');
    }
    return { gl_account_id: row.gl_account_id };
  }
}
