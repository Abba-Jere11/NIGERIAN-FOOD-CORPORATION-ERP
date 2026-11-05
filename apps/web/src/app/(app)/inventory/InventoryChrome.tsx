'use client';

import type { InventoryContextView } from '@nfc/shared';
import { EntityContextBar } from './_components/EntityContextBar';

export function InventoryChrome({ context }: { context: InventoryContextView }) {
  return (
    <div className="mb-4">
      <EntityContextBar context={context} />
    </div>
  );
}
