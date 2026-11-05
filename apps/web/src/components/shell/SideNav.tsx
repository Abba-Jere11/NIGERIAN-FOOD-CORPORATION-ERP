'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { PermissionKey } from '@nfc/shared';
import { cx } from '@/lib/cx';

export interface NavChild {
  href: string;
  label: string;
  group?: string;
  permission?: PermissionKey | readonly PermissionKey[] | null;
}

export interface NavItem {
  href: string;
  label: string;
  description: string;
  permission: PermissionKey | readonly PermissionKey[] | null;
  children?: NavChild[];
  exact?: boolean;
  badge?: number;
}

function childActive(pathname: string, href: string): boolean {
  if (href === '/finance') return pathname === '/finance';
  if (href === '/inventory') return pathname === '/inventory';
  if (href === '/inventory/sales') {
    return (
      pathname === '/inventory/sales' ||
      (pathname.startsWith('/inventory/sales/') &&
        !pathname.startsWith('/inventory/sales/dispatches') &&
        !pathname.startsWith('/inventory/sales/invoices'))
    );
  }
  if (href === '/reports') {
    return (
      pathname === '/reports' ||
      pathname.startsWith('/reports/') ||
      pathname.startsWith('/procurement/reports') ||
      pathname.startsWith('/finance/reports')
    );
  }
  if (href === '/finance/reports') {
    return (
      pathname === '/finance/reports' ||
      (pathname.startsWith('/finance/reports/') && !pathname.startsWith('/finance/reports/integrity'))
    );
  }
  if (href === '/finance/reports/integrity') {
    return pathname === href || pathname.startsWith(`${href}/`);
  }
  if (href === '/me') return pathname === '/me';
  if (href === '/org-reports') return pathname === '/org-reports';
  if (href === '/org-reports/minutes') {
    return (
      pathname === '/org-reports/minutes' ||
      (pathname.startsWith('/org-reports/minutes/') && !pathname.startsWith('/org-reports/minutes/issued'))
    );
  }
  if (href === '/org-reports/responses') return pathname === '/org-reports/responses';
  return pathname === href || pathname.startsWith(`${href}/`);
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
  const visible = items.filter((item) => {
    if (item.permission === null) return true;
    const keys = Array.isArray(item.permission) ? item.permission : [item.permission];
    return keys.some((key) => permissions.includes(key));
  });

  return (
    <nav
      aria-label="Modules"
      className="no-print shrink-0 border-b border-ink-200 bg-surface md:w-56 md:border-b-0 md:border-r"
    >
      <ul className="flex overflow-x-auto md:flex-col md:overflow-visible">
        {visible.map((item) => {
          const active =
            pathname === item.href ||
            (!item.exact && item.href !== '/' && pathname.startsWith(`${item.href}/`)) ||
            (item.href === '/finance' && pathname.startsWith('/finance')) ||
            (item.href === '/inventory' && pathname.startsWith('/inventory')) ||
            (item.href === '/home/hr' && pathname.startsWith('/hr'));
          return (
            <li key={`${item.label}:${item.href}`} className="flex-1">
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
                <span className="flex items-center gap-2 text-[13px] font-medium">
                  {item.label}
                  {item.badge && item.badge > 0 ? (
                    <span className="rounded-sm bg-accent-700 px-1.5 text-[11px] text-white">{item.badge}</span>
                  ) : null}
                </span>
                <span className="hidden text-[11px] text-ink-500 md:block">{item.description}</span>
              </Link>
              {item.children && active ? (
                <ul className="hidden pb-2 md:block">
                  {item.children
                    .filter((child) => {
                      if (!child.permission) return true;
                      const keys = Array.isArray(child.permission) ? child.permission : [child.permission];
                      return keys.some((key) => permissions.includes(key));
                    })
                    .map((child, index, visibleChildren) => {
                    const prevGroup = index > 0 ? visibleChildren[index - 1]?.group : undefined;
                    const showGroup = Boolean(child.group && child.group !== prevGroup);
                    const isChildActive = childActive(pathname, child.href);
                    return (
                      <li key={`${child.label}:${child.group ?? ''}:${child.href}`}>
                        {showGroup ? (
                          <p className="px-5 pt-2 pb-0.5 text-[10px] font-semibold uppercase tracking-wider text-ink-500">
                            {child.group}
                          </p>
                        ) : null}
                        <Link
                          href={child.href}
                          className={cx(
                            'block px-5 py-1 text-[12px]',
                            isChildActive ? 'font-medium text-accent-800' : 'text-ink-600 hover:text-ink-900',
                          )}
                        >
                          {child.label}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              ) : null}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
