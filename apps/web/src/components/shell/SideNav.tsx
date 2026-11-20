'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { PermissionKey } from '@nfc/shared';
import { cx } from '@/lib/cx';
import { useFormDirty } from './FormDirty';

export interface NavChild {
  href: string;
  label: string;
  group?: string;
  permission?: PermissionKey | readonly PermissionKey[] | null;
}

export interface NavItem {
  id: string;
  href: string;
  label: string;
  description: string;
  permission: PermissionKey | readonly PermissionKey[] | null;
  children?: NavChild[];
  exact?: boolean;
  badge?: number;
}

function permitted(
  permission: PermissionKey | readonly PermissionKey[] | null | undefined,
  permissions: readonly PermissionKey[],
): boolean {
  if (permission == null) return true;
  const keys = Array.isArray(permission) ? permission : [permission];
  return keys.some((key) => permissions.includes(key));
}

export function childActive(pathname: string, href: string): boolean {
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
      pathname.startsWith('/finance/reports') ||
      pathname.startsWith('/inventory/reports') ||
      pathname.startsWith('/hr/reports')
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
  if (href === '/home') return pathname === '/home';
  if (href === '/org-reports') return pathname === '/org-reports';
  if (href === '/org-reports/minutes') {
    return (
      pathname === '/org-reports/minutes' ||
      (pathname.startsWith('/org-reports/minutes/') && !pathname.startsWith('/org-reports/minutes/issued'))
    );
  }
  if (href === '/org-reports/responses') return pathname === '/org-reports/responses';
  if (href === '/admin/users') return pathname === '/admin/users' || pathname.startsWith('/admin/users/');
  return pathname === href || pathname.startsWith(`${href}/`);
}

function owningModule(pathname: string, items: NavItem[]): NavItem | undefined {
  return items.find((item) => item.children?.some((child) => childActive(pathname, child.href))) ?? items[0];
}

function ModuleIcon({ id }: { id: string }) {
  const common = { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8 };
  switch (id) {
    case 'home':
      return (
        <svg {...common} aria-hidden="true">
          <path d="M4 11.5 12 5l8 6.5V20a1 1 0 0 1-1 1h-5v-6H10v6H5a1 1 0 0 1-1-1z" />
        </svg>
      );
    case 'procurement':
      return (
        <svg {...common} aria-hidden="true">
          <path d="M6 7h12l-1 12H7L6 7z" />
          <path d="M9 7V5a3 3 0 0 1 6 0v2" />
        </svg>
      );
    case 'inventory':
      return (
        <svg {...common} aria-hidden="true">
          <path d="M4 8h16v11H4zM4 8l8-4 8 4" />
        </svg>
      );
    case 'finance':
      return (
        <svg {...common} aria-hidden="true">
          <path d="M4 19h16M7 16V9m5 7V6m5 10v-5" />
        </svg>
      );
    case 'workspace':
      return (
        <svg {...common} aria-hidden="true">
          <path d="M8 20V10l4-3 4 3v10" />
          <path d="M5 20h14" />
        </svg>
      );
    case 'reports':
      return (
        <svg {...common} aria-hidden="true">
          <path d="M7 4h8l4 4v12H7z" />
          <path d="M11 12h6M11 16h6" />
        </svg>
      );
    default:
      return (
        <svg {...common} aria-hidden="true">
          <path d="M5 7h14M5 12h14M5 17h14" />
        </svg>
      );
  }
}

/**
 * Two-level IMS navigation: a fixed primary rail and a secondary page panel.
 * Module click explores the panel without navigating. Page click navigates.
 */
