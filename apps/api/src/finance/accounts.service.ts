import { Injectable } from '@nestjs/common';
import type { ActorContext } from '@nfc/db';
import type { AccountView, FinanceContextView } from '@nfc/shared';
import { assertCan, can } from '../auth/can';
import { ForbiddenError, NotFoundError, StaleRecordError, ValidationFailedError } from '../common/errors/domain-error';
import type { TxScope } from '../database/unit-of-work';
import { UnitOfWork } from '../database/unit-of-work';
import type { UpsertAccountInput } from './finance.dto';

@Injectable()
export class AccountsService {
  constructor(private readonly unitOfWork: UnitOfWork) {}

  async context(actor: ActorContext): Promise<FinanceContextView> {
    if (!can(actor, 'finance.view') && !can(actor, 'finance.budget.view')) {
      throw new ForbiddenError('You cannot view finance.');
    }
    return this.unitOfWork.read(actor, async (tx) => {
      const entities = await tx.client.query<{
        id: string;
        code: string;
        name: string;
        type: string;
      }>(`SELECT id, code, name, type FROM entities WHERE status = 'ACTIVE' ORDER BY type, code`);
      return {
        canConsolidate: can(actor, 'finance.view.consolidated'),
        entities: entities.rows.filter(
          (entity) =>
            can(actor, 'finance.view', entity.id) || can(actor, 'finance.budget.view', entity.id),
        ),
      };
    });
  }

