import type { MeView } from '@nfc/shared';
import { redirect } from 'next/navigation';
import { apiFetch } from '@/lib/api';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'New procurement — NFC' };

export default async function NewProcurementPage() {
  const me = await apiFetch<MeView>('/api/me');
  if (me.permissions.includes('requisition.create')) redirect('/requisitions/new');
  redirect('/forbidden');
}
