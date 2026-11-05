import type { EdmsFolderView } from '@nfc/shared';
import { notFound } from 'next/navigation';
import { FolderBreadcrumb, FolderContents } from '@/components/edms/FolderContents';
import { Notice } from '@/components/ui/States';
import { apiFetch, ApiError } from '@/lib/api';

export const dynamic = 'force-dynamic';

export default async function EdmsFolderPage({
  params,
}: {
  params: Promise<{ code: string; id: string }>;
}) {
  const { code, id } = await params;
  let folder: EdmsFolderView;
  try {
    folder = await apiFetch<EdmsFolderView>(`/api/edms/folders/${id}`);
  } catch (error) {
    if (error instanceof ApiError && (error.status === 403 || error.status === 404)) notFound();
    throw error;
  }
  if (folder.entityCode !== code) notFound();

  return (
    <div className="flex flex-col gap-3 p-4">
      <div className="space-y-1">
        <FolderBreadcrumb code={code} breadcrumb={folder.breadcrumb} />
        <h2 className="text-[16px] font-semibold text-ink-900">{folder.name}</h2>
      </div>
      {folder.readOnly ? (
        <Notice tone="info">The archive tree is read-only. Documents remain searchable.</Notice>
      ) : null}
      <FolderContents folder={folder} code={code} />
    </div>
  );
}
