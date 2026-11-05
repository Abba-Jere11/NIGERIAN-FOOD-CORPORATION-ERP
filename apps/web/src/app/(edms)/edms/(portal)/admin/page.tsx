import type { EdmsCategoryView, EdmsLegalHoldView, EdmsTagView, MeView } from '@nfc/shared';
import { EDMS_CONFIDENTIALITY, EDMS_MODULES } from '@nfc/shared';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { PageHeader, Surface, SurfaceHeader } from '@/components/ui/Surface';
import { apiFetch } from '@/lib/api';
import { AdminForms } from './AdminForms';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'EDMS admin — NFC' };

export default async function EdmsAdminPage() {
  const me = await apiFetch<MeView>('/api/me');
  const canManage =
    me.permissions.includes('edms.manage_categories') || me.permissions.includes('edms.manage_retention');
  if (!canManage) redirect('/edms');

  const [categories, tags, holds] = await Promise.all([
    apiFetch<EdmsCategoryView[]>('/api/edms/categories'),
    apiFetch<EdmsTagView[]>('/api/edms/tags'),
    me.permissions.includes('edms.manage_retention')
      ? apiFetch<EdmsLegalHoldView[]>('/api/edms/legal-holds')
      : Promise.resolve([] as EdmsLegalHoldView[]),
  ]);

  return (
    <>
      <PageHeader
        eyebrow="Document Portal"
        title="Categories, tags and retention"
        description="Administrator configuration. Business files stay outside this view."
      />
      <div className="grid gap-4 lg:grid-cols-2">
        <Surface padded={false}>
          <SurfaceHeader title="Categories" description="Module, retention years and approval." />
          <table className="w-full text-left text-[13px]">
            <thead>
              <tr className="border-b border-ink-200 text-[12px] text-ink-600">
                <th className="px-4 py-2">Name</th>
                <th className="px-4 py-2">Module</th>
                <th className="px-4 py-2">Years</th>
              </tr>
            </thead>
            <tbody>
              {categories.map((row) => (
                <tr key={row.id} className="border-b border-ink-100">
                  <td className="px-4 py-2">{row.name}</td>
                  <td className="px-4 py-2">{row.module}</td>
                  <td className="px-4 py-2">{row.retainYears}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {me.permissions.includes('edms.manage_categories') ? (
            <div className="px-4 py-3">
              <AdminForms
                kind="category"
                modules={[...EDMS_MODULES]}
                confidentiality={[...EDMS_CONFIDENTIALITY]}
              />
            </div>
          ) : null}
        </Surface>
        <Surface padded={false}>
          <SurfaceHeader title="Tags" />
          <ul className="divide-y divide-ink-100 px-4 py-2 text-[13px]">
            {tags.map((tag) => (
              <li key={tag.id} className="py-2">
                {tag.name} <span className="text-ink-500">({tag.key})</span>
              </li>
            ))}
          </ul>
          {me.permissions.includes('edms.manage_categories') ? (
            <div className="px-4 py-3">
              <AdminForms kind="tag" />
            </div>
          ) : null}
        </Surface>
      </div>
      {me.permissions.includes('edms.manage_retention') ? (
        <Surface className="mt-4" padded={false}>
          <SurfaceHeader title="Legal-hold queue" />
          {holds.length === 0 ? (
            <p className="px-4 py-3 text-[13px] text-ink-600">No active holds.</p>
          ) : (
            <ul className="divide-y divide-ink-100 px-4 py-2 text-[13px]">
              {holds.map((hold) => (
                <li key={hold.id} className="py-2">
                  {hold.documentId ? (
                    <Link href={`/edms/documents/${hold.documentId}`} className="underline">
                      Document
                    </Link>
                  ) : (
                    'Folder'
                  )}
                  {' · '}
                  {hold.reason}
                  <div className="mt-2">
                    <AdminForms
                      kind="release"
                      documentId={hold.documentId ?? ''}
                      holdId={hold.id}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Surface>
      ) : null}
    </>
  );
}
