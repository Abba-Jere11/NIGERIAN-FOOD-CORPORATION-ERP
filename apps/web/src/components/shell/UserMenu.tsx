'use client';

import Link from 'next/link';
import { useState } from 'react';
import type { MeView } from '@nfc/shared';
import { logoutAction } from '@/lib/auth-actions';

export function UserMenu({ me }: { me: MeView }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <button
        type="button"
        className="flex items-center gap-2 border border-white/20 bg-accent-800 px-2 py-1 text-left text-white"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="block leading-tight">
          <span className="block text-[12px] font-medium">{me.name}</span>
          <span className="block text-[10px] text-white/70">{me.roleShortName ?? me.position}</span>
        </span>
      </button>
      {open ? (
        <div
          role="menu"
          className="absolute right-0 z-40 mt-1 w-52 border border-ink-200 bg-surface py-1 shadow-lg"
        >
          <Link
            href="/account/profile"
            className="block px-3 py-1.5 text-[13px] text-ink-800 hover:bg-ink-100"
            onClick={() => setOpen(false)}
          >
            Profile
          </Link>
          <Link
            href="/account/sessions"
            className="block px-3 py-1.5 text-[13px] text-ink-800 hover:bg-ink-100"
            onClick={() => setOpen(false)}
          >
            Sessions
          </Link>
          <Link
            href="/account/security"
            className="block px-3 py-1.5 text-[13px] text-ink-800 hover:bg-ink-100"
            onClick={() => setOpen(false)}
          >
            Security
          </Link>
          <form action={logoutAction}>
            <button
              type="submit"
              className="block w-full px-3 py-1.5 text-left text-[13px] text-ink-800 hover:bg-ink-100"
            >
              Sign out
            </button>
          </form>
        </div>
      ) : null}
    </div>
  );
}
