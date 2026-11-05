import { Suspense, type ReactNode } from 'react';
import { redirect } from 'next/navigation';
import type { FinanceContextView, MeView } from '@nfc/shared';
import { hasFinanceNavPermission } from '@nfc/shared';
import { apiFetch } from '@/lib/api';
import { FinanceChrome } from './FinanceChrome';

export const dynamic = 'force-dynamic';

export default async function FinanceLayout({ children }: { children: ReactNode }) {
  const me = await apiFetch<MeView>('/api/me');
  if (!hasFinanceNavPermission(me.permissions)) redirect('/forbidden');
  const context = await apiFetch<FinanceContextView>('/api/finance/context');

  return (
    <>
      <Suspense fallback={null}>
        <FinanceChrome context={context} />
      </Suspense>
      {children}
    </>
  );
}
