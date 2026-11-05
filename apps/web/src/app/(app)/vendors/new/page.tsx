import type { MeView, VendorCategoryView } from '@nfc/shared';
import { redirect } from 'next/navigation';
import { PageHeader, Surface, SurfaceHeader } from '@/components/ui/Surface';
import { apiFetch } from '@/lib/api';
import { VendorForm } from '../VendorForm';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'New vendor — NFC' };

export default async function NewVendorPage() {
  const me = await apiFetch<MeView>('/api/me');
  if (!me.permissions.includes('vendor.create')) redirect('/forbidden');
  const categories = await apiFetch<VendorCategoryView[]>('/api/vendors/categories');

  return (
    <>
      <PageHeader
        eyebrow="Vendors"
        title="New vendor"
        description="Saved as a draft. Onboarding starts after the required compliance files and bank details are attached."
      />
      <Surface>
        <SurfaceHeader title="Profile" />
        <div className="px-4 py-3">
          <VendorForm categories={categories} />
        </div>
      </Surface>
    </>
  );
}
