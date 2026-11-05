import type {
  EdmsCategoryView,
  EdmsFolderNodeView,
  EdmsGatewayView,
  EdmsTagView,
  EdmsTreeView,
  MeView,
} from '@nfc/shared';
import { redirect } from 'next/navigation';
import { PageHeader } from '@/components/ui/Surface';
import { apiFetch } from '@/lib/api';
import { UploadForm } from './UploadForm';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Upload — Document Portal' };

function flatten(node: EdmsFolderNodeView | null, trail: string[] = []): Array<{ id: string; label: string }> {
  if (!node) return [];
  const label = [...trail, node.name].join(' / ');
  const self = node.kind === 'space' ? [] : [{ id: node.id, label }];
  return [...self, ...node.children.flatMap((child) => flatten(child, [...trail, node.name]))];
}

export default async function EdmsUploadPage({
  searchParams,
}: {
  searchParams: Promise<{ entityId?: string; folderId?: string }>;
}) {
  const query = await searchParams;
  const me = await apiFetch<MeView>('/api/me');
  if (!me.permissions.includes('edms.upload')) redirect('/edms');

  const [gateway, categories, tags] = await Promise.all([
    apiFetch<EdmsGatewayView>('/api/edms/gateway'),
    apiFetch<EdmsCategoryView[]>('/api/edms/categories'),
    apiFetch<EdmsTagView[]>('/api/edms/tags'),
  ]);
  const entityId = query.entityId ?? gateway.entities[0]?.id;
  if (!entityId) redirect('/edms');
  const tree = await apiFetch<EdmsTreeView>('/api/edms/tree', { query: { entityId } });
  const folders = flatten(tree.active);

  return (
    <>
      <PageHeader
        eyebrow="Document Portal"
        title="Upload document"
        description="Choose the entity and folder destination. Files are stored encrypted and linked into that folder."
      />
      <UploadForm
        entities={gateway.entities}
        folders={folders}
        categories={categories.filter((row) => row.status === 'ACTIVE')}
        tags={tags.filter((row) => row.status === 'ACTIVE')}
        entityId={entityId}
        folderId={query.folderId ?? folders[0]?.id ?? ''}
      />
    </>
  );
}
