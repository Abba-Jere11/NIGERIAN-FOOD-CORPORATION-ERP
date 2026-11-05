import type { AccountView, FinanceContextView, MeView } from '@nfc/shared';
import { PageHeader, Surface, SurfaceHeader } from '@/components/ui/Surface';
import { EmptyState } from '@/components/ui/States';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { ActionDialog } from '@/components/ui/Dialog';
import { apiFetch } from '@/lib/api';
import { resolveFinanceScope } from '../scope';
import { deactivateAccountAction } from '../actions';
import { AccountForm } from './AccountForm';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Chart of accounts — NFC' };

export default async function CoaPage({
  searchParams,
}: {
  searchParams: Promise<{ scope?: string }>;
}) {
  const query = await searchParams;
  const [me, context] = await Promise.all([
    apiFetch<MeView>('/api/me'),
    apiFetch<FinanceContextView>('/api/finance/context'),
  ]);
  const resolved = resolveFinanceScope(context, query.scope);
  const accounts = await apiFetch<AccountView[]>('/api/finance/accounts', {
    query: { entityId: resolved.entityId },
  });
  const canManage = me.permissions.includes('finance.coa.manage');

  return (
    <>
      <PageHeader
        eyebrow="Finance"
        title="Chart of accounts"
        description="Deactivate only. An account with postings cannot change type."
      />
      {canManage && resolved.entityId ? (
        <Surface className="mb-4">
          <SurfaceHeader title="Add an account" />
          <div className="px-4 py-3">
            <AccountForm entityId={resolved.entityId} accounts={accounts} />
          </div>
        </Surface>
      ) : null}
      <Surface padded={false}>
        <SurfaceHeader title={resolved.label} description={`${accounts.length} codes`} />
        {accounts.length === 0 ? (
          <EmptyState title="No accounts" description="Copy the NFC template or add a code." />
        ) : (
          <table className="w-full text-left text-[13px]">
            <thead className="border-b border-ink-200 text-[11px] uppercase tracking-wider text-ink-500">
              <tr>
                <th className="px-4 py-2 font-semibold">Code</th>
                <th className="px-4 py-2 font-semibold">Name</th>
                <th className="px-4 py-2 font-semibold">Type</th>
                <th className="px-4 py-2 font-semibold">Status</th>
                {canManage ? <th className="px-4 py-2 font-semibold"> </th> : null}
              </tr>
            </thead>
            <tbody>
              {accounts.map((account) => (
                <tr key={account.id} className="border-b border-ink-100">
                  <td className="tabular px-4 py-2">{account.code}</td>
                  <td className="px-4 py-2">
                    {account.name}
                    {account.intercompany ? (
                      <span className="ml-2 text-[11px] uppercase text-ink-500">IC</span>
                    ) : null}
                  </td>
                  <td className="px-4 py-2">{account.type}</td>
                  <td className="px-4 py-2">
                    <StatusBadge status={account.active ? 'ACTIVE' : 'INACTIVE'} />
                  </td>
                  {canManage ? (
                    <td className="px-4 py-2">
                      {account.active ? (
                        <ActionDialog
                          triggerLabel="Deactivate"
                          triggerSize="sm"
                          title="Deactivate account"
                          submitLabel="Deactivate"
                          successMessage="Account deactivated."
                          action={deactivateAccountAction}
                          hiddenFields={{ id: account.id, rowVersion: String(account.rowVersion) }}
                        />
                      ) : null}
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Surface>
    </>
  );
}
