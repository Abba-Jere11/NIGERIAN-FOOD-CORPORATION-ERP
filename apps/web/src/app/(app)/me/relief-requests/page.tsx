import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { HrLeaveRequestView, MeView } from '@nfc/shared';
import { PageHeader, Surface, SurfaceHeader } from '@/components/ui/Surface';
import { apiFetch } from '@/lib/api';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Relief requests — NFC' };

export default async function ReliefPage() {
  const me = await apiFetch<MeView>('/api/me');
  if (!me.permissions.includes('self.workspace')) redirect('/forbidden');
  const rows = await apiFetch<HrLeaveRequestView[]>('/api/me/relief-requests');

  return (
    <>
      <PageHeader
        eyebrow="My workspace"
        title="Relief requests"
        description="Accept or decline these from Approvals. Declining rejects the leave."
      />
      <Surface padded={false}>
        <SurfaceHeader title="Waiting for you" />
        <ul className="divide-y divide-ink-100 text-[13px]">
          {rows.length === 0 ? <li className="px-4 py-3 text-ink-500">Nothing is waiting.</li> : null}
          {rows.map((row) => (
            <li key={row.id} className="px-4 py-2">
              {row.employeeName} · {row.typeName} · {row.startsOn} to {row.endsOn}
              {row.workflowInstanceId ? (
                <>
                  {' '}
                  ·{' '}
                  <Link href={`/workflows/${row.workflowInstanceId}`} className="underline">
                    Open approval
                  </Link>
                </>
              ) : null}
            </li>
          ))}
        </ul>
      </Surface>
    </>
  );
}