  async queues(actor: ActorContext): Promise<{
    pendingJournals: number;
    pendingBudgets: number;
    unreconciledLines: number;
  }> {
    if (!can(actor, 'finance.view') && !can(actor, 'finance.budget.view')) {
      throw new ForbiddenError('You cannot view finance.');
    }
    return this.unitOfWork.read(actor, async (tx) => {
      const journals = await tx.client.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM journals WHERE status = 'PENDING_APPROVAL'`,
      );
      const budgets = await tx.client.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM budgets WHERE status = 'PENDING_APPROVAL'`,
      );
      const unmatched = await tx.client.query<{ n: string }>(
        `SELECT count(*)::text AS n
           FROM bank_statement_lines l
           LEFT JOIN bank_reconciliation_matches m
             ON m.statement_line_id = l.id AND m.unmatched_at IS NULL
          WHERE m.id IS NULL`,
      );
      return {
        pendingJournals: Number(journals.rows[0]?.n ?? 0),
        pendingBudgets: Number(budgets.rows[0]?.n ?? 0),
        unreconciledLines: Number(unmatched.rows[0]?.n ?? 0),
      };
    });
  }

  async list(actor: ActorContext, entityId?: string): Promise<AccountView[]> {
    if (!can(actor, 'finance.view')) throw new ForbiddenError('You cannot view the chart of accounts.');
    return this.unitOfWork.read(actor, async (tx) => this.listInTx(tx, entityId));
  }

  async listInTx(tx: TxScope, entityId?: string): Promise<AccountView[]> {
    const result = await tx.client.query<{
      id: string;
      entity_id: string;
      entity_code: string | null;
      code: string;
      name: string;
      type: AccountView['type'];
      parent_id: string | null;
      normal_balance: AccountView['normalBalance'];
      active: boolean;
      consolidation_code: string;
      intercompany: boolean;
      row_version: number;
    }>(
      `SELECT a.id, a.entity_id, e.code AS entity_code, a.code, a.name, a.type, a.parent_id,
              a.normal_balance, a.active, a.consolidation_code, a.intercompany, a.row_version
         FROM accounts a
         JOIN entities e ON e.id = a.entity_id
        WHERE ($1::uuid IS NULL OR a.entity_id = $1)
        ORDER BY e.code, a.code`,
      [entityId ?? null],
    );
    return result.rows.map((row) => this.toView(row));
  }

  async upsert(actor: ActorContext, input: UpsertAccountInput, id?: string): Promise<AccountView> {
    assertCan(actor, 'finance.coa.manage', input.entityId);
    return this.unitOfWork.write(actor, async (tx) => {
      let accountId = id;
      if (id) {
        const current = await tx.client.query<{ row_version: number; entity_id: string }>(
          `SELECT row_version, entity_id FROM accounts WHERE id = $1 FOR UPDATE`,
          [id],
        );
        const row = current.rows[0];
        if (!row) throw new NotFoundError('That account does not exist.');
        if (input.rowVersion != null && row.row_version !== input.rowVersion) {
          throw new StaleRecordError('This account has changed. Refresh and try again.');
        }
        await tx.client.query(
          `UPDATE accounts
              SET name = $2, parent_id = $3, consolidation_code = $4, intercompany = $5,
                  active = $6, updated_by = $7
            WHERE id = $1`,
          [
            id,
            input.name.trim(),
            input.parentId ?? null,
            input.consolidationCode.trim(),
            input.intercompany ?? false,
            input.active ?? true,
            actor.ref,
          ],
        );
      } else {
        const inserted = await tx.client.query<{ id: string }>(
          `INSERT INTO accounts (
             entity_id, code, name, type, parent_id, normal_balance, consolidation_code,
             intercompany, active, created_by, updated_by
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10)
           RETURNING id`,
          [
            input.entityId,
            input.code.trim(),
            input.name.trim(),
            input.type,
            input.parentId ?? null,
            input.normalBalance,
            input.consolidationCode.trim(),
            input.intercompany ?? false,
            input.active ?? true,
            actor.ref,
          ],
        );
        accountId = inserted.rows[0]?.id;
      }
      if (!accountId) throw new Error('The account was not saved.');
      await tx.audit({
        action: id ? 'edit' : 'create',
        subjectType: 'account',
        subjectId: accountId,
        subjectLabel: input.code,
        entityId: input.entityId,
        newValue: { code: input.code, name: input.name },
      });
      await this.indexAccount(tx, accountId);
      const list = await this.listInTx(tx, input.entityId);
      const view = list.find((row) => row.id === accountId);
      if (!view) throw new Error('The account could not be reloaded.');
      return view;
    });
  }

  async copyTemplate(actor: ActorContext, entityId: string): Promise<AccountView[]> {
    assertCan(actor, 'finance.coa.manage', entityId);
    return this.unitOfWork.write(actor, async (tx) => {
      await this.copyTemplateInTx(tx, actor, entityId);
      return this.listInTx(tx, entityId);
    });
  }

  async copyTemplateInTx(tx: TxScope, actor: ActorContext, entityId: string): Promise<void> {
    const templates = await tx.client.query<{
      id: string;
      code: string;
      name: string;
      type: string;
      parent_code: string | null;
      normal_balance: string;
      consolidation_code: string;
      intercompany: boolean;
    }>(
      `SELECT id, code, name, type, parent_code, normal_balance, consolidation_code, intercompany
         FROM account_templates ORDER BY sort_order`,
    );
    const byCode = new Map<string, string>();
    for (const template of templates.rows) {
      const parentId = template.parent_code ? (byCode.get(template.parent_code) ?? null) : null;
      const inserted = await tx.client.query<{ id: string }>(
        `INSERT INTO accounts (
           entity_id, template_id, code, name, type, parent_id, normal_balance,
           consolidation_code, intercompany, created_by, updated_by
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10)
         ON CONFLICT (entity_id, code) DO UPDATE SET name = EXCLUDED.name
         RETURNING id`,
        [
          entityId,
          template.id,
          template.code,
          template.name,
          template.type,
          parentId,
          template.normal_balance,
          template.consolidation_code,
          template.intercompany,
          actor.ref,
        ],
      );
      const id = inserted.rows[0]?.id;
      if (id) {
        byCode.set(template.code, id);
        await this.indexAccount(tx, id);
      }
    }
    void actor;
  }

  async deactivate(actor: ActorContext, id: string, rowVersion: number): Promise<AccountView> {
    return this.unitOfWork.write(actor, async (tx) => {
      const current = await tx.client.query<{ entity_id: string; code: string; row_version: number }>(
        `SELECT entity_id, code, row_version FROM accounts WHERE id = $1 FOR UPDATE`,
        [id],
      );
      const row = current.rows[0];
      if (!row) throw new NotFoundError('That account does not exist.');
      assertCan(actor, 'finance.coa.manage', row.entity_id);
      if (row.row_version !== rowVersion) {
        throw new StaleRecordError('This account has changed. Refresh and try again.');
      }
      await tx.client.query(`UPDATE accounts SET active = false, updated_by = $1 WHERE id = $2`, [
        actor.ref,
        id,
      ]);
      await tx.audit({
        action: 'edit',
        subjectType: 'account',
        subjectId: id,
        subjectLabel: row.code,
        entityId: row.entity_id,
        reason: 'Deactivated',
        newValue: { active: false },
      });
      const list = await this.listInTx(tx, row.entity_id);
      const view = list.find((item) => item.id === id);
      if (!view) throw new ValidationFailedError('The account could not be reloaded.');
      return view;
    });
  }

  private async indexAccount(tx: TxScope, id: string): Promise<void> {
    const row = await tx.client.query<{
      code: string;
      name: string;
      entity_id: string;
    }>(`SELECT code, name, entity_id FROM accounts WHERE id = $1`, [id]);
    const account = row.rows[0];
    if (!account) return;
    await tx.indexSearch({
      recordType: 'ACCOUNT',
      recordId: id,
      referenceNumber: account.code,
      title: account.name,
      searchableText: `${account.code} ${account.name}`,
      entityId: account.entity_id,
      permissionKey: 'finance.view',
    });
  }

  private toView(row: {
    id: string;
    entity_id: string;
    entity_code: string | null;
    code: string;
    name: string;
    type: AccountView['type'];
    parent_id: string | null;
    normal_balance: AccountView['normalBalance'];
    active: boolean;
    consolidation_code: string;
    intercompany: boolean;
    row_version: number;
  }): AccountView {
    return {
      id: row.id,
      entityId: row.entity_id,
      entityCode: row.entity_code,
      code: row.code,
      name: row.name,
      type: row.type,
      parentId: row.parent_id,
      normalBalance: row.normal_balance,
      active: row.active,
      consolidationCode: row.consolidation_code,
      intercompany: row.intercompany,
      rowVersion: row.row_version,
    };
  }
}
