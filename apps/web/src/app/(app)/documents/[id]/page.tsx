import type { DocumentView, DownloadUrlView, MeView } from '@nfc/shared';
import { formatLagosDateTime } from '@nfc/shared';
import { notFound } from 'next/navigation';
import { VersionHistoryDrawer } from '@/components/documents/VersionHistoryDrawer';
import { ButtonLink } from '@/components/ui/Button';
import { PageHeader, Surface, SurfaceHeader } from '@/components/ui/Surface';
import { apiFetch, ApiError, apiUrl } from '@/lib/api';
import { ReplaceForm } from './ReplaceForm';

export const dynamic = 'force-dynamic';

export default async function DocumentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let document: DocumentView;
  try {
    document = await apiFetch<DocumentView>(`/api/documents/${id}`);
  } catch (error) {
    if (error instanceof ApiError && (error.status === 404 || error.status === 403)) notFound();
    throw error;
  }
  const me = await apiFetch<MeView>('/api/me');
  const download = await apiFetch<DownloadUrlView>(`/api/documents/${id}/download-url`, {
    method: 'POST',
    body: {},
  });
  const previewUrl = apiUrl(download.url);
  const canReplace = me.permissions.includes('document.replace');
  const current = document.currentVersion;

  return (
    <>
      <PageHeader
        eyebrow="Document"
        title={document.referenceNumber}
        description={document.title}
        actions={
          <div className="flex flex-wrap gap-2">
            <ButtonLink href={previewUrl} variant="secondary">
              Download
            </ButtonLink>
            <VersionHistoryDrawer title={current.originalFilename} versions={document.versions} />
          </div>
        }
      />
      <Surface className="mb-4">
        <SurfaceHeader
          title={`${current.originalFilename} — Version ${current.versionNumber}`}
          description={`${current.mimeType} · ${current.uploadedByName} · ${formatLagosDateTime(current.uploadedAt)}`}
        />
        <div className="px-4 py-3">
          {current.mimeType.startsWith('image/') ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={previewUrl} alt={current.originalFilename} className="max-h-[32rem] border border-ink-200" />
          ) : current.mimeType === 'application/pdf' ? (
            <iframe title={current.originalFilename} src={previewUrl} className="h-[32rem] w-full border border-ink-200" />
          ) : (
            <p className="text-[13px] text-ink-600">Preview is available for PDF and images.</p>
          )}
        </div>
      </Surface>
      {canReplace ? (
        <Surface>
          <SurfaceHeader title="Replace" description="Creates the next version. The current file stays." />
          <div className="px-4 py-3">
            <ReplaceForm documentId={id} />
          </div>
        </Surface>
      ) : null}
    </>
  );
}
