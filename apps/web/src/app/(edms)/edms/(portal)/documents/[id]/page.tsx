import type {
  DownloadUrlView,
  EdmsDocumentView,
  EdmsGatewayView,
  MeView,
} from '@nfc/shared';
import { formatLagosDateTime } from '@nfc/shared';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { VersionHistoryDrawer } from '@/components/documents/VersionHistoryDrawer';
import { ButtonLink } from '@/components/ui/Button';
import { DefinitionList, PageHeader, Surface, SurfaceHeader } from '@/components/ui/Surface';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { apiFetch, ApiError, apiUrl } from '@/lib/api';
import { DocumentActions } from '../../DocumentActions';

export const dynamic = 'force-dynamic';

export default async function EdmsDocumentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await apiFetch<MeView>('/api/me');
  let document: EdmsDocumentView;
  try {
    document = await apiFetch<EdmsDocumentView>(`/api/edms/documents/${id}`);
  } catch (error) {
    if (error instanceof ApiError && (error.status === 404 || error.status === 403)) notFound();
    throw error;
  }
  const [download, gateway, targets] = await Promise.all([
    apiFetch<DownloadUrlView>(`/api/documents/${id}/download-url`, { method: 'POST', body: {} }).catch(
      () => null,
    ),
    apiFetch<EdmsGatewayView>('/api/edms/gateway'),
    apiFetch<{ users: Array<{ id: string; name: string; email: string }> }>('/api/edms/share-targets').catch(
      () => ({ users: [] }),
    ),
  ]);
  const previewUrl = download ? apiUrl(download.url) : null;
  const current = document.currentVersion;
  const folderHref =
    document.folderId && document.entityCode
      ? `/edms/${document.entityCode}/folders/${document.folderId}`
      : document.entityCode
        ? `/edms/${document.entityCode}`
        : '/edms';

  return (
    <>
      <PageHeader
        eyebrow={document.referenceNumber}
        title={document.title}
        description={
          [document.entityCode, ...document.folderPath].filter(Boolean).join(' / ') || 'Document Portal'
        }
        actions={
          <div className="flex flex-wrap gap-2">
            {previewUrl ? (
              <ButtonLink href={previewUrl} variant="secondary">
                Download
              </ButtonLink>
            ) : null}
            <ButtonLink href={folderHref} variant="subtle" size="sm">
              Open folder
            </ButtonLink>
            <VersionHistoryDrawer title={current.originalFilename} versions={document.versions} />
          </div>
        }
      />
      <Surface className="mb-4" padded={false}>
        <SurfaceHeader
          title={`${current.originalFilename} — Version ${current.versionNumber}`}
          description={`${current.mimeType} · ${current.uploadedByName} · ${formatLagosDateTime(current.uploadedAt)}`}
        />
        <div className="border-t border-ink-100 bg-ink-50/40 px-4 py-4">
          {!previewUrl ? (
            <p className="text-[13px] text-ink-600">Preview is not available for your grants.</p>
          ) : current.mimeType.startsWith('image/') ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={previewUrl}
              alt={current.originalFilename}
              className="mx-auto max-h-[36rem] border border-ink-200 bg-surface"
            />
          ) : current.mimeType === 'application/pdf' ? (
            <iframe
              title={current.originalFilename}
              src={previewUrl}
              className="h-[36rem] w-full border border-ink-200 bg-surface"
            />
          ) : (
            <p className="text-[13px] text-ink-600">
              Preview is available for PDF and images. Use Download for this file type.
            </p>
          )}
        </div>
      </Surface>
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Surface>
            <SurfaceHeader title="Metadata" />
            <div className="px-4 py-3">
              <DefinitionList
                items={[
                  { label: 'Status', value: <StatusBadge status={document.status} /> },
                  { label: 'Category', value: document.categoryName ?? document.category },
                  { label: 'Confidentiality', value: document.confidentiality },
                  { label: 'File type', value: current.mimeType },
                  {
                    label: 'Size',
                    value: `${(current.sizeBytes / 1024).toFixed(1)} KB`,
                  },
                  { label: 'Legal hold', value: document.legalHold ? 'Yes' : 'No' },
                  { label: 'Retention review', value: document.retentionReviewOn ?? '—' },
                  { label: 'Tags', value: document.tags.map((tag) => tag.name).join(', ') || '—' },
                ]}
              />
            </div>
          </Surface>
          <Surface>
            <SurfaceHeader title="Location" />
            <div className="space-y-1 px-4 py-3 text-[13px] text-ink-700">
              <p>
                Entity:{' '}
                <span className="font-medium text-ink-900">
                  {document.related.entityName ?? document.related.entityCode ?? document.entityCode ?? '—'}
                </span>
              </p>
              <p>
                Folder:{' '}
                {document.folderId ? (
                  <Link href={folderHref} className="font-medium text-accent-800 hover:underline">
                    {document.folderPath.join(' / ') || 'Open folder'}
                  </Link>
                ) : (
                  '—'
                )}
              </p>
              {document.related.procurementId && document.related.procurementReference ? (
                <p>
                  Related procurement:{' '}
                  <Link
                    href={`/procurement/${document.related.procurementId}`}
                    className="text-accent-800 hover:underline"
                  >
                    {document.related.procurementReference}
                  </Link>
                </p>
              ) : null}
            </div>
          </Surface>
          <Surface padded={false}>
            <SurfaceHeader title="Access history" />
            {document.accessLog.length === 0 ? (
              <p className="px-4 py-3 text-[13px] text-ink-600">No access recorded yet.</p>
            ) : (
              <ul className="divide-y divide-ink-100 px-4 py-2 text-[13px]">
                {document.accessLog.map((row) => (
                  <li key={row.id} className="py-2">
                    {row.action} · {row.actorName ?? row.actorRef} · {formatLagosDateTime(row.occurredAt)}
                  </li>
                ))}
              </ul>
            )}
          </Surface>
        </div>
        <Surface>
          <SurfaceHeader title="Actions" />
          <div className="px-4 py-3">
            <DocumentActions
              document={document}
              canReplace={me.permissions.includes('edms.version.replace')}
              canArchive={me.permissions.includes('edms.archive') && document.status !== 'ARCHIVED'}
              canShare={me.permissions.includes('edms.share')}
              canHold={me.permissions.includes('edms.manage_retention')}
              canRefile={me.permissions.includes('edms.refile')}
              entities={gateway.entities}
              users={targets.users}
            />
          </div>
        </Surface>
      </div>
    </>
  );
}
