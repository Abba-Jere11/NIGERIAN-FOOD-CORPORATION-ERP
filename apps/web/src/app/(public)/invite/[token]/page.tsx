import Link from 'next/link';
import type { StaffInvitePreview } from '@nfc/shared';
import { ApiError, apiFetch } from '@/lib/api';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Staff invite — NFC' };

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
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
      <h1 className="text-xl font-semibold text-ink-900">Staff invite</h1>
      {problem ? <p className="mt-3 text-[13px] text-danger-800">{problem}</p> : null}
      {preview ? (
        <div className="mt-4 space-y-2 text-[13px]">
          <p>
            {preview.firstName} {preview.lastName}
          </p>
          <p>{preview.email}</p>
          <p className="text-ink-500">This link expires {new Date(preview.expiresAt).toLocaleString()}.</p>
          <Link href={`/invite/${token}/register`} className="inline-block underline">
            Create your sign-in
          </Link>
        </div>
      ) : null}
    </>
  );
}
