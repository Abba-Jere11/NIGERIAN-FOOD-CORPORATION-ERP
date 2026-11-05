import type { ReactNode } from 'react';
import type { EdmsGatewayView, EdmsTreeView, MeView } from '@nfc/shared';
import { notFound } from 'next/navigation';
import { EdmsWorkspace } from '@/components/edms/EdmsWorkspace';
import { apiFetch, ApiError } from '@/lib/api';

export const dynamic = 'force-dynamic';

export default async function EdmsEntityLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  const [me, gateway] = await Promise.all([
    apiFetch<MeView>('/api/me'),
    apiFetch<EdmsGatewayView>('/api/edms/gateway'),
  ]);
  const entity = gateway.entities.find((item) => item.code === code);
  if (!entity) notFound();

  let tree: EdmsTreeView;
  try {
    tree = await apiFetch<EdmsTreeView>('/api/edms/tree', { query: { entityId: entity.id } });
  } catch (error) {
    if (error instanceof ApiError && (error.status === 403 || error.status === 404)) notFound();
    throw error;
  }

  return (
    <EdmsWorkspace
      code={code}
      tree={tree}
      entities={gateway.entities}
      canUpload={me.permissions.includes('edms.upload')}
      canSearchAll={gateway.entities.length > 1}
    >
      {children}
    </EdmsWorkspace>
  );
}
