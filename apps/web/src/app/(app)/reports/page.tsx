import Link from 'next/link';
import type { MeView } from '@nfc/shared';
import { visibleReportCategories } from '@nfc/shared';
import { PageHeader, Surface, SurfaceHeader } from '@/components/ui/Surface';
import { EmptyState } from '@/components/ui/States';
import { apiFetch } from '@/lib/api';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Reports — NFC' };

export default async function ReportsHubPage() {
  const me = await apiFetch<MeView>('/api/me');
  const categories = visibleReportCategories(me.permissions);

  return (
    <>
      <PageHeader
        eyebrow="Reports"
        title="Reports"
        description="Categories you can open. Features that have not shipped yet are labelled, not hidden as errors."
      />
      {categories.length === 0 ? (
        <Surface>
          <EmptyState
            title="No business reports for this account"
            description="Administration does not include procurement, finance or inventory figures."
          />
        </Surface>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {categories.map((category) => (
            <Surface key={category.key}>
              <SurfaceHeader title={category.title} description={category.description} />
              <div className="px-4 py-3 text-[13px] text-ink-700">
                {category.available && category.href ? (
                  <Link href={category.href} className="underline">
                    Open {category.title.toLowerCase()} reports
                  </Link>
                ) : (
                  <p>{category.unavailableLabel ?? 'Unavailable in this release.'}</p>
                )}
              </div>
            </Surface>
          ))}
        </div>
      )}
      {me.permissions.includes('reports.email') ? (
        <Surface className="mt-4">
          <SurfaceHeader
            title="Share a report by email"
            description="Open a finance report, then Share by email. The PDF is sent from the Managing Director’s official mailbox. Recipients do not receive NFC access."
          />
        </Surface>
      ) : null}
    </>
  );
}
