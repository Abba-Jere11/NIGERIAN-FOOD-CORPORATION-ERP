import type { SessionView } from '@nfc/shared';
import { formatLagosDateTime } from '@nfc/shared';
import { PageHeader, Surface } from '@/components/ui/Surface';
import { apiFetch } from '@/lib/api';
import { RevokeSessionButton } from './RevokeSessionButton';

export const dynamic = 'force-dynamic';

export default async function AccountSessionsPage() {
  const sessions = await apiFetch<SessionView[]>('/api/auth/sessions');
  return (
    <>
      <PageHeader eyebrow="Account" title="Sessions" description="Devices that are signed in as you." />
      <Surface padded={false}>
        <ul className="divide-y divide-ink-100">
          {sessions.map((session) => (
            <li key={session.id} className="flex items-center justify-between gap-3 px-4 py-3">
              <div>
                <p className="text-[13px] font-medium text-ink-900">
                  {session.deviceLabel ?? 'Device'}
                  {session.current ? ' (this device)' : ''}
                </p>
                <p className="text-[12px] text-ink-500">
                  Last seen {formatLagosDateTime(session.lastSeenAt)}
                  {session.ipAddress ? ` · ${session.ipAddress}` : ''}
                </p>
              </div>
              {session.current ? null : <RevokeSessionButton id={session.id} />}
            </li>
          ))}
        </ul>
      </Surface>
    </>
  );
}
