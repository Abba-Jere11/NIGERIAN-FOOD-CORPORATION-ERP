import { PageHeader, Surface } from '@/components/ui/Surface';
import { apiFetch } from '@/lib/api';

export const dynamic = 'force-dynamic';

export default async function RolesPage() {
  const roles = await apiFetch<
    Array<{ key: string; name: string; homePath: string; grants: string[] }>
  >('/api/admin/roles');

  return (
    <>
      <PageHeader
        eyebrow="Administration"
        title="Roles"
        description="Default grants. Assignments are checked against this catalog and the conflict matrix; services never branch on a role name."
      />
      <div className="space-y-3">
        {roles.map((role) => (
          <Surface key={role.key}>
            <h2 className="text-[15px] font-semibold text-ink-900">{role.name}</h2>
            <p className="mt-1 font-mono text-[12px] text-ink-500">{role.homePath}</p>
            <ul className="mt-2 columns-1 gap-2 text-[12px] text-ink-700 md:columns-2">
              {role.grants.map((grant) => (
                <li key={grant} className="font-mono">
                  {grant}
                </li>
              ))}
            </ul>
          </Surface>
        ))}
      </div>
    </>
  );
}
