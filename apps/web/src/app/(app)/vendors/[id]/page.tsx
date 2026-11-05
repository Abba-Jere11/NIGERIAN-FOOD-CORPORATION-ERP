import type {
  AuditEntryView,
  MeView,
  Page,
  VendorCategoryView,
  VendorHistoryView,
  VendorView,
} from '@nfc/shared';
import { formatLagosDateTime } from '@nfc/shared';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PageHeader, Surface, SurfaceHeader, DefinitionList } from '@/components/ui/Surface';
import { EmptyState } from '@/components/ui/States';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { apiFetch, ApiError } from '@/lib/api';
import { ComplianceUploadForm } from '../ComplianceUploadForm';
import { VendorActions } from '../VendorActions';
import { VendorForm } from '../VendorForm';

export const dynamic = 'force-dynamic';

const TABS = ['profile', 'compliance', 'history', 'audit'] as const;
type Tab = (typeof TABS)[number];

function isTab(value: string | undefined): value is Tab {
  return (TABS as readonly string[]).includes(value ?? '');
}

export default async function VendorDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const tab: Tab = isTab(query.tab) ? query.tab : 'profile';
  const me = await apiFetch<MeView>('/api/me');
  let vendor: VendorView;
  try {
    vendor = await apiFetch<VendorView>(`/api/vendors/${id}`);
  } catch (error) {
    if (error instanceof ApiError && (error.status === 404 || error.status === 403)) notFound();
    throw error;
  }

  const canCreate = me.permissions.includes('vendor.create');
  const history =
    tab === 'history'
      ? await apiFetch<VendorHistoryView>(`/api/vendors/${id}/history`).catch(() => null)
      : null;
  const audit =
    tab === 'audit' && me.permissions.includes('audit.view')
      ? await apiFetch<Page<AuditEntryView>>('/api/audit', {
          query: { subjectType: 'vendor', subjectId: id, pageSize: 50 },
        }).catch(() => null)
      : null;
  const categories =
    tab === 'profile' && canCreate && vendor.status === 'DRAFT'
      ? await apiFetch<VendorCategoryView[]>('/api/vendors/categories')
      : [];

  return (
    <>
      <PageHeader
        eyebrow="Vendor"
        title={vendor.referenceNumber}
        description={vendor.legalName}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={vendor.status} />
            <VendorActions
              vendor={vendor}
              canCreate={canCreate}
              canActivate={me.permissions.includes('vendor.activate')}
              canSuspend={me.permissions.includes('vendor.suspend')}
              canBlacklist={me.permissions.includes('vendor.blacklist')}
            />
          </div>
        }
      />
      {vendor.warnings.length > 0 ? (
        <Surface className="mb-4">
          <ul className="list-disc px-8 py-3 text-[13px] text-ink-700">
            {vendor.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </Surface>
      ) : null}
      <nav className="mb-4 flex gap-1 border-b border-ink-200 text-[13px]">
        {TABS.map((item) => (
          <Link
            key={item}
            href={`/vendors/${id}?tab=${item}`}
            className={
              tab === item
                ? 'border-b-2 border-accent-700 px-3 py-2 font-medium text-accent-900'
                : 'px-3 py-2 text-ink-600 hover:text-ink-900'
            }
          >
            {item.charAt(0).toUpperCase() + item.slice(1)}
          </Link>
        ))}
      </nav>
      {tab === 'profile' ? (
        <Surface>
          <SurfaceHeader title="Profile" />
          <div className="px-4 py-3">
            {canCreate && vendor.status === 'DRAFT' ? (
              <VendorForm categories={categories} vendor={vendor} />
            ) : (
              <DefinitionList
                items={[
                  { label: 'Legal name', value: vendor.legalName },
                  { label: 'CAC', value: vendor.cacRegistrationNumber },
                  { label: 'Category', value: vendor.categoryLabel },
                  { label: 'Notes', value: vendor.notes ?? '—' },
                  {
                    label: 'Contact',
                    value: vendor.contacts[0]
                      ? `${vendor.contacts[0].name}${vendor.contacts[0].phone ? ` · ${vendor.contacts[0].phone}` : ''}`
                      : '—',
                  },
                  {
                    label: 'Bank',
                    value: vendor.bank
                      ? `${vendor.bank.bankName} · ${vendor.bank.accountName} · ${vendor.bank.accountNumber}`
                      : 'Hidden or not recorded',
                  },
                ]}
              />
            )}
          </div>
        </Surface>
      ) : null}
      {tab === 'compliance' ? (
        <>
          {canCreate ? (
            <Surface className="mb-4">
              <SurfaceHeader title="Attach" description="PDF, JPEG or PNG. Required types: CAC, tax clearance, bank verification." />
              <div className="px-4 py-3">
                <ComplianceUploadForm vendorId={id} />
              </div>
            </Surface>
          ) : null}
          <Surface padded={false}>
            <SurfaceHeader title="Documents" />
            {vendor.compliance.length === 0 ? (
              <EmptyState title="None attached" description="Required types must be on file before onboarding." />
            ) : (
              <table className="w-full text-left text-[13px]">
                <thead className="border-b border-ink-200 bg-surface-muted text-[11px] uppercase tracking-wider text-ink-500">
                  <tr>
                    <th className="px-4 py-2 font-semibold">Type</th>
                    <th className="px-4 py-2 font-semibold">Document</th>
                    <th className="px-4 py-2 font-semibold">Expires</th>
                  </tr>
                </thead>
                <tbody>
                  {vendor.compliance.map((item) => (
                    <tr key={item.id} className="border-b border-ink-100">
                      <td className="px-4 py-2">
                        {item.complianceType.replaceAll('_', ' ')}
                        {item.required ? ' · required' : ''}
                      </td>
                      <td className="px-4 py-2">
                        {item.documentId ? (
                          <Link href={`/documents/${item.documentId}`} className="text-accent-800 underline">
                            {item.documentReference ?? item.title}
                          </Link>
                        ) : (
                          item.title
                        )}
                      </td>
                      <td className="px-4 py-2">
                        {item.expiresAt ?? '—'}
                        {item.expired ? <span className="ml-2 text-danger-700">Expired</span> : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Surface>
        </>
      ) : null}
      {tab === 'history' ? (
        <Surface padded={false}>
          <SurfaceHeader
            title="History"
            description="Procurement and payment rows arrive with later milestones. Blocked selection attempts are recorded now."
          />
          {!history ? (
            <EmptyState title="History could not be loaded" />
          ) : (
            <div className="px-4 py-3 space-y-6">
              <p className="text-[13px] text-ink-600">
                Total spend (NFC): {(history.totalSpendKobo / 100).toFixed(2)} · Subsidiaries:{' '}
                {history.subsidiaries.length === 0 ? 'none yet' : history.subsidiaries.join(', ')}
              </p>
              <section>
                <h3 className="text-[13px] font-semibold">Procurement</h3>
                {history.procurement.length === 0 ? (
                  <p className="mt-1 text-[13px] text-ink-500">No procurement yet.</p>
                ) : (
                  <ul className="mt-1 text-[13px]">
                    {history.procurement.map((row) => (
                      <li key={row.referenceNumber}>
                        {row.referenceNumber} · {row.title} · {row.status}
                      </li>
                    ))}
                  </ul>
                )}
              </section>
              <section>
                <h3 className="text-[13px] font-semibold">Payments</h3>
                {history.payments.length === 0 ? (
                  <p className="mt-1 text-[13px] text-ink-500">No payments yet.</p>
                ) : (
                  <ul className="mt-1 text-[13px]">
                    {history.payments.map((row) => (
                      <li key={row.referenceNumber}>
                        {row.referenceNumber} · {(row.amountKobo / 100).toFixed(2)}
                      </li>
                    ))}
                  </ul>
                )}
              </section>
              <section>
                <h3 className="text-[13px] font-semibold">Open claims</h3>
                {history.openClaims.length === 0 ? (
                  <p className="mt-1 text-[13px] text-ink-500">None.</p>
                ) : (
                  <ul className="mt-1 text-[13px]">
                    {history.openClaims.map((row) => (
                      <li key={`${row.procurementReference}-${row.createdAt}`}>
                        {row.procurementReference ?? 'PR'} · {row.quantity} units ·{' '}
                        {(row.amountKobo / 100).toFixed(2)} · {row.reason}
                      </li>
                    ))}
                  </ul>
                )}
              </section>
              <section>
                <h3 className="text-[13px] font-semibold">Blocked selection</h3>
                {history.blockedAttempts.length === 0 ? (
                  <p className="mt-1 text-[13px] text-ink-500">None.</p>
                ) : (
                  <ul className="mt-1 text-[13px]">
                    {history.blockedAttempts.map((row) => (
                      <li key={row.id}>
                        {formatLagosDateTime(row.occurredAt)} · {row.reason}
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </div>
          )}
        </Surface>
      ) : null}
      {tab === 'audit' ? (
        <Surface padded={false}>
          <SurfaceHeader title="Audit" description="Requires audit.view. The table itself cannot be edited." />
          {!me.permissions.includes('audit.view') ? (
            <EmptyState title="You cannot read the audit log" description="Only the Managing Director and ED Finance hold this grant." />
          ) : !audit ? (
            <EmptyState title="Audit entries could not be loaded" />
          ) : audit.rows.length === 0 ? (
            <EmptyState title="No entries yet" />
          ) : (
            <table className="w-full text-left text-[13px]">
              <thead className="border-b border-ink-200 bg-surface-muted text-[11px] uppercase tracking-wider text-ink-500">
                <tr>
                  <th className="px-4 py-2 font-semibold">When</th>
                  <th className="px-4 py-2 font-semibold">Who</th>
                  <th className="px-4 py-2 font-semibold">Action</th>
                  <th className="px-4 py-2 font-semibold">Reason</th>
                </tr>
              </thead>
              <tbody>
                {audit.rows.map((row) => (
                  <tr key={row.id} className="border-b border-ink-100">
                    <td className="px-4 py-2 tabular text-ink-500">{formatLagosDateTime(row.occurredAt)}</td>
                    <td className="px-4 py-2">{row.actorName ?? row.actorRef}</td>
                    <td className="px-4 py-2">{row.action}</td>
                    <td className="px-4 py-2">{row.reason ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Surface>
      ) : null}
    </>
  );
}
