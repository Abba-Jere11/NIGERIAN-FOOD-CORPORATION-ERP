'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { PermissionKey } from '@nfc/shared';
import { cx } from '@/lib/cx';

export interface NavItem {
  href: string;
  label: string;
  description: string;
  permission: PermissionKey | null;
}

/**
 * Module navigation, filtered to what this role can enter (A8b).
 *
 * The filtering is cosmetic. Every endpoint behind these links independently
 * checks the permission server-side, so a hand-typed URL is refused rather than
 * merely hidden (rule R4).
 */
export function SideNav({
  items,
  permissions,
}: {
  items: NavItem[];
  permissions: readonly PermissionKey[];
}) {
  const pathname = usePathname() ?? '/';
  const visible = items.filter(
    (item) => item.permission === null || permissions.includes(item.permission),
  );

  return (
    <nav
      aria-label="Modules"
      className="no-print shrink-0 border-b border-ink-200 bg-surface md:w-56 md:border-b-0 md:border-r"
    >
      <ul className="flex overflow-x-auto md:flex-col md:overflow-visible">
        {visible.map((item) => {
          const active = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
          return (
            <li key={item.href} className="flex-1">
              <Link
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={cx(
                  'block whitespace-nowrap border-l-2 px-3 py-2.5 md:whitespace-normal',
                  active
                    ? 'border-accent-700 bg-accent-50 text-accent-900'
                    : 'border-transparent text-ink-700 hover:bg-ink-100',
                )}
              >
                <span className="block text-[13px] font-medium">{item.label}</span>
                <span className="hidden text-[11px] text-ink-500 md:block">{item.description}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
