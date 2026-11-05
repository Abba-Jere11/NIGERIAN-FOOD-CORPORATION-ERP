import { Injectable } from '@nestjs/common';
import type { ActorContext } from '@nfc/db';
import type { BankAccountView } from '@nfc/shared';
import { assertCan, can } from '../auth/can';
import { ForbiddenError, NotFoundError, StaleRecordError, ValidationFailedError } from '../common/errors/domain-error';
import type { TxScope } from '../database/unit-of-work';
import { UnitOfWork } from '../database/unit-of-work';

function maskAccount(value: string): string {
  const digits = value.replace(/\s+/g, '');
  if (digits.length <= 4) return '••••';
  return `${'•'.repeat(Math.max(4, digits.length - 4))}${digits.slice(-4)}`;
}

@Injectable()
export class BankAccountsService {
  constructor(private readonly unitOfWork: UnitOfWork) {}

  async list(actor: ActorContext, entityId?: string): Promise<BankAccountView[]> {
    if (
      !can(actor, 'finance.bank_account.view') &&
      !can(actor, 'finance.funding.authorize') &&
      !can(actor, 'finance.view')
    ) {
      throw new ForbiddenError('You cannot view entity bank accounts.');
    }
    return this.unitOfWork.read(actor, async (tx) => {
      const result = await tx.client.query<{
        id: string;
        entity_id: string;
        entity_code: string | null;
        entity_name: string | null;
        name: string;
        bank_name: string;
        account_name: string;
        account_number: string;
        currency: string;
        status: string;
        recorded_balance_kobo: string;
        balance_as_of: Date | string | null;
        gl_account_id: string | null;
        row_version: number;
      }>(
        `SELECT a.id, a.entity_id, e.code AS entity_code, e.name AS entity_name, a.name, a.bank_name,
                a.account_name, a.account_number, a.currency, a.status,
                a.recorded_balance_kobo::text, a.balance_as_of, a.gl_account_id, a.row_version
           FROM entity_bank_accounts a
           JOIN entities e ON e.id = a.entity_id
          WHERE a.status = 'ACTIVE'
            AND ($1::uuid IS NULL OR a.entity_id = $1)
          ORDER BY e.code, a.name`,
        [entityId ?? null],
      );
      const reveal = can(actor, 'finance.bank_account.view');
      return result.rows.map((row) => this.toView(row, reveal));
    });
  }

  async create(
    actor: ActorContext,
    input: {
      entityId: string;
      name: string;
      bankName: string;
      accountName: string;
      accountNumber: string;
      recordedBalanceKobo: number;
      balanceAsOf?: string;
    },
  ): Promise<BankAccountView> {
    assertCan(actor, 'finance.bank_account.manage', input.entityId);
    return this.unitOfWork.write(actor, async (tx) => {
      const inserted = await tx.client.query<{ id: string }>(
        `INSERT INTO entity_bank_accounts (
           entity_id, name, bank_name, account_name, account_number, recorded_balance_kobo,
           balance_as_of, balance_recorded_by, created_by, updated_by
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8, $8)
         RETURNING id`,
        [
          input.entityId,
          input.name.trim(),
          input.bankName.trim(),
          input.accountName.trim(),
          input.accountNumber.trim(),
          input.recordedBalanceKobo,
          input.balanceAsOf ?? null,
          actor.ref,
        ],
      );
      const id = inserted.rows[0]?.id;
      if (!id) throw new Error('The bank account was not created.');
      if (input.balanceAsOf) {
        await tx.client.query(
          `INSERT INTO entity_bank_balance_events (account_id, entity_id, balance_kobo, as_of, created_by)
           VALUES ($1, $2, $3, $4, $5)`,
          [id, input.entityId, input.recordedBalanceKobo, input.balanceAsOf, actor.ref],
        );
      }
      await tx.audit({
        action: 'create',
        subjectType: 'entity_bank_account',
        subjectId: id,
        subjectLabel: input.name,
        entityId: input.entityId,
        newValue: { bankName: input.bankName, balanceKobo: input.recordedBalanceKobo },
      });
      return this.getInTx(tx, actor, id);
    });
  }

