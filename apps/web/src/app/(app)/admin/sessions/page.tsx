import type { UserSummaryView } from '@nfc/shared';
import { PageHeader, Surface } from '@/components/ui/Surface';
import { apiFetch } from '@/lib/api';

export const dynamic = 'force-dynamic';

export default async function AdminSessionsPage() {
  const users = await apiFetch<UserSummaryView[]>('/api/admin/users');

  return (
    <>
      <PageHeader
        eyebrow="Administration"
        title="Sessions"
        description="Revoke another person’s sessions from their user record. Your own devices are under Account → Sessions."
      />
      <Surface>
        <p className="text-[13px] text-ink-700">
          {users.filter((user) => user.lastLoginAt).length} users have signed in at least once.
        </p>
      </Surface>
    </>
  );
}
