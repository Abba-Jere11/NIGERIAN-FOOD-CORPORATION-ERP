import type { MeView, VendorCategoryView, VendorListItemView } from '@nfc/shared';
import { canManageVendorRegister, canReadVendorRegister, formatLagosDateTime } from '@nfc/shared';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ButtonLink } from '@/components/ui/Button';
import { CONTROL_CLASS } from '@/components/ui/Field';
import { PageHeader, Surface, SurfaceHeader } from '@/components/ui/Surface';
import { EmptyState } from '@/components/ui/States';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { apiFetch } from '@/lib/api';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Vendors — NFC' };

export default async function VendorsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; category?: string; q?: string }>;
}) {
  const me = await apiFetch<MeView>('/api/me');
  if (!canReadVendorRegister(me.permissions)) redirect('/forbidden');
  const query = await searchParams;
  const [rows, categories] = await Promise.all([
    apiFetch<VendorListItemView[]>('/api/vendors', {
      query: { status: query.status, category: query.category, q: query.q },
    }),
    apiFetch<VendorCategoryView[]>('/api/vendors/categories'),
  ]);
  const canCreate = me.permissions.includes('vendor.create');
  const manage = canManageVendorRegister(me.permissions);

  return (
    <>
      <PageHeader
        eyebrow="Shared services"
        title="Vendors"
        description={
          manage
            ? 'Group-wide register. Drafts become Active only after a different user activates them.'
            : 'Active vendors that may be selected for procurement. Bank details are hidden.'
        }
        actions={
          canCreate ? (
            <ButtonLink href="/vendors/new" variant="primary">
              New vendor
            </ButtonLink>
          ) : null
        }
      />
      <Surface className="mb-4">
        <form method="get" className="grid gap-3 px-4 py-3 sm:grid-cols-4">
          {manage ? (
            <label className="text-[12px] font-semibold text-ink-700">
              Status
              <select name="status" defaultValue={query.status ?? ''} className={`mt-1 ${CONTROL_CLASS}`}>
                <option value="">All</option>
                <option value="DRAFT">Draft</option>
                <option value="PENDING_REVIEW">Pending review</option>
                <option value="ACTIVE">Active</option>
                <option value="PENDING_REVERIFICATION">Pending re-verification</option>
                <option value="SUSPENDED">Suspended</option>
                <option value="BLACKLISTED">Blacklisted</option>
              </select>
            </label>
          ) : null}
          <label className="text-[12px] font-semibold text-ink-700">
            Category
            <select name="category" defaultValue={query.category ?? ''} className={`mt-1 ${CONTROL_CLASS}`}>
              <option value="">All</option>
              {categories.map((row) => (
                <option key={row.id} value={row.key}>
                  {row.label}
                </option>
              ))}
            </select>
          </label>
          <label className="text-[12px] font-semibold text-ink-700 sm:col-span-2">
            Search
            <input name="q" defaultValue={query.q ?? ''} className={`mt-1 ${CONTROL_CLASS}`} />
          </label>
          <div className="flex items-end">
            <button type="submit" className="h-9 border border-ink-300 bg-surface px-3 text-[13px] font-medium">
              Filter
            </button>
          </div>
        </form>
      </Surface>
      <Surface padded={false}>
        <SurfaceHeader title="Register" description={`${rows.length} vendor${rows.length === 1 ? '' : 's'}.`} />
        {rows.length === 0 ? (
          <EmptyState title="No vendors match" description="Create a draft or clear the filters." />
        ) : (
          <table className="w-full text-left text-[13px]">
            <thead className="border-b border-ink-200 bg-surface-muted text-[11px] uppercase tracking-wider text-ink-500">
              <tr>
                <th className="px-4 py-2 font-semibold">Reference</th>
                <th className="px-4 py-2 font-semibold">Name</th>
                <th className="px-4 py-2 font-semibold">CAC</th>
                <th className="px-4 py-2 font-semibold">Category</th>
                <th className="px-4 py-2 font-semibold">Status</th>
                <th className="px-4 py-2 font-semibold">Created</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-b border-ink-100">
                  <td className="px-4 py-2 font-mono">
                    <Link href={`/vendors/${row.id}`} className="text-accent-800 underline">
                      {row.referenceNumber}
                    </Link>
                  </td>
                  <td className="px-4 py-2">{row.legalName}</td>
                  <td className="px-4 py-2 font-mono">{row.cacRegistrationNumber}</td>
                  <td className="px-4 py-2">{row.categoryLabel}</td>
                  <td className="px-4 py-2">
                    <StatusBadge status={row.status} />
                    {row.complianceExpired ? (
                      <span className="ml-2 text-[11px] text-danger-700">Expired docs</span>
                    ) : null}
                  </td>
                  <td className="px-4 py-2 tabular text-ink-500">{formatLagosDateTime(row.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Surface>
    </>
  );
}
