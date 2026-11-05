import { redirect } from 'next/navigation';
import Link from 'next/link';
import type { HomeSummaryView, MeView, UserSummaryView } from '@nfc/shared';
import { PageHeader, Surface, SurfaceHeader } from '@/components/ui/Surface';
import { HomeKpiCard } from '@/components/home/HomeKpiCard';
import { apiFetch } from '@/lib/api';

export const dynamic = 'force-dynamic';

export default async function AdminHomePage() {
  const me = await apiFetch<MeView>('/api/me');
  if (!me.permissions.includes('admin.user.manage')) redirect('/forbidden');

  const [users, summary] = await Promise.all([
    apiFetch<UserSummaryView[]>('/api/admin/users').catch(() => []),
    apiFetch<HomeSummaryView>('/api/home/summary').catch(() => null),
  ]);
  const ops = summary?.adminOps;

  return (
    <>
      <PageHeader
        eyebrow="Administration"
        title={`Good day, ${me.name.split(' ')[0] ?? me.name}`}
        description="Accounts, roles, entities and platform health. This role has no view of procurement, finance, inventory or the audit log."
      />
      <div className="mb-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
        <HomeKpiCard label="User accounts" value={users.length} href="/admin/users" />
        {ops ? (
          <HomeKpiCard
            label="Delivery failures"
            value={ops.deadLetterCount + ops.failedNotificationDeliveries + ops.failedMail}
            href="/admin/health"
            danger
          />
        ) : null}
        <HomeKpiCard label="Corporate home" value="Open" href="/home" hint="Group summary (admin pending only)" />
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Surface padded={false}>
          <SurfaceHeader title="Identity and access" description="Users, roles, entities, sessions." />
          <ul className="divide-y divide-ink-100 px-4 py-2 text-[13px]">
            <li className="py-2">
              <Link href="/admin/users" className="underline">
                Users
              </Link>
            </li>
            <li className="py-2">
              <Link href="/admin/roles" className="underline">
                Roles and default grants
              </Link>
            </li>
            <li className="py-2">
              <Link href="/admin/entities" className="underline">
                Entities and departments
              </Link>
            </li>
            <li className="py-2">
              <Link href="/admin/sessions" className="underline">
                Active sessions
              </Link>
            </li>
            <li className="py-2">
              <Link href="/admin/permission-log" className="underline">
                Permission change log
              </Link>
            </li>
          </ul>
        </Surface>
        <Surface padded={false}>
          <SurfaceHeader title="Platform operations" description="Health, workflows, seals and documents." />
          <ul className="divide-y divide-ink-100 px-4 py-2 text-[13px]">
            <li className="py-2">
              <Link href="/admin/health" className="underline">
                Health, jobs and mail
              </Link>
            </li>
            <li className="py-2">
              <Link href="/admin/workflows" className="underline">
                Workflow definitions
              </Link>
            </li>
            <li className="py-2">
              <Link href="/admin/seals" className="underline">
                Seal verification
              </Link>
            </li>
            <li className="py-2">
              <Link href="/admin/document-access" className="underline">
                Document access log
              </Link>
            </li>
            <li className="py-2">
              <Link href="/admin/notifications" className="underline">
                Notification templates
              </Link>
            </li>
            <li className="py-2">
              <Link href="/workflows/overdue" className="underline">
                Overdue workflows (read-only)
              </Link>
            </li>
          </ul>
        </Surface>
      </div>
    </>
  );
}
