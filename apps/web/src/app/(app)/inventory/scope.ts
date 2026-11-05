import type { InventoryContextView } from '@nfc/shared';

export function resolveInventoryScope(
  context: InventoryContextView,
  scope?: string,
): { consolidated: boolean; entityId?: string; entityCode?: string; label: string } {
  if (scope === 'consolidated' && context.canConsolidate) {
    return { consolidated: true, label: 'Consolidated' };
  }
  const match = context.entities.find((entity) => entity.code === scope || entity.id === scope);
  if (match) {
    return { consolidated: false, entityId: match.id, entityCode: match.code, label: match.code };
  }
  if (context.canConsolidate) {
    return { consolidated: true, label: 'Consolidated' };
  }
  const first = context.entities[0];
  return {
    consolidated: false,
    entityId: first?.id,
    entityCode: first?.code,
    label: first?.code ?? 'Inventory',
  };
}

export function withInvScope(href: string, scope?: string): string {
  if (!scope) return href;
  const url = new URL(href, 'http://local');
  url.searchParams.set('scope', scope);
  return `${url.pathname}${url.search}`;
}

export function inventoryScopeParam(resolved: {
  consolidated: boolean;
  entityCode?: string;
}): string | undefined {
  return resolved.consolidated ? 'consolidated' : resolved.entityCode;
}

export function inventoryApiQuery(
  resolved: { consolidated: boolean; entityId?: string },
  extra: Record<string, string | undefined> = {},
): Record<string, string | undefined> {
  return {
    ...(resolved.consolidated || !resolved.entityId ? {} : { entityId: resolved.entityId }),
    ...extra,
  };
}
