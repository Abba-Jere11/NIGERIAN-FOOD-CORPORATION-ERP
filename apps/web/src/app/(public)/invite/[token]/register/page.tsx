import type { StaffInvitePreview } from '@nfc/shared';
import { ApiError, apiFetch } from '@/lib/api';
import { RegisterForm } from './RegisterForm';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Register — NFC' };

export default async function RegisterPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  let preview: StaffInvitePreview | null = null;
  let problem: string | null = null;
  try {
    preview = await apiFetch<StaffInvitePreview>(`/api/public/invites/${encodeURIComponent(token)}`);
  } catch (error) {
    problem = error instanceof ApiError ? error.message : 'This invite link is not valid.';
  }

  return (
    <>
      <h1 className="text-xl font-semibold text-ink-900">Create your sign-in</h1>
      {problem ? <p className="mt-3 text-[13px] text-danger-800">{problem}</p> : null}
      {preview ? <RegisterForm token={token} preview={preview} /> : null}
    </>
  );
}
