'use client';

import { Suspense, useEffect, useMemo, useState, type ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import type { EdmsGatewayEntityView, EdmsTreeView } from '@nfc/shared';
import { Button, ButtonLink } from '@/components/ui/Button';
import { EntitySwitcher } from '@/app/(edms)/edms/(portal)/EntitySwitcher';
import { SearchForm } from '@/app/(edms)/edms/(portal)/SearchForm';
import { cx } from '@/lib/cx';
import { FolderTree } from './FolderTree';

export type EdmsSpace = 'active' | 'archived';

function spaceFromPath(
  tree: EdmsTreeView,
  folderId: string | null,
): EdmsSpace {
  if (!folderId) return 'active';
  const inTree = (node: typeof tree.active, id: string): boolean => {
    if (!node) return false;
    if (node.id === id) return true;
    return node.children.some((child) => inTree(child, id));
  };
  if (inTree(tree.archived, folderId)) return 'archived';
  return 'active';
}

function folderIdFromPath(pathname: string, code: string): string | null {
  const prefix = `/edms/${code}/folders/`;
  if (!pathname.startsWith(prefix)) return null;
  const id = pathname.slice(prefix.length).split('/')[0];
  return id || null;
}

export function EdmsWorkspace({
  code,
  tree,
  entities,
  canUpload,
  canSearchAll,
  children,
}: {
  code: string;
  tree: EdmsTreeView;
  entities: EdmsGatewayEntityView[];
  canUpload: boolean;
  canSearchAll: boolean;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const selectedId = folderIdFromPath(pathname, code);
  const inferred = spaceFromPath(tree, selectedId);
  const [space, setSpace] = useState<EdmsSpace>(inferred);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    setSpace(inferred);
  }, [inferred]);

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  const roots = useMemo(() => {
    const root = space === 'archived' ? tree.archived : tree.active;
    return root?.children ?? [];
  }, [space, tree.active, tree.archived]);

  const readOnly = space === 'archived';

  function switchSpace(next: EdmsSpace) {
    setSpace(next);
    if (selectedId && spaceFromPath(tree, selectedId) !== next) {
      router.push(`/edms/${code}`);
    }
  }

  const sidebar = (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between border-b border-ink-200 px-3 py-2">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-500">Folders</p>
        <button
          type="button"
          className="hidden text-[12px] text-ink-500 hover:text-ink-800 lg:inline"
          onClick={() => setSidebarOpen(false)}
        >
          Collapse
        </button>
        <button
          type="button"
          className="text-[12px] text-ink-500 hover:text-ink-800 lg:hidden"
          onClick={() => setMobileOpen(false)}
        >
          Close
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto py-1">
        <FolderTree roots={roots} code={code} selectedId={selectedId} />
      </div>
    </div>
  );

  return (
    <div className="flex min-h-[calc(100vh-4.5rem)] flex-col gap-3">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-ink-200 pb-3">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-500">
            {tree.entityCode}
          </p>
          <h1 className="truncate text-lg font-semibold text-ink-900">{tree.entityName}</h1>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <EntitySwitcher entities={entities} current={code} />
          <Suspense fallback={null}>
            <SearchForm entityCode={code} canSearchAll={canSearchAll} />
          </Suspense>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant="subtle"
          className="lg:hidden"
          onClick={() => setMobileOpen(true)}
        >
          Folders
        </Button>
        {!sidebarOpen ? (
          <Button type="button" size="sm" variant="subtle" className="hidden lg:inline-flex" onClick={() => setSidebarOpen(true)}>
            Show folders
          </Button>
        ) : null}
        <div
          className="inline-flex rounded-sm border border-ink-200 bg-surface p-0.5"
          role="tablist"
          aria-label="Document space"
        >
          {([
            ['active', 'Active'],
            ['archived', 'Archived'],
          ] as const).map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={space === value}
              className={cx(
                'rounded-sm px-3 py-1 text-[13px] font-medium transition-colors',
                space === value
                  ? 'bg-accent-700 text-white'
                  : 'text-ink-600 hover:bg-ink-100 hover:text-ink-900',
              )}
              onClick={() => switchSpace(value)}
            >
              {label}
            </button>
          ))}
        </div>
        {readOnly ? (
          <span className="text-[12px] text-ink-500">Archive is read-only</span>
        ) : null}
        {canUpload && !readOnly ? (
          <ButtonLink
            href={`/edms/upload?entityId=${tree.entityId}${selectedId ? `&folderId=${selectedId}` : ''}`}
            size="sm"
            className="ml-auto"
          >
            Upload document
          </ButtonLink>
        ) : null}
      </div>

      <div className="relative flex min-h-0 flex-1 gap-0 border border-ink-200 bg-surface">
        {sidebarOpen ? (
          <aside className="hidden w-64 shrink-0 border-r border-ink-200 bg-ink-50/60 lg:block xl:w-72">
            {sidebar}
          </aside>
        ) : null}

        {mobileOpen ? (
          <div className="absolute inset-0 z-20 flex lg:hidden">
            <button
              type="button"
              className="absolute inset-0 bg-ink-900/30"
              aria-label="Close folders"
              onClick={() => setMobileOpen(false)}
            />
            <aside className="relative z-10 flex h-full w-[min(18rem,85vw)] flex-col border-r border-ink-200 bg-surface shadow-md">
              {sidebar}
            </aside>
          </div>
        ) : null}

        <div className="min-w-0 flex-1 overflow-x-auto bg-surface">{children}</div>
      </div>
    </div>
  );
}
