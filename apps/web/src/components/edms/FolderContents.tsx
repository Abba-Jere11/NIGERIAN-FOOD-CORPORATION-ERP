'use client';

import Link from 'next/link';
import type { EdmsFolderView } from '@nfc/shared';
import { formatLagosDateTime } from '@nfc/shared';
import { DataTable, type DataTableColumn } from '@/components/ui/DataTable';
import { EmptyState } from '@/components/ui/States';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { cx } from '@/lib/cx';

type ContentRow =
  | {
      kind: 'folder';
      id: string;
      name: string;
      folderKind: string;
      documentCount: number;
      href: string;
    }
  | {
      kind: 'document';
      id: string;
      title: string;
      referenceNumber: string;
      mimeType: string;
      category: string;
      status: string;
      uploadedAt: string;
      uploadedByName: string | null;
      slot: string | null;
      href: string;
    };

function fileTypeLabel(mimeType: string, filename: string): string {
  if (mimeType === 'application/pdf') return 'PDF';
  if (mimeType.startsWith('image/')) return mimeType.replace('image/', '').toUpperCase();
  if (mimeType.includes('word')) return 'DOCX';
  const ext = filename.split('.').pop();
  return ext ? ext.toUpperCase() : mimeType;
}

function FileGlyph({ mimeType }: { mimeType: string }) {
  const label =
    mimeType === 'application/pdf' ? 'PDF' : mimeType.startsWith('image/') ? 'IMG' : 'DOC';
  return (
    <span
      className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-sm bg-ink-100 text-[9px] font-semibold text-ink-600"
      aria-hidden
    >
      {label}
    </span>
  );
}

export function FolderBreadcrumb({
  code,
  breadcrumb,
}: {
  code: string;
  breadcrumb: Array<{ id: string; name: string }>;
}) {
  return (
    <nav className="text-[13px] text-ink-600" aria-label="Breadcrumb">
      <ol className="flex flex-wrap items-center gap-1">
        <li>
          <Link href="/edms" className="hover:text-accent-800">
            Gateway
          </Link>
        </li>
        <li className="text-ink-300" aria-hidden>
          /
        </li>
        <li>
          <Link href={`/edms/${code}`} className="hover:text-accent-800">
            {code}
          </Link>
        </li>
        {breadcrumb.map((item, index) => {
          const last = index === breadcrumb.length - 1;
          return (
            <li key={item.id} className="flex items-center gap-1">
              <span className="text-ink-300" aria-hidden>
                /
              </span>
              {last ? (
                <span className="font-medium text-ink-900">{item.name}</span>
              ) : (
                <Link href={`/edms/${code}/folders/${item.id}`} className="hover:text-accent-800">
                  {item.name}
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

export function FolderContents({ folder, code }: { folder: EdmsFolderView; code: string }) {
  const rows: ContentRow[] = [
    ...folder.children.map((child) => ({
      kind: 'folder' as const,
      id: child.id,
      name: child.name,
      folderKind: child.kind,
      documentCount: child.documentCount,
      href: `/edms/${code}/folders/${child.id}`,
    })),
    ...folder.documents.map((doc) => ({
      kind: 'document' as const,
      id: doc.id,
      title: doc.slot ? `${doc.slot} · ${doc.title}` : doc.title,
      referenceNumber: doc.referenceNumber,
      mimeType: doc.mimeType,
      category: doc.category,
      status: doc.status,
      uploadedAt: doc.uploadedAt,
      uploadedByName: doc.uploadedByName,
      slot: doc.slot,
      href: `/edms/documents/${doc.id}`,
    })),
  ];

  const columns: Array<DataTableColumn<ContentRow>> = [
    {
      key: 'name',
      header: 'Name',
      sortable: true,
      value: (row) => (row.kind === 'folder' ? row.name : row.title),
      render: (row) =>
        row.kind === 'folder' ? (
          <span className="inline-flex items-center gap-2 font-medium text-ink-900">
            <span className="inline-flex h-6 w-6 items-center justify-center rounded-sm bg-accent-100 text-accent-800" aria-hidden>
              <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="currentColor">
                <path d="M1.5 3.5A1.5 1.5 0 0 1 3 2h3.5l1 1.5H13A1.5 1.5 0 0 1 14.5 5v7A1.5 1.5 0 0 1 13 13.5H3A1.5 1.5 0 0 1 1.5 12V3.5z" />
              </svg>
            </span>
            {row.name}
          </span>
        ) : (
          <span className="inline-flex items-center gap-2">
            <FileGlyph mimeType={row.mimeType} />
            <span>
              <span className="block font-medium text-ink-900">{row.title}</span>
              <span className="block text-[11px] text-ink-500">{row.referenceNumber}</span>
            </span>
          </span>
        ),
    },
    {
      key: 'type',
      header: 'Type',
      secondary: true,
      sortable: true,
      value: (row) =>
        row.kind === 'folder'
          ? row.folderKind
          : fileTypeLabel(row.mimeType, row.title),
      render: (row) =>
        row.kind === 'folder' ? (
          <span className="capitalize text-ink-600">{row.folderKind}</span>
        ) : (
          <span className="text-ink-600">{fileTypeLabel(row.mimeType, row.title)}</span>
        ),
    },
    {
      key: 'meta',
      header: 'Details',
      secondary: true,
      value: (row) =>
        row.kind === 'folder'
          ? String(row.documentCount)
          : row.uploadedByName ?? '',
      render: (row) =>
        row.kind === 'folder' ? (
          <span className="tabular-nums text-ink-600">
            {row.documentCount === 1 ? '1 document' : `${row.documentCount} documents`}
          </span>
        ) : (
          <span className="text-ink-600">
            <StatusBadge status={row.status} />
            {row.uploadedByName ? (
              <span className="mt-0.5 block text-[11px] text-ink-500">{row.uploadedByName}</span>
            ) : null}
          </span>
        ),
    },
    {
      key: 'date',
      header: 'Date',
      secondary: true,
      sortable: true,
      value: (row) => (row.kind === 'document' ? row.uploadedAt : ''),
      render: (row) =>
        row.kind === 'document' ? (
          <span className="whitespace-nowrap text-ink-600">{formatLagosDateTime(row.uploadedAt)}</span>
        ) : (
          <span className="text-ink-300">—</span>
        ),
    },
    {
      key: 'actions',
      header: '',
      width: '4rem',
      render: (row) => (
        <Link
          href={row.href}
          className={cx(
            'inline-flex h-7 items-center rounded-sm border border-ink-200 px-2 text-[12px] font-medium text-ink-700',
            'hover:border-accent-600 hover:bg-accent-50 hover:text-accent-800',
          )}
          onClick={(event) => event.stopPropagation()}
        >
          Open
        </Link>
      ),
    },
  ];

  if (rows.length === 0) {
    return (
      <EmptyState
        title="This folder is empty"
        description={
          folder.readOnly
            ? 'No archived documents are listed here.'
            : 'Upload a document or open a child folder from the tree.'
        }
      />
    );
  }

  return (
    <DataTable
      columns={columns}
      rows={rows}
      rowKey={(row) => `${row.kind}:${row.id}`}
      rowHref={(row) => row.href}
      filterable
      filterPlaceholder="Filter folders and documents"
      emptyTitle="No matching rows"
      caption={`${folder.name} contents`}
    />
  );
}
