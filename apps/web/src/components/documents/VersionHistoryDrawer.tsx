'use client';

import { useState } from 'react';
import type { DocumentVersionView } from '@nfc/shared';
import { formatLagosDateTime } from '@nfc/shared';
import { Button } from '@/components/ui/Button';

export function VersionHistoryDrawer({
  title,
  versions,
}: {
  title: string;
  versions: DocumentVersionView[];
}) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        Version history
      </Button>
      {open ? (
        <div className="fixed inset-0 z-40 flex justify-end bg-ink-900/40" role="presentation">
          <aside
            className="h-full w-full max-w-md border-l border-ink-300 bg-surface p-4"
            role="dialog"
            aria-label="Version history"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-500">
                  Versions
                </p>
                <h2 className="text-[15px] font-semibold text-ink-900">{title}</h2>
              </div>
              <Button variant="subtle" size="sm" onClick={() => setOpen(false)}>
                Close
              </Button>
            </div>
            <ol className="mt-4 space-y-3">
              {versions.map((version) => (
                <li key={version.id} className="border border-ink-200 px-3 py-2">
                  <p className="text-[13px] font-semibold text-ink-900">
                    {title} — Version {version.versionNumber}
                  </p>
                  <p className="text-[12px] text-ink-600">
                    {version.originalFilename} · {version.uploadedByName}
                  </p>
                  <p className="tabular text-[11px] text-ink-500">
                    {formatLagosDateTime(version.uploadedAt)}
                  </p>
                  {version.replacementReason ? (
                    <p className="mt-1 text-[12px] text-ink-700">{version.replacementReason}</p>
                  ) : null}
                </li>
              ))}
            </ol>
          </aside>
        </div>
      ) : null}
    </div>
  );
}
