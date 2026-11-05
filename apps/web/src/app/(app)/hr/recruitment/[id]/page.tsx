import type { HrOfferView, HrVacancyView, MeView } from '@nfc/shared';
import { notFound, redirect } from 'next/navigation';
import { PageHeader, Surface, SurfaceHeader } from '@/components/ui/Surface';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { apiFetch, ApiError } from '@/lib/api';
import { ApplicantForm, OfferForm, OnboardForm } from '../../HrForms';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Vacancy — HR — NFC' };

type VacancyDetail = HrVacancyView & {
  applicants: Array<{ id: string; name: string; email: string | null; stage: string; employeeId: string | null }>;
  offers: HrOfferView[];
};

export default async function VacancyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await apiFetch<MeView>('/api/me');
  if (!me.permissions.includes('hr.recruitment.manage')) redirect('/forbidden');
  let vacancy: VacancyDetail;
  try {
    vacancy = await apiFetch<VacancyDetail>(`/api/hr/vacancies/${id}`);
  } catch (error) {
    if (error instanceof ApiError && (error.status === 404 || error.status === 403)) notFound();
    throw error;
  }

  return (
    <>
      <PageHeader
        eyebrow={vacancy.referenceNumber}
        title={vacancy.title}
        description={`${vacancy.entityCode} · headcount ${vacancy.headcount}`}
      />
      <p className="mb-3 text-[13px]">
        Status <StatusBadge status={vacancy.status} />
      </p>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Surface padded={false}>
          <SurfaceHeader title="Applicants" />
          <ul className="divide-y divide-ink-100 text-[13px]">
            {vacancy.applicants.map((row) => (
              <li key={row.id} className="px-4 py-2">
                {row.name} · {row.stage}
                {row.employeeId ? ` · hired` : ''}
              </li>
            ))}
          </ul>
          <div className="px-4 py-3">
            <ApplicantForm vacancyId={vacancy.id} />
          </div>
        </Surface>
        <Surface>
          <SurfaceHeader title="Offer and onboard" />
          <div className="space-y-4 px-4 py-3">
            <OfferForm
              vacancyId={vacancy.id}
              applicants={vacancy.applicants.map((row) => ({ value: row.id, label: row.name }))}
            />
            {vacancy.offers.map((offer) => (
              <div key={offer.id} className="border-t border-ink-100 pt-3 text-[13px]">
                Offer <StatusBadge status={offer.status} />
                {['APPROVED', 'ISSUED', 'ACCEPTED'].includes(offer.status) ? (
                  <OnboardForm offerId={offer.id} />
                ) : null}
              </div>
            ))}
          </div>
        </Surface>
      </div>
    </>
  );
}
