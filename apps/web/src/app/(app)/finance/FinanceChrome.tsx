'use client';

import type { FinanceContextView } from '@nfc/shared';
import { EntityContextBar } from './_components/EntityContextBar';

export function FinanceChrome({ context }: { context: FinanceContextView }) {
  return (
    <div className="mb-4">
      <EntityContextBar context={context} />
    </div>
  );
}
