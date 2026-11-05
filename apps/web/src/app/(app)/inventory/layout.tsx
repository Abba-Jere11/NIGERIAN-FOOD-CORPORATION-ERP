import { Suspense, type ReactNode } from 'react';
import { redirect } from 'next/navigation';
import type { InventoryContextView, MeView } from '@nfc/shared';
import { hasInventoryNavPermission } from '@nfc/shared';
import { apiFetch } from '@/lib/api';
import { InventoryChrome } from './InventoryChrome';

export const dynamic = 'force-dynamic';

export default async function InventoryLayout({ children }: { children: ReactNode }) {
  const me = await apiFetch<MeView>('/api/me');
  if (!hasInventoryNavPermission(me.permissions)) redirect('/forbidden');
  const context = await apiFetch<InventoryContextView>('/api/inventory/context');

  return (
    <>
      <Suspense fallback={null}>
        <InventoryChrome context={context} />
      </Suspense>
      {children}
    </>
  );
}
