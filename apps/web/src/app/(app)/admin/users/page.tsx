import type { UserSummaryView } from '@nfc/shared';
import { PageHeader, Surface } from '@/components/ui/Surface';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { apiFetch } from '@/lib/api';
import { MfaPolicyControl } from './MfaPolicyControl';

export const dynamic = 'force-dynamic';

export default async function UsersPage() {
  const users = await apiFetch<UserSummaryView[]>('/api/admin/users');

  return (
    <>
      <PageHeader
        eyebrow="Administration"
        title="Users"
        description="Accounts are deactivated, never deleted. Role changes are written to the permission log."
      />
      <Surface padded={false}>
        <table className="w-full text-left text-[13px]">
          <thead className="border-b border-ink-200 bg-surface-muted text-[11px] uppercase tracking-wide text-ink-500">
            <tr>
              <th className="px-3 py-2">Name</th>
              <th className="px-3 py-2">Email</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">MFA</th>
              <th className="px-3 py-2">Roles</th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <tr key={user.id} className="border-b border-ink-100">
                <td className="px-3 py-2 font-medium text-ink-900">{user.name}</td>
                <td className="px-3 py-2 font-mono text-[12px]">{user.email}</td>
                <td className="px-3 py-2">
                  <StatusBadge status={user.status} />
                </td>
                <td className="px-3 py-2 align-top">
                  <MfaPolicyControl user={user} />
                </td>
                <td className="px-3 py-2 text-ink-700">
                  {user.roles.map((role) => role.roleName).join(', ') || '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Surface>
    </>
  );
}
