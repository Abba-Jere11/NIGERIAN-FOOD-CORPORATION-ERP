import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import type { EdmsAccessView, MeView } from '@nfc/shared';
import { EdmsDenied, EdmsShell } from '@/components/edms/EdmsShell';
import { apiFetch, ApiError } from '@/lib/api';

export const dynamic = 'force-dynamic';

export default async function EdmsPortalLayout({ children }: { children: ReactNode }) {
  let me: MeView;
  try {
    me = await apiFetch<MeView>('/api/me');
  } catch (error) {
    if (error instanceof ApiError && error.isUnauthenticated) redirect('/edms/login');
    if (error instanceof ApiError && /password/.test(error.message)) {
      redirect('/login/change-password');
    }
    if (error instanceof ApiError && /authenticator|enrol/.test(error.message)) {
      redirect('/login/mfa-enrol');
    }
    throw error;
  }
  if (me.mustChangePassword) redirect('/login/change-password');
  if (me.mfaRequired) redirect('/login/mfa-enrol');

  const access = await apiFetch<EdmsAccessView>('/api/edms/access');
  if (!access.allowed) return <EdmsDenied />;

  return <EdmsShell me={me}>{children}</EdmsShell>;
}
