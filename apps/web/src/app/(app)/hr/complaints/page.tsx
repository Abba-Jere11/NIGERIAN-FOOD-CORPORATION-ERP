import { redirect } from 'next/navigation';
import type { ComplaintView, MeView } from '@nfc/shared';
import { SelectField, TextAreaField } from '@/components/ui/Field';
import { PageHeader, Surface, SurfaceHeader } from '@/components/ui/Surface';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { apiFetch } from '@/lib/api';
import { ActionForm } from '../../me/ActionForm';
import { replyComplaint } from '../../me/actions';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Complaints — HR — NFC' };

export default async function HrComplaintsPage() {
  const me = await apiFetch<MeView>('/api/me');
  if (!me.permissions.includes('complaint.manage')) redirect('/forbidden');
  const rows = await apiFetch<ComplaintView[]>('/api/hr/complaints');

  return (
    <>
      <PageHeader
        eyebrow="HR"
        title="Complaints"
        description="Anonymous complaints hide the sender here. The audit log still records who acted."
      />
      <div className="space-y-3">
        {rows.length === 0 ? <p className="text-[13px] text-ink-500">No complaints.</p> : null}
        {rows.map((row) => (
          <Surface key={row.id}>
            <SurfaceHeader title={`${row.referenceNumber} · ${row.subject}`} description={row.category} />
            <div className="space-y-3 px-4 py-3 text-[13px]">
              <p>
                <StatusBadge status={row.status} /> {row.anonymous ? 'Anonymous' : 'Named'}
              </p>
              <p className="whitespace-pre-wrap">{row.body}</p>
              <ActionForm action={replyComplaint} submitLabel="Reply">
                <input type="hidden" name="complaintId" value={row.id} />
                <TextAreaField name="body" label="Reply" required />
                <SelectField
                  name="status"
                  label="Status"
                  options={[
                    { value: 'IN_REVIEW', label: 'In review' },
                    { value: 'RESOLVED', label: 'Resolved' },
                    { value: 'CLOSED', label: 'Closed' },
                    { value: 'OPEN', label: 'Open' },
                  ]}
                />
              </ActionForm>
            </div>
          </Surface>
        ))}
      </div>
    </>
  );
}
