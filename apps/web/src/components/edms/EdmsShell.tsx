import type { ReactNode } from 'react';
import Link from 'next/link';
import type { MeView } from '@nfc/shared';
import { ORGANIZATION_NAME } from '@nfc/shared';
import { NfcLogo } from '@/components/brand/NfcLogo';
import { logoutEdmsAction } from '@/lib/auth-actions';

export function EdmsShell({
  me,
  children,
}: {
  me: MeView;
  children: ReactNode;
}) {
  const canUpload = me.permissions.includes('edms.upload');
  const canAdmin =
    me.permissions.includes('edms.manage_categories') || me.permissions.includes('edms.manage_retention');

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-accent-900 bg-accent-700">
        <div className="mx-auto flex max-w-[1400px] items-center gap-3 px-4 py-2">
          <Link href="/edms" className="flex shrink-0 items-center gap-2 leading-tight">
            <NfcLogo size="sm" className="rounded-full bg-white/95 p-0.5" />
            <span>
              <span className="block text-[13px] font-semibold uppercase tracking-wide text-white">
                {ORGANIZATION_NAME}
              </span>
              <span className="block text-[10px] uppercase tracking-wider text-white/70">Document Portal</span>
            </span>
          </Link>
          <nav className="ml-4 hidden items-center gap-1 text-[13px] text-white sm:flex" aria-label="Portal">
            <Link href="/edms" className="rounded-sm px-2 py-1 hover:bg-accent-800">
              Gateway
            </Link>
            {canUpload ? (
              <Link href="/edms/upload" className="rounded-sm px-2 py-1 hover:bg-accent-800">
                Upload
              </Link>
            ) : null}
            {canAdmin ? (
              <Link href="/edms/admin" className="rounded-sm px-2 py-1 hover:bg-accent-800">
                Admin
              </Link>
            ) : null}
          </nav>
          <div className="ml-auto flex items-center gap-3 text-white">
            <span className="hidden text-right leading-tight sm:block">
              <span className="block text-[12px] font-medium">{me.name}</span>
              <span className="block text-[10px] text-white/70">{me.roleShortName ?? me.position}</span>
            </span>
            <form action={logoutEdmsAction}>
              <button type="submit" className="border border-white/20 px-2 py-1 text-[12px] hover:bg-accent-800">
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-[1400px] px-4 py-5">{children}</main>
    </div>
  );
}

export function EdmsDenied() {
  return (
    <main className="mx-auto max-w-lg px-4 py-16">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-500">Document Portal</p>
      <h1 className="mt-1 text-xl font-semibold text-ink-900">You do not have access to the Document Portal</h1>
      <p className="mt-3 text-[13px] text-ink-600">
        Your sign-in succeeded. This portal is limited to the roles that may enter the archive. Continue in the
        internal management system to view files attached to a request.
      </p>
      <p className="mt-6">
        <a href="/" className="text-[13px] underline">
          Go to your home
        </a>
      </p>
    </main>
  );
}
