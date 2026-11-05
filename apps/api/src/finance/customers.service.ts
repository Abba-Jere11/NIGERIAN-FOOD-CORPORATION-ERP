import { Injectable } from '@nestjs/common';
import type { ActorContext } from '@nfc/db';
import type { CustomerView } from '@nfc/shared';
import { assertCan, can } from '../auth/can';
import { ForbiddenError, NotFoundError, StaleRecordError } from '../common/errors/domain-error';
import type { TxScope } from '../database/unit-of-work';
import { UnitOfWork } from '../database/unit-of-work';
import type { UpsertCustomerInput } from './finance.dto';

@Injectable()
export class CustomersService {
  constructor(private readonly unitOfWork: UnitOfWork) {}

  async list(actor: ActorContext, entityId?: string): Promise<CustomerView[]> {
    if (!can(actor, 'finance.view') && !can(actor, 'finance.customer.manage') && !can(actor, 'finance.receivables.manage')) {
      throw new ForbiddenError('You cannot view customers.');
    }
    return this.unitOfWork.read(actor, async (tx) => {
      const ids = await tx.client.query<{ id: string }>(
        `SELECT id FROM customers WHERE ($1::uuid IS NULL OR entity_id = $1) ORDER BY name`,
        [entityId ?? null],
      );
      const views: CustomerView[] = [];
      for (const row of ids.rows) views.push(await this.getInTx(tx, row.id));
      return views;
    });
  }

  async get(actor: ActorContext, id: string): Promise<CustomerView> {
    if (!can(actor, 'finance.view') && !can(actor, 'finance.customer.manage') && !can(actor, 'finance.receivables.manage')) {
      throw new ForbiddenError('You cannot view customers.');
    }
    return this.unitOfWork.read(actor, async (tx) => this.getInTx(tx, id));
  }

  async upsert(actor: ActorContext, input: UpsertCustomerInput, id?: string): Promise<CustomerView> {
    assertCan(actor, 'finance.customer.manage', input.entityId);
    return this.unitOfWork.write(actor, async (tx) => {
      if (id) {
        const current = await tx.client.query<{ row_version: number; entity_id: string }>(
          `SELECT row_version, entity_id FROM customers WHERE id = $1 FOR UPDATE`,
          [id],
        );
        const row = current.rows[0];
        if (!row) throw new NotFoundError('That customer does not exist.');
        if (input.rowVersion && row.row_version !== input.rowVersion) {
          throw new StaleRecordError('This customer has changed. Refresh and try again.');
        }
        await tx.client.query(
          `UPDATE customers
              SET name = $2, terms_days = coalesce($3, terms_days),
                  credit_limit_kobo = coalesce($4, credit_limit_kobo),
                  contacts = coalesce($5::jsonb, contacts),
                  status = coalesce($6, status), updated_by = $7
            WHERE id = $1`,
          [
            id,
            input.name.trim(),
            input.termsDays ?? null,
            input.creditLimitKobo ?? null,
            input.contacts ? JSON.stringify(input.contacts) : null,
            input.status ?? null,
            actor.ref,
          ],
        );
        await this.index(tx, id);
        await tx.audit({
          action: 'edit',
          subjectType: 'customer',
          subjectId: id,
          subjectLabel: input.name,
          entityId: row.entity_id,
          newValue: { name: input.name },
        });
        return this.getInTx(tx, id);
      }
      const ref = await tx.client.query<{ ref: string }>(`SELECT app.next_reference('CUS') AS ref`);
      const inserted = await tx.client.query<{ id: string }>(
        `INSERT INTO customers (
           reference_number, entity_id, name, contacts, terms_days, credit_limit_kobo, created_by, updated_by
         ) VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, $7)
         RETURNING id`,
        [
          ref.rows[0]?.ref,
          input.entityId,
          input.name.trim(),
          JSON.stringify(input.contacts ?? []),
          input.termsDays ?? 30,
          input.creditLimitKobo ?? 0,
          actor.ref,
        ],
      );
      const createdId = inserted.rows[0]?.id;
      if (!createdId) throw new Error('The customer was not created.');
      await this.index(tx, createdId);
      await tx.audit({
        action: 'create',
        subjectType: 'customer',
        subjectId: createdId,
        subjectLabel: input.name,
        subjectReferenceNumber: ref.rows[0]?.ref,
        entityId: input.entityId,
        newValue: { status: 'ACTIVE' },
      });
      return this.getInTx(tx, createdId);
    });
  }

  async getInTx(tx: TxScope, id: string): Promise<CustomerView> {
    const result = await tx.client.query<{
      id: string;
      reference_number: string;
      entity_id: string;
      entity_code: string | null;
      name: string;
      contacts: unknown;
      terms_days: number;
      credit_limit_kobo: string;
      status: CustomerView['status'];
      outstanding_kobo: string;
      row_version: number;
    }>(
      `SELECT c.id, c.reference_number, c.entity_id, e.code AS entity_code, c.name, c.contacts,
              c.terms_days, c.credit_limit_kobo::text, c.status, c.row_version,
              coalesce((
                SELECT sum(i.amount_kobo - i.allocated_kobo) FROM receivable_invoices i
                 WHERE i.customer_id = c.id AND i.status <> 'PAID'
              ), 0)::text AS outstanding_kobo
         FROM customers c
         JOIN entities e ON e.id = c.entity_id
        WHERE c.id = $1`,
      [id],
    );
    const row = result.rows[0];
    if (!row) throw new NotFoundError('That customer does not exist.');
    return {
      id: row.id,
      referenceNumber: row.reference_number,
      entityId: row.entity_id,
      entityCode: row.entity_code,
      name: row.name,
      contacts: row.contacts,
      termsDays: row.terms_days,
      creditLimitKobo: Number(row.credit_limit_kobo),
      status: row.status,
      outstandingKobo: Number(row.outstanding_kobo),
      rowVersion: row.row_version,
    };
  }

  private async index(tx: TxScope, id: string): Promise<void> {
    const view = await this.getInTx(tx, id);
    await tx.indexSearch({
      recordType: 'CUSTOMER',
      recordId: id,
      referenceNumber: view.referenceNumber,
      title: view.name,
      searchableText: `${view.referenceNumber} ${view.name}`,
      entityId: view.entityId,
      permissionKey: 'finance.view',
    });
  }
}
