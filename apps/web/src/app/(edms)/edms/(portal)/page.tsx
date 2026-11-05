import type { EdmsGatewayView } from '@nfc/shared';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { PageHeader } from '@/components/ui/Surface';
import { apiFetch, ApiError } from '@/lib/api';
import { cx } from '@/lib/cx';

export const metadata = { title: 'Document Portal — NFC' };

function EntityGlyph({ code, holding }: { code: string; holding: boolean }) {
  return (
    <span
      className={cx(
        'flex h-11 w-11 shrink-0 items-center justify-center rounded-sm text-[12px] font-semibold tracking-wide',
        holding ? 'bg-accent-700 text-white' : 'bg-accent-100 text-accent-800',
      )}
      aria-hidden
    >
      {code.slice(0, 3)}
    </span>
  );
}

export default async function EdmsGatewayPage() {
  let gateway: EdmsGatewayView;
  try {
    gateway = await apiFetch<EdmsGatewayView>('/api/edms/gateway');
  } catch (error) {
    if (error instanceof ApiError && error.status === 403) {
      return null;
    }
    throw error;
  }
  if (gateway.admin && gateway.entities.length === 0) redirect('/edms/admin');

  return (
    <>
      <PageHeader
        eyebrow="Document Portal"
        title="Choose a workspace"
        description="Open a holding or subsidiary space to browse Active and Archived folders."
      />
      {gateway.entities.length === 0 ? (
        <p className="text-[13px] text-ink-600">No subsidiaries are available to you in this portal.</p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {gateway.entities.map((entity) => {
            const holding = entity.type === 'HOLDING';
            return (
              <li key={entity.id}>
                <Link
                  href={`/edms/${entity.code}`}
                  className={cx(
                    'group flex h-full gap-3 border border-ink-200 bg-surface p-4 transition-colors',
                    'hover:border-accent-600 hover:bg-accent-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-600',
                  )}
                >
                  <EntityGlyph code={entity.code} holding={holding} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[11px] font-semibold uppercase tracking-wider text-ink-500">
                      {entity.code}
                    </span>
                    <span className="mt-0.5 block text-[15px] font-semibold text-ink-900 group-hover:text-accent-800">
                      {entity.name}
                    </span>
                    <span className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-ink-500">
                      <span>{holding ? 'Holding' : 'Subsidiary'}</span>
                      <span>
                        {entity.documentCount === 1
                          ? '1 document'
                          : `${entity.documentCount.toLocaleString()} documents`}
                      </span>
                    </span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