export function SideNav({
  items,
  permissions,
}: {
  items: NavItem[];
  permissions: readonly PermissionKey[];
}) {
  const pathname = usePathname() ?? '/';
  const dirty = useFormDirty();
  const visible = items.filter((item) => permitted(item.permission, permissions) && (item.children?.length ?? 0) > 0);
  const owned = owningModule(pathname, visible);
  const [browsedId, setBrowsedId] = useState(owned?.id ?? visible[0]?.id);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [mobilePages, setMobilePages] = useState(false);

  useEffect(() => {
    if (owned?.id) setBrowsedId(owned.id);
  }, [owned?.id]);

  const browsed = useMemo(
    () => visible.find((item) => item.id === browsedId) ?? owned ?? visible[0],
    [browsedId, owned, visible],
  );

  const panelChildren = (browsed?.children ?? []).filter((child) => permitted(child.permission, permissions));

  function confirmLeave(): boolean {
    if (!dirty) return true;
    return window.confirm('You have unsaved changes. Leave this form?');
  }

  function explore(item: NavItem) {
    setBrowsedId(item.id);
    setMobilePages(true);
  }

  const rail = (
    <ul className="flex md:flex-col">
      {visible.map((item) => {
        const selected = browsed?.id === item.id;
        return (
          <li key={item.id}>
            <button
              type="button"
              aria-current={selected ? 'true' : undefined}
              onClick={() => explore(item)}
              className={cx(
                'flex w-full items-center gap-2 px-3 py-3 text-left text-[12px] font-medium md:min-h-[44px]',
                selected ? 'bg-accent-700 text-white' : 'text-ink-700 hover:bg-ink-100',
              )}
            >
              <ModuleIcon id={item.id} />
              <span className="truncate">{item.label}</span>
              {item.badge && item.badge > 0 ? (
                <span className="ml-auto rounded-sm bg-accent-700 px-1.5 text-[11px] text-white">{item.badge}</span>
              ) : null}
            </button>
          </li>
        );
      })}
    </ul>
  );

  const panel = (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between border-b border-ink-200 px-3 py-2">
        {mobilePages ? (
          <button type="button" className="text-[13px] underline md:hidden" onClick={() => setMobilePages(false)}>
            Back
          </button>
        ) : null}
        <p className="text-[13px] font-semibold text-ink-900">{browsed?.label}</p>
      </div>
      <ul className="min-h-0 flex-1 overflow-y-auto pb-4">
        {panelChildren.map((child, index) => {
          const prevGroup = index > 0 ? panelChildren[index - 1]?.group : undefined;
          const showGroup = Boolean(child.group && child.group !== prevGroup);
          const isChildActive = browsed?.id === owned?.id && childActive(pathname, child.href);
          return (
            <li key={`${child.label}:${child.group ?? ''}:${child.href}`}>
              {showGroup ? (
                <p className="px-3 pt-3 pb-0.5 text-[10px] font-semibold uppercase tracking-wider text-ink-500">
                  {child.group}
                </p>
              ) : null}
              <Link
                href={child.href}
                aria-current={isChildActive ? 'page' : undefined}
                onClick={(event) => {
                  if (!confirmLeave()) {
                    event.preventDefault();
                    return;
                  }
                  setMobileOpen(false);
                  setMobilePages(false);
                }}
                className={cx(
                  'block min-h-[44px] px-3 py-2 text-[13px]',
                  isChildActive ? 'bg-accent-50 font-medium text-accent-900' : 'text-ink-700 hover:bg-ink-100',
                )}
              >
                {child.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );

  return (
    <>
      <button
        type="button"
        className="no-print m-2 min-h-[44px] border border-ink-300 px-3 text-[13px] md:hidden"
        onClick={() => {
          setMobileOpen(true);
          setMobilePages(false);
        }}
      >
        Menu
      </button>
      {mobileOpen ? (
        <div className="fixed inset-0 z-40 md:hidden">
          <button type="button" className="absolute inset-0 bg-ink-900/40" aria-label="Close menu" onClick={() => setMobileOpen(false)} />
          <nav aria-label="Modules" className="absolute inset-y-0 left-0 flex w-[86%] max-w-sm bg-surface shadow-lg">
            <div className={cx('w-full overflow-y-auto', mobilePages ? 'hidden' : 'block')}>{rail}</div>
            <div className={cx('w-full', mobilePages ? 'block' : 'hidden')}>{panel}</div>
          </nav>
        </div>
      ) : null}
      <nav
        aria-label="Modules"
        className="no-print hidden shrink-0 md:flex md:h-full md:min-h-0"
      >
        <div className="w-[7.5rem] overflow-y-auto border-r border-ink-200 bg-surface">{rail}</div>
        <div className="w-56 overflow-hidden border-r border-ink-200 bg-surface">{panel}</div>
      </nav>
    </>
  );
}
