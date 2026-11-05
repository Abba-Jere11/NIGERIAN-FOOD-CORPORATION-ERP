import type { DocumentListItemView, MeView } from '@nfc/shared';
import { formatLagosDateTime } from '@nfc/shared';
import Link from 'next/link';
import { DocumentUploader } from '@/components/documents/DocumentUploader';
import { PageHeader, Surface, SurfaceHeader } from '@/components/ui/Surface';
import { EmptyState } from '@/components/ui/States';
import { apiFetch } from '@/lib/api';
import { uploadDocumentAction } from './actions';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Documents — NFC' };

export default async function DocumentsPage() {
  const me = await apiFetch<MeView>('/api/me');
  const rows = await apiFetch<DocumentListItemView[]>('/api/documents');
  const canUpload = me.permissions.includes('document.upload');

  return (
    <>
      <PageHeader
        eyebrow="Shared services"
        title="Documents"
        description="Encrypted at rest. Replacement creates a new version with a reason. Earlier versions stay."
      />
      {canUpload ? (
        <Surface className="mb-4">
          <SurfaceHeader title="Upload" description="PDF, JPEG or PNG. The file is encrypted before it is stored." />
          <div className="px-4 py-3">
            <DocumentUploader action={uploadDocumentAction} />
          </div>
        </Surface>
      ) : null}
      <Surface padded={false}>
        <SurfaceHeader title="Stored files" description="Current versions you are permitted to see." />
        {rows.length === 0 ? (
          <EmptyState title="No documents yet" description="Uploaded files for your subsidiaries appear here." />
        ) : (
          <table className="w-full text-left text-[13px]">
            <thead className="border-b border-ink-200 bg-surface-muted text-[11px] uppercase tracking-wider text-ink-500">
              <tr>
                <th className="px-4 py-2 font-semibold">Reference</th>
                <th className="px-4 py-2 font-semibold">Title</th>
                <th className="px-4 py-2 font-semibold">File</th>
                <th className="px-4 py-2 font-semibold">Version</th>
                <th className="px-4 py-2 font-semibold">Uploaded</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-b border-ink-100">
                  <td className="px-4 py-2 font-mono">
                    <Link href={`/documents/${row.id}`} className="text-accent-800 underline">
                      {row.referenceNumber}
                    </Link>
                  </td>
                  <td className="px-4 py-2">{row.title}</td>
                  <td className="px-4 py-2">{row.originalFilename}</td>
                  <td className="px-4 py-2 tabular">{row.currentVersionNumber}</td>
                  <td className="px-4 py-2 tabular text-ink-500">{formatLagosDateTime(row.uploadedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Surface>
    </>
  );
}
