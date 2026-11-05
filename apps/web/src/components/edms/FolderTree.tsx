'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import type { EdmsFolderNodeView } from '@nfc/shared';
import { cx } from '@/lib/cx';

function collectAncestorIds(
  nodes: EdmsFolderNodeView[],
  selectedId: string | null,
  trail: string[] = [],
): string[] | null {
  for (const node of nodes) {
    if (node.id === selectedId) return trail;
    const found = collectAncestorIds(node.children, selectedId, [...trail, node.id]);
    if (found) return found;
  }
  return null;
}

function FolderIcon({ open, empty }: { open: boolean; empty: boolean }) {
  if (empty) {
    return (
      <svg className="h-3.5 w-3.5 shrink-0 text-ink-400" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
        <path d="M1.5 3.5A1.5 1.5 0 0 1 3 2h3.5l1 1.5H13A1.5 1.5 0 0 1 14.5 5v7A1.5 1.5 0 0 1 13 13.5H3A1.5 1.5 0 0 1 1.5 12V3.5z" />
      </svg>
    );
  }
  return open ? (
    <svg className="h-3.5 w-3.5 shrink-0 text-accent-700" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
      <path d="M1.5 4A1.5 1.5 0 0 1 3 2.5h3.2L7.5 4H13A1.5 1.5 0 0 1 14.5 5.5V6H2v6.5A1.5 1.5 0 0 0 3.5 14h9A1.5 1.5 0 0 0 14 12.5V8.2l1.2-.8V12.5A2.5 2.5 0 0 1 12.5 15h-9A2.5 2.5 0 0 1 1 12.5V4zm1 1h11V5.5a.5.5 0 0 0-.5-.5H7.2L5.9 3.5H3a.5.5 0 0 0-.5.5V5z" />
    </svg>
  ) : (
    <svg className="h-3.5 w-3.5 shrink-0 text-ink-500" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
      <path d="M1.5 3.5A1.5 1.5 0 0 1 3 2h3.5l1 1.5H13A1.5 1.5 0 0 1 14.5 5v7A1.5 1.5 0 0 1 13 13.5H3A1.5 1.5 0 0 1 1.5 12V3.5zM3 3a.5.5 0 0 0-.5.5V12a.5.5 0 0 0 .5.5h10a.5.5 0 0 0 .5-.5V5a.5.5 0 0 0-.5-.5H7.2L6 3H3z" />
    </svg>
  );
}

function TreeNode({
  node,
  code,
  depth,
  selectedId,
  expanded,
  onToggle,
}: {
  node: EdmsFolderNodeView;
  code: string;
  depth: number;
  selectedId: string | null;
  expanded: Set<string>;
  onToggle: (id: string) => void;
}) {
  const hasChildren = node.children.length > 0;
  const isOpen = expanded.has(node.id);
  const selected = node.id === selectedId;

  return (
    <li>
      <div
        className={cx(
          'group flex items-center gap-0.5 rounded-sm py-0.5 pr-1 text-[13px]',
          selected ? 'bg-accent-100 text-accent-900' : 'text-ink-800 hover:bg-ink-100',
        )}
        style={{ paddingLeft: 6 + depth * 12 }}
      >
        {hasChildren ? (
          <button
            type="button"
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-sm text-ink-500 hover:bg-ink-200 hover:text-ink-800"
            aria-expanded={isOpen}
            aria-label={isOpen ? `Collapse ${node.name}` : `Expand ${node.name}`}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onToggle(node.id);
            }}
          >
            <svg
              className={cx('h-3 w-3 transition-transform', isOpen && 'rotate-90')}
              viewBox="0 0 12 12"
              fill="currentColor"
              aria-hidden
            >
              <path d="M4.2 2.2a.75.75 0 0 1 1.06 0l3.5 3.5a.75.75 0 0 1 0 1.06l-3.5 3.5A.75.75 0 0 1 4.2 9.2L7.14 6 4.2 3.06a.75.75 0 0 1 0-.86z" />
            </svg>
          </button>
        ) : (
          <span className="inline-block w-6 shrink-0" aria-hidden />
        )}
        <Link
          href={`/edms/${code}/folders/${node.id}`}
          className="flex min-w-0 flex-1 items-center gap-1.5 rounded-sm px-1 py-0.5"
          aria-current={selected ? 'page' : undefined}
        >
          <FolderIcon open={isOpen && hasChildren} empty={!hasChildren} />
          <span className="truncate font-medium">{node.name}</span>
          {node.documentCount > 0 ? (
            <span className="ml-auto shrink-0 tabular-nums text-[11px] text-ink-400">{node.documentCount}</span>
          ) : null}
        </Link>
      </div>
      {hasChildren && isOpen ? (
        <ul className="m-0 list-none p-0">
          {node.children.map((child) => (
            <TreeNode
              key={child.id}
              node={child}
              code={code}
              depth={depth + 1}
              selectedId={selectedId}
              expanded={expanded}
              onToggle={onToggle}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

export function FolderTree({
  roots,
  code,
  selectedId,
}: {
  roots: EdmsFolderNodeView[];
  code: string;
  selectedId: string | null;
}) {
  const ancestorIds = useMemo(
    () => collectAncestorIds(roots, selectedId) ?? [],
    [roots, selectedId],
  );
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(ancestorIds));

  useEffect(() => {
    if (ancestorIds.length === 0) return;
    setExpanded((prev) => {
      const next = new Set(prev);
      for (const id of ancestorIds) next.add(id);
      return next;
    });
  }, [ancestorIds]);

  function onToggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  if (roots.length === 0) {
    return <p className="px-3 py-4 text-[13px] text-ink-500">No folders in this space yet.</p>;
  }

  return (
    <ul className="m-0 list-none space-y-0.5 p-1" role="tree" aria-label="Folders">
      {roots.map((node) => (
        <TreeNode
          key={node.id}
          node={node}
          code={code}
          depth={0}
          selectedId={selectedId}
          expanded={expanded}
          onToggle={onToggle}
        />
      ))}
    </ul>
  );
}
