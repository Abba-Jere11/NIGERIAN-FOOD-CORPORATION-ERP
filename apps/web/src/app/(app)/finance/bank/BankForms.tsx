'use client';

import { useActionState } from 'react';
import type {
  BankAccountView,
  FiscalPeriodView,
  ReconciliationReportView,
} from '@nfc/shared';
import { formatKobo } from '@nfc/shared';
import { IDLE_ACTION_RESULT } from '@/lib/action-result';
import { Button } from '@/components/ui/Button';
import { SelectField, TextField } from '@/components/ui/Field';
import { ErrorState } from '@/components/ui/States';
import { Surface, SurfaceHeader } from '@/components/ui/Surface';
import { importStatementAction, reconcileAction, transferAction, unmatchAction } from '../actions';

export function BankForms({
  account,
  accounts,
  periods,
  report,
  canManage,
  canReconcile,
}: {
  account: BankAccountView;
  accounts: BankAccountView[];
  periods: FiscalPeriodView[];
  report: ReconciliationReportView | null;
  canManage: boolean;
  canReconcile: boolean;
}) {
  const [transferState, transferForm] = useActionState(transferAction, IDLE_ACTION_RESULT);
  const [importState, importForm] = useActionState(importStatementAction, IDLE_ACTION_RESULT);
  const [matchState, matchForm] = useActionState(reconcileAction, IDLE_ACTION_RESULT);
  const [unmatchState, unmatchForm] = useActionState(unmatchAction, IDLE_ACTION_RESULT);
  const others = accounts.filter((row) => row.id !== account.id && row.entityId === account.entityId);

  return (
    <div className="mb-4 grid gap-4 lg:grid-cols-2">
      {canManage ? (
        <Surface>
          <SurfaceHeader title="Own-account transfer" />
          <form action={transferForm} className="space-y-3 px-4 py-3">
            <input type="hidden" name="entityId" value={account.entityId} />
            <input type="hidden" name="sourceAccountId" value={account.id} />
            {transferState.status === 'error' ? <ErrorState message={transferState.message} /> : null}
            <SelectField
              label="Destination"
              name="destinationAccountId"
              required
              options={others.map((row) => ({ value: row.id, label: row.name }))}
            />
            <SelectField
              label="Period"
              name="fiscalPeriodId"
              required
              options={periods
                .filter((period) => period.status === 'OPEN')
                .map((period) => ({ value: period.id, label: period.name }))}
            />
            <TextField label="Amount (₦)" name="amount" required />
            <TextField label="Date" name="occurredOn" type="date" required />
            <TextField label="Narration" name="narration" required />
            <Button type="submit" variant="primary">
              Transfer
            </Button>
          </form>
        </Surface>
      ) : null}
      {canManage ? (
        <Surface>
          <SurfaceHeader title="Import statement" />
          <form action={importForm} className="space-y-3 px-4 py-3">
            <input type="hidden" name="accountId" value={account.id} />
            {importState.status === 'error' ? <ErrorState message={importState.message} /> : null}
            <TextField label="Date column" name="dateColumn" defaultValue="date" />
            <TextField label="Description column" name="descriptionColumn" defaultValue="description" />
            <TextField label="Amount column" name="amountColumn" defaultValue="amount" />
            <label className="block text-[12px] font-semibold text-ink-700">
              File
              <input type="file" name="file" required className="mt-1 block text-sm" />
            </label>
            <Button type="submit" variant="primary">
              Import
            </Button>
          </form>
        </Surface>
      ) : null}
      {canReconcile && report ? (
        <Surface className="lg:col-span-2">
          <SurfaceHeader title="Reconciliation" description="Match a statement line to a bank movement or cash journal line." />
          <form action={matchForm} className="grid gap-3 px-4 py-3 md:grid-cols-3">
            {matchState.status === 'error' ? (
              <div className="md:col-span-3">
                <ErrorState message={matchState.message} />
              </div>
            ) : null}
            <SelectField
              label="Statement line"
              name="statementLineId"
              required
              options={report.unmatchedStatement.map((line) => ({
                value: line.id,
                label: `${line.occurredOn} ${line.description} ${formatKobo(BigInt(line.amountKobo))}`,
              }))}
            />
            <TextField label="Bank transaction id" name="bankTransactionId" />
            <TextField label="Journal line id" name="journalLineId" />
            <Button type="submit" variant="primary">
              Match
            </Button>
          </form>
          <form action={unmatchForm} className="grid gap-3 border-t border-ink-100 px-4 py-3 md:grid-cols-3">
            {unmatchState.status === 'error' ? (
              <div className="md:col-span-3">
                <ErrorState message={unmatchState.message} />
              </div>
            ) : null}
            <SelectField
              label="Matched line"
              name="lineId"
              required
              options={report.matched.map((row) => ({
                value: row.statementLineId,
                label: row.statementLineId,
              }))}
            />
            <TextField label="Reason" name="reason" required />
            <Button type="submit">Unmatch</Button>
          </form>
        </Surface>
      ) : null}
    </div>
  );
}
