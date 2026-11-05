import { redirect } from 'next/navigation';
import type { MeView } from '@nfc/shared';
import { apiFetch } from '@/lib/api';

export const dynamic = 'force-dynamic';

export default async function IndexPage() {
  await apiFetch<MeView>('/api/me');
  redirect('/home');
}
