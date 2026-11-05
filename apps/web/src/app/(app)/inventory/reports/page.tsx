import type { InventoryContextView } from '@nfc/shared';
import Link from 'next/link';
import { PageHeader, Surface } from '@/components/ui/Surface';
import { apiFetch } from '@/lib/api';
import { inventoryScopeParam, resolveInventoryScope, withInvScope } from '../scope';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Reports — Inventory — NFC' };

const LINKS = [
  { href: '/inventory', title: 'Dashboard', description: 'Live on-hand value, alerts and distribution.' },
  { href: '/inventory/items', title: 'Stock register', description: 'Item types, reserved and available quantities.' },
  { href: '/inventory/expected', title: 'Expected stock', description: 'Open receipts against approved purchase requests.' },
  { href: '/inventory/movements', title: 'Movement ledger', description: 'Append-only receipts, issues, transfers and sales.' },
  { href: '/inventory/alerts', title: 'Low-stock alerts', description: 'Items at or below reorder, including out of stock.' },
  { href: '/inventory/production', title: 'Production', description: 'Open and completed production orders.' },
  { href: '/inventory/sales', title: 'Sales', description: 'Orders, reservations, dispatches and invoices.' },
];

export default async function InventoryReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ scope?: string }>;
}) {
  const query = await searchParams;
  const context = await apiFetch<InventoryContextView>('/api/inventory/context');
  const resolved = resolveInventoryScope(context, query.scope);
  const scope = inventoryScopeParam(resolved);
  return (
    <>
      <PageHeader
        eyebrow="Inventory"
        title="Reports"
        description={`${resolved.label}. Figures come from live stock records for the selected scope, as at today.`}
      />
      <Surface>
        <ul className="divide-y divide-ink-100 text-[13px]">
          {LINKS.map((link) => (
            <li key={link.href} className="py-3 first:pt-0 last:pb-0">
              <Link href={withInvScope(link.href, scope)} className="font-medium underline">
                {link.title}
              </Link>
              <p className="text-ink-500">{link.description}</p>
            </li>
          ))}
        </ul>
      </Surface>
    </>
  );
}
