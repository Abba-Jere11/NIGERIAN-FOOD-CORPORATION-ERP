import { redirect } from 'next/navigation';
import type { ComplaintView, MeView } from '@nfc/shared';
import { TextAreaField, TextField } from '@/components/ui/Field';
import { PageHeader, Surface, SurfaceHeader } from '@/components/ui/Surface';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { apiFetch } from '@/lib/api';
import { ActionForm } from '../ActionForm';
import { replyComplaint, submitComplaint } from '../actions';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Contact HR — NFC' };

export default async function ComplaintsPage() {
  const me = await apiFetch<MeView>('/api/me');
  if (!me.permissions.includes('complaint.submit')) redirect('/forbidden');
  const rows = await apiFetch<ComplaintView[]>('/api/me/complaints');

  return (
    <>
      <PageHeader
        eyebrow="My workspace"
        title="Contact HR"
        description="Signed-in only. Tick anonymous if HR should not see your name on the complaint."
      />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Surface>
          <SurfaceHeader title="New message" />
          <div className="px-4 py-3">
            <ActionForm action={submitComplaint} submitLabel="Send to HR">
              <TextField name="category" label="Category" required />
              <TextField name="subject" label="Subject" required />
              <TextAreaField name="body" label="Message" required />
              <label className="flex items-center gap-2 text-[13px]">
                <input type="checkbox" name="anonymous" />
                Send anonymously
              </label>
            </ActionForm>
          </div>
        </Surface>
        <div className="space-y-3">
          {rows.map((row) => (
            <Surface key={row.id}>
              <p className="text-[12px] text-ink-500">
                {row.referenceNumber} · {row.category} · <StatusBadge status={row.status} />
                {row.anonymous ? ' · Anonymous' : ''}
              </p>
              <h2 className="mt-1 text-[15px] font-semibold">{row.subject}</h2>
              <p className="mt-2 whitespace-pre-wrap text-[13px]">{row.body}</p>
              <div className="mt-3">
                <ActionForm action={replyComplaint} submitLabel="Add a follow-up" variant="secondary">
                  <input type="hidden" name="complaintId" value={row.id} />
                  <TextAreaField name="body" label="Follow-up" required />
                </ActionForm>
              </div>
            </Surface>
          ))}
        </div>
      </div>
    </>
  );
}
