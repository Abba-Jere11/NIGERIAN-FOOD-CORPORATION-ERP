import { Injectable } from '@nestjs/common';
import type { ActorContext } from '@nfc/db';
import type { FiscalPeriodView, FiscalYearView } from '@nfc/shared';
import { assertCan, can } from '../auth/can';
import { ConflictError, ForbiddenError, NotFoundError, StaleRecordError } from '../common/errors/domain-error';
import type { TxScope } from '../database/unit-of-work';
import { UnitOfWork } from '../database/unit-of-work';

@Injectable()
export class CalendarService {
  constructor(private readonly unitOfWork: UnitOfWork) {}

  async listYears(actor: ActorContext, entityId?: string): Promise<FiscalYearView[]> {
    if (!can(actor, 'finance.view') && !can(actor, 'finance.budget.view')) {
      throw new ForbiddenError('You cannot view the fiscal calendar.');
    }
    return this.unitOfWork.read(actor, async (tx) => this.listYearsInTx(tx, entityId));
  }

  async listYearsInTx(tx: TxScope, entityId?: string): Promise<FiscalYearView[]> {
    const years = await tx.client.query<{
      id: string;
      entity_id: string;
      entity_code: string | null;
      year: number;
      starts_on: Date;
      ends_on: Date;
      status: FiscalYearView['status'];
      row_version: number;
    }>(
      `SELECT y.id, y.entity_id, e.code AS entity_code, y.year, y.starts_on, y.ends_on, y.status, y.row_version
         FROM fiscal_years y
         JOIN entities e ON e.id = y.entity_id
        WHERE ($1::uuid IS NULL OR y.entity_id = $1)
        ORDER BY e.code, y.year`,
      [entityId ?? null],
    );
    const result: FiscalYearView[] = [];
    for (const year of years.rows) {
      result.push({
        id: year.id,
        entityId: year.entity_id,
        entityCode: year.entity_code,
        year: year.year,
        startsOn: dateOnly(year.starts_on),
        endsOn: dateOnly(year.ends_on),
        status: year.status,
        rowVersion: year.row_version,
        periods: await this.loadPeriods(tx, year.id),
      });
    }
    return result;
  }

  async createYear(
    actor: ActorContext,
    input: { entityId: string; year: number; startsOn: string; endsOn: string },
  ): Promise<FiscalYearView> {
    assertCan(actor, 'finance.period.close', input.entityId);
    return this.unitOfWork.write(actor, async (tx) => {
      const inserted = await tx.client.query<{ id: string }>(
        `INSERT INTO fiscal_years (entity_id, year, starts_on, ends_on, created_by, updated_by)
         VALUES ($1, $2, $3, $4, $5, $5)
         RETURNING id`,
        [input.entityId, input.year, input.startsOn, input.endsOn, actor.ref],
      );
      const yearId = inserted.rows[0]?.id;
      if (!yearId) throw new Error('The fiscal year was not created.');
      const start = new Date(`${input.startsOn}T00:00:00Z`);
      for (let index = 1; index <= 12; index += 1) {
        const periodStart = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + index - 1, 1));
        const periodEnd = new Date(Date.UTC(periodStart.getUTCFullYear(), periodStart.getUTCMonth() + 1, 0));
        await tx.client.query(
          `INSERT INTO fiscal_periods (
             fiscal_year_id, entity_id, period_index, name, starts_on, ends_on, created_by, updated_by
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $7)`,
          [
            yearId,
            input.entityId,
            index,
            periodStart.toLocaleString('en-GB', { month: 'long', timeZone: 'UTC' }),
            periodStart.toISOString().slice(0, 10),
            periodEnd.toISOString().slice(0, 10),
            actor.ref,
          ],
        );
      }
      await tx.audit({
        action: 'create',
        subjectType: 'fiscal_year',
        subjectId: yearId,
        subjectLabel: String(input.year),
        entityId: input.entityId,
        newValue: { year: input.year },
      });
      const list = await this.listYearsInTx(tx, input.entityId);
      const created = list.find((row) => row.id === yearId);
      if (!created) throw new Error('The fiscal year could not be reloaded.');
      return created;
    });
  }

  async closePeriod(actor: ActorContext, periodId: string, rowVersion: number): Promise<FiscalPeriodView> {
    return this.unitOfWork.write(actor, async (tx) => {
      const current = await tx.client.query<{
        id: string;
        fiscal_year_id: string;
        entity_id: string;
        period_index: number;
        name: string;
        starts_on: Date;
        ends_on: Date;
        status: FiscalPeriodView['status'];
        row_version: number;
      }>(
        `SELECT id, fiscal_year_id, entity_id, period_index, name, starts_on, ends_on, status, row_version
           FROM fiscal_periods WHERE id = $1 FOR UPDATE`,
        [periodId],
      );
      const row = current.rows[0];
      if (!row) throw new NotFoundError('That fiscal period does not exist.');
      assertCan(actor, 'finance.period.close', row.entity_id);
      if (row.row_version !== rowVersion) {
        throw new StaleRecordError('This period has changed. Refresh and try again.');
      }
      if (row.status === 'LOCKED') throw new ConflictError('A locked period cannot be changed.');
      if (row.status === 'CLOSED') return this.toPeriod(row);
      await tx.client.query(
        `UPDATE fiscal_periods SET status = 'CLOSED', updated_by = $1 WHERE id = $2 AND row_version = $3`,
        [actor.ref, periodId, rowVersion],
      );
      await tx.audit({
        action: 'edit',
        subjectType: 'fiscal_period',
        subjectId: periodId,
        subjectLabel: row.name,
        entityId: row.entity_id,
        reason: 'Period close',
        oldValue: { status: row.status },
        newValue: { status: 'CLOSED' },
      });
      return this.toPeriod({ ...row, status: 'CLOSED', row_version: row.row_version + 1 });
    });
  }

  private async loadPeriods(tx: TxScope, yearId: string): Promise<FiscalPeriodView[]> {
    const result = await tx.client.query<{
      id: string;
      fiscal_year_id: string;
      period_index: number;
      name: string;
      starts_on: Date;
      ends_on: Date;
      status: FiscalPeriodView['status'];
      row_version: number;
    }>(
      `SELECT id, fiscal_year_id, period_index, name, starts_on, ends_on, status, row_version
         FROM fiscal_periods WHERE fiscal_year_id = $1 ORDER BY period_index`,
      [yearId],
    );
    return result.rows.map((row) => this.toPeriod(row));
  }

  private toPeriod(row: {
    id: string;
    fiscal_year_id: string;
    period_index: number;
    name: string;
    starts_on: Date;
    ends_on: Date;
    status: FiscalPeriodView['status'];
    row_version: number;
  }): FiscalPeriodView {
    return {
      id: row.id,
      fiscalYearId: row.fiscal_year_id,
      periodIndex: row.period_index,
      name: row.name,
      startsOn: dateOnly(row.starts_on),
      endsOn: dateOnly(row.ends_on),
      status: row.status,
      rowVersion: row.row_version,
    };
  }
}

function dateOnly(value: Date | string): string {
  if (typeof value === 'string') return value.slice(0, 10);
  return value.toISOString().slice(0, 10);
}
