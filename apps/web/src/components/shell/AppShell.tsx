import type { ReactNode } from 'react';
import Link from 'next/link';
import type { DevActorSummaryView, MeView } from '@nfc/shared';
import { ORGANIZATION_NAME } from '@nfc/shared';
import { ActorSwitcher } from './ActorSwitcher';
import { SideNav, type NavItem } from './SideNav';

/**
 * The application shell (M1 item 6).
 *
 * The top bar is identical on every screen: organisation identity, global search,
 * the notification bell and the user menu. The search box and bell are
 * deliberately inert in M1 - M3 builds the global search service and the
 * notification engine behind them, and pretending otherwise would be a fake
 * feature of exactly the kind A8 rules out.
 */
const NAV_ITEMS: NavItem[] = [
  { href: '/', label: 'Home', description: 'Pending actions and subsidiaries', permission: null },
  {
    href: '/admin/entities',
    label: 'Organisation',
    description: 'Subsidiaries and departments',
    permission: 'organization.view',
  },
  {
    href: '/audit',
    label: 'Audit log',
    description: 'Every action, with its reason',
    permission: 'audit.view',
  },
  { href: '/design', label: 'Design system', description: 'Component reference', permission: null },
];

export function AppShell({
  me,
  actors,
  selectedActorKey,
  children,
}: {
  me: MeView;
  actors: DevActorSummaryView[];
  selectedActorKey: string;
  children: ReactNode;
}) {
  return (
    <div className="min-h-screen">
      <header className="app-top-bar sticky top-0 z-30 border-b border-accent-900 bg-accent-700">
        <div className="mx-auto flex max-w-[1400px] items-center gap-3 px-4 py-2">
          <Link href="/" className="shrink-0 leading-tight">
            <span className="block text-[13px] font-semibold uppercase tracking-wide text-white">
              {ORGANIZATION_NAME}
            </span>
            <span className="block text-[10px] uppercase tracking-wider text-white/70">
              Internal management system
            </span>
          </Link>

          <div className="mx-auto hidden w-full max-w-md md:block">
            <input
              type="search"
              disabled
              placeholder="Search reference, vendor, amount"
              aria-label="Global search (available from M3)"
              title="Global search arrives in M3."
              className="h-8 w-full border border-white/20 bg-accent-800 px-2 text-[12px] text-white placeholder:text-white/50 disabled:cursor-not-allowed"
            />
          </div>

          <button
            type="button"
            disabled
            title="Notifications arrive in M3."
            aria-label="Notifications (available from M3)"
            className="no-print hidden h-8 w-8 items-center justify-center border border-white/20 text-white/60 disabled:cursor-not-allowed sm:flex"
          >
            <span aria-hidden="true">&#9737;</span>
          </button>

          <ActorSwitcher me={me} actors={actors} selectedKey={selectedActorKey} />
        </div>
      </header>

      <div className="mx-auto flex max-w-[1400px] flex-col md:flex-row">
        <SideNav items={NAV_ITEMS} permissions={me.permissions} />
        <main className="min-w-0 flex-1 px-4 py-5">{children}</main>
      </div>
    </div>
  );
}
