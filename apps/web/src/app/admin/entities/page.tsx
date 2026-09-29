import type { EntityView, MeView } from '@nfc/shared';
import { PageHeader, Surface, SurfaceHeader } from '@/components/ui/Surface';
import { ErrorState, Notice } from '@/components/ui/States';
import { apiFetch, ApiError } from '@/lib/api';
import { CreateEntityDialog } from './CreateEntityDialog';
import { EntitiesTable } from './EntitiesTable';

/**
 * Entity administration (M1 items 3 and 4).
 *
 * Only the MD can create or change an entity. Everyone else may look, and what
 * they see is limited by Row-Level Security rather than by this page: a General
 * Manager's request returns one row because the database returns one row.
 */
export const dynamic = 'force-dynamic';

export const metadata = { title: 'Organisation — NFC' };

export default async function EntitiesPage() {
  const me = await apiFetch<MeView>('/api/me');

  let entities: EntityView[] = [];
  let failure: string | null = null;
  try {
    entities = await apiFetch<EntityView[]>('/api/entities');
  } catch (error) {
    failure = error instanceof ApiError ? error.message : 'The entity list could not be loaded.';
  }

  const canManage = me.permissions.includes('organization.entity.manage');

  return (
    <>
      <PageHeader
        eyebrow="Organisation"
        title="Subsidiaries and departments"
        description="Nigeria Food Corporation is the holding company. Each subsidiary is a direct child of it and holds its own departments."
        actions={canManage ? <CreateEntityDialog /> : null}
      />

      {!me.isCorporate ? (
        <div className="mb-4">
          <Notice tone="info">
            You are seeing only {me.entities.map((entity) => entity.name).join(', ') || 'your own subsidiary'}.
            Records belonging to other subsidiaries are not returned to you.
          </Notice>
        </div>
      ) : null}

      <Surface padded={false}>
        <SurfaceHeader
          title="Entities"
          description={
            canManage
              ? 'Open a subsidiary to manage its departments. Entities are deactivated, never deleted.'
              : 'Open a subsidiary to see its departments.'
          }
        />
        {failure ? (
          <div className="p-4">
            <ErrorState message={failure} />
          </div>
        ) : (
          <EntitiesTable entities={entities} />
        )}
      </Surface>
    </>
  );
}