  async updateBalance(
    actor: ActorContext,
    id: string,
    input: { rowVersion: number; recordedBalanceKobo: number; balanceAsOf: string },
  ): Promise<BankAccountView> {
    return this.unitOfWork.write(actor, async (tx) => {
      const current = await tx.client.query<{
        entity_id: string;
        row_version: number;
        name: string;
        recorded_balance_kobo: string;
      }>(
        `SELECT entity_id, row_version, name, recorded_balance_kobo::text
           FROM entity_bank_accounts WHERE id = $1 FOR UPDATE`,
        [id],
      );
      const row = current.rows[0];
      if (!row) throw new NotFoundError('That bank account was not found.');
      assertCan(actor, 'finance.bank_account.manage', row.entity_id);
      if (row.row_version !== input.rowVersion) {
        throw new StaleRecordError('This bank account has changed. Refresh and try again.', {
          rowVersion: row.row_version,
        });
      }
      if (input.recordedBalanceKobo < 0) {
        throw new ValidationFailedError('Recorded balance cannot be negative.');
      }
      await tx.client.query(
        `UPDATE entity_bank_accounts
            SET recorded_balance_kobo = $1, balance_as_of = $2, balance_recorded_by = $3, updated_by = $3
          WHERE id = $4`,
        [input.recordedBalanceKobo, input.balanceAsOf, actor.ref, id],
      );
      await tx.client.query(
        `INSERT INTO entity_bank_balance_events (account_id, entity_id, balance_kobo, as_of, created_by)
         VALUES ($1, $2, $3, $4, $5)`,
        [id, row.entity_id, input.recordedBalanceKobo, input.balanceAsOf, actor.ref],
      );
      await tx.audit({
        action: 'edit',
        subjectType: 'entity_bank_account',
        subjectId: id,
        subjectLabel: row.name,
        entityId: row.entity_id,
        oldValue: { balanceKobo: Number(row.recorded_balance_kobo) },
        newValue: { balanceKobo: input.recordedBalanceKobo, asOf: input.balanceAsOf },
      });
      return this.getInTx(tx, actor, id);
    });
  }

  private async getInTx(tx: TxScope, actor: ActorContext, id: string): Promise<BankAccountView> {
    const result = await tx.client.query<{
      id: string;
      entity_id: string;
      entity_code: string | null;
      entity_name: string | null;
      name: string;
      bank_name: string;
      account_name: string;
      account_number: string;
      currency: string;
      status: string;
      recorded_balance_kobo: string;
      balance_as_of: Date | string | null;
      gl_account_id: string | null;
      row_version: number;
    }>(
      `SELECT a.id, a.entity_id, e.code AS entity_code, e.name AS entity_name, a.name, a.bank_name,
              a.account_name, a.account_number, a.currency, a.status,
              a.recorded_balance_kobo::text, a.balance_as_of, a.gl_account_id, a.row_version
         FROM entity_bank_accounts a
         JOIN entities e ON e.id = a.entity_id
        WHERE a.id = $1`,
      [id],
    );
    const row = result.rows[0];
    if (!row) throw new NotFoundError('That bank account was not found.');
    return this.toView(row, can(actor, 'finance.bank_account.view', row.entity_id));
  }

  private toView(
    row: {
      id: string;
      entity_id: string;
      entity_code: string | null;
      entity_name: string | null;
      name: string;
      bank_name: string;
      account_name: string;
      account_number: string;
      currency: string;
      status: string;
      recorded_balance_kobo: string;
      balance_as_of: Date | string | null;
      gl_account_id: string | null;
      row_version: number;
    },
    reveal: boolean,
  ): BankAccountView {
    return {
      id: row.id,
      entityId: row.entity_id,
      entityCode: row.entity_code,
      entityName: row.entity_name,
      name: row.name,
      bankName: row.bank_name,
      accountName: row.account_name,
      accountNumber: reveal ? row.account_number : maskAccount(row.account_number),
      accountNumberMasked: maskAccount(row.account_number),
      currency: row.currency,
      status: row.status,
      recordedBalanceKobo: Number(row.recorded_balance_kobo),
      balanceAsOf:
        row.balance_as_of == null
          ? null
          : typeof row.balance_as_of === 'string'
            ? row.balance_as_of.slice(0, 10)
            : row.balance_as_of.toISOString().slice(0, 10),
      glAccountId: row.gl_account_id,
      rowVersion: row.row_version,
    };
  }
}
