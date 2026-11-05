import type { TxScope } from '../database/unit-of-work';

export interface ReportWindow {
  year: number | null;
  periodIndex: number | null;
  ytd: boolean;
  activityStart: string | null;
  activityEnd: string | null;
  asOf: string | null;
  periodId: string | null;
  comparePeriodId: string | null;
  compareStart: string | null;
  compareEnd: string | null;
  compareAsOf: string | null;
  compareLabel: string | null;
  label: string;
  departmentId: string | null;
  projectId: string | null;
}

export interface ReportQuery {
  entityId?: string;
  consolidated?: boolean;
  fiscalYearId?: string;
  year?: number;
  periodId?: string;
  ytd?: boolean;
  comparePeriodId?: string;
  departmentId?: string;
  projectId?: string;
}

export async function resolveReportWindow(tx: TxScope, query: ReportQuery): Promise<ReportWindow> {
  const departmentId = query.departmentId ?? null;
  const projectId = query.projectId ?? null;
  const ytd = Boolean(query.ytd);
  const empty: ReportWindow = {
    year: null,
    periodIndex: null,
    ytd,
    activityStart: null,
    activityEnd: null,
    asOf: null,
    periodId: query.periodId ?? null,
    comparePeriodId: query.comparePeriodId ?? null,
    compareStart: null,
    compareEnd: null,
    compareAsOf: null,
    compareLabel: null,
    label: 'All posted periods',
    departmentId,
    projectId,
  };

  let period: {
    id: string;
    name: string;
    period_index: number;
    starts_on: Date;
    ends_on: Date;
    year: number;
    year_starts: Date;
  } | undefined;

  if (query.periodId) {
    const result = await tx.client.query<{
      id: string;
      name: string;
      period_index: number;
      starts_on: Date;
      ends_on: Date;
      year: number;
      year_starts: Date;
    }>(
      `SELECT p.id, p.name, p.period_index, p.starts_on, p.ends_on, y.year, y.starts_on AS year_starts
         FROM fiscal_periods p
         JOIN fiscal_years y ON y.id = p.fiscal_year_id
        WHERE p.id = $1`,
      [query.periodId],
    );
    period = result.rows[0];
  } else if (query.fiscalYearId || query.year) {
    const result = await tx.client.query<{
      id: string;
      name: string;
      period_index: number;
      starts_on: Date;
      ends_on: Date;
      year: number;
      year_starts: Date;
    }>(
      `SELECT p.id, p.name, p.period_index, p.starts_on, p.ends_on, y.year, y.starts_on AS year_starts
         FROM fiscal_periods p
         JOIN fiscal_years y ON y.id = p.fiscal_year_id
        WHERE ($1::uuid IS NULL OR y.id = $1)
          AND ($2::int IS NULL OR y.year = $2)
        ORDER BY p.period_index DESC
        LIMIT 1`,
      [query.fiscalYearId ?? null, query.year ?? null],
    );
    period = result.rows[0];
  }

  if (!period) return empty;

  const activityStart = isoDate(ytd ? period.year_starts : period.starts_on);
  const activityEnd = isoDate(period.ends_on);
  const window: ReportWindow = {
    year: period.year,
    periodIndex: period.period_index,
    ytd,
    activityStart,
    activityEnd,
    asOf: activityEnd,
    periodId: query.periodId ?? period.id,
    comparePeriodId: query.comparePeriodId ?? null,
    compareStart: null,
    compareEnd: null,
    compareAsOf: null,
    compareLabel: null,
    label: ytd ? `${period.year} YTD to ${period.name}` : `${period.year} ${period.name}`,
    departmentId,
    projectId,
  };

  if (query.comparePeriodId) {
    const compare = await tx.client.query<{
      name: string;
      starts_on: Date;
      ends_on: Date;
      year: number;
      year_starts: Date;
    }>(
      `SELECT p.name, p.starts_on, p.ends_on, y.year, y.starts_on AS year_starts
         FROM fiscal_periods p
         JOIN fiscal_years y ON y.id = p.fiscal_year_id
        WHERE p.id = $1`,
      [query.comparePeriodId],
    );
    const row = compare.rows[0];
    if (row) {
      window.compareStart = isoDate(ytd ? row.year_starts : row.starts_on);
      window.compareEnd = isoDate(row.ends_on);
      window.compareAsOf = isoDate(row.ends_on);
      window.compareLabel = ytd ? `${row.year} YTD to ${row.name}` : `${row.year} ${row.name}`;
    }
  }

  return window;
}

export function isoDate(value: Date | string): string {
  if (typeof value === 'string') return value.slice(0, 10);
  return value.toISOString().slice(0, 10);
}

export function journalDateSql(alias = 'p'): string {
  return `${alias}.ends_on`;
}
