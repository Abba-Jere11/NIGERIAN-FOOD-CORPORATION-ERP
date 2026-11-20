import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { FixedAssetView, MeView } from '@nfc/shared';
import { ASSET_CONDITIONS, formatKobo } from '@nfc/shared';
import { PageHeader, Surface, SurfaceHeader } from '@/components/ui/Surface';
import { apiFetch, ApiError } from '@/lib/api';
import { InventoryForm } from '../../InventoryForm';
import { AssetLabel, PrintLabelsButton } from '../../_components/AssetLabel';
import {
  assetPhotoAction,
  clearAssetPhotoAction,
  disposeAssetAction,
  moveAssetAction,
} from '../../desk-actions';
import { AssetThumb, ASSET_STATUS_LABEL } from '../AssetPhoto';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Asset — Inventory — NFC' };

export default async function AssetDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await apiFetch<MeView>('/api/me');
  let asset: FixedAssetView;
  try {
    asset = await apiFetch<FixedAssetView>(`/api/inventory/assets/${id}`);
  } catch (error) {
    if (error instanceof ApiError && (error.status === 404 || error.status === 403)) notFound();
    throw error;
  }
  const canManage = me.permissions.includes('inventory.asset.manage');
  const live = asset.status === 'IN_STORE' || asset.status === 'IN_SERVICE';
  const today = new Date().toISOString().slice(0, 10);
  const conditionOptions = ASSET_CONDITIONS.map((value) => ({ value, label: value }));

  return (
    <>
      <PageHeader
        eyebrow={asset.entityCode ?? 'Asset'}
        title={asset.referenceNumber}
        description={`${asset.itemCode} · ${asset.itemName}${asset.serialCode ? ` · serial ${asset.serialCode}` : ''}`}
      />
      <div className="grid gap-4 lg:grid-cols-[auto_1fr]">
        <Surface>
          <div className="p-4">
            <AssetThumb asset={asset} size={240} />
          </div>
          {canManage && live ? (
            <>
              <InventoryForm
                action={assetPhotoAction}
                entityId={asset.entityId}
                submitLabel={asset.photoUrl ? 'Replace photo' : 'Upload photo'}
                fields={[
                  { name: 'id', label: '', type: 'hidden', defaultValue: asset.id },
                  { name: 'rowVersion', label: '', type: 'hidden', defaultValue: String(asset.rowVersion) },
                  { name: 'photo', label: 'Photo (JPG or PNG)', type: 'file', required: true },
                ]}
              />
              {asset.photoUrl ? (
                <InventoryForm
                  action={clearAssetPhotoAction}
                  submitLabel="Remove photo"
                  fields={[
                    { name: 'id', label: '', type: 'hidden', defaultValue: asset.id },
                    { name: 'rowVersion', label: '', type: 'hidden', defaultValue: String(asset.rowVersion) },
                  ]}
                />
              ) : null}
            </>
          ) : null}
        </Surface>
        <Surface>
          <SurfaceHeader title="Details" />
          <dl className="grid grid-cols-2 gap-2 px-4 py-3 text-[13px]">
            <dt className="text-ink-500">AST reference</dt>
            <dd className="font-mono">{asset.referenceNumber}</dd>
            <dt className="text-ink-500">Status</dt>
            <dd>{ASSET_STATUS_LABEL[asset.status]}</dd>
            <dt className="text-ink-500">Condition</dt>
            <dd>{asset.condition}</dd>
            <dt className="text-ink-500">Department</dt>
            <dd>{asset.departmentLabel ?? '—'}</dd>
            <dt className="text-ink-500">Location</dt>
            <dd>{asset.locationLabel ?? asset.warehouseName ?? '—'}</dd>
            <dt className="text-ink-500">Custodian</dt>
            <dd>{asset.custodianName ?? '—'}</dd>
            <dt className="text-ink-500">Cost</dt>
            <dd>{formatKobo(BigInt(asset.costKobo))}</dd>
            <dt className="text-ink-500">Acquired</dt>
            <dd>{asset.acquiredOn ?? '—'}</dd>
            <dt className="text-ink-500">Goods received</dt>
            <dd>
              {asset.grnReference ?? '—'}
              {asset.procurementId && asset.procurementReference ? (
                <>
                  {' · '}
                  <Link href={`/procurement/${asset.procurementId}`} className="underline">
                    {asset.procurementReference}
                  </Link>
                </>
              ) : null}
            </dd>
          </dl>
        </Surface>
      </div>
      <Surface className="mt-4 print:border-0 print:shadow-none">
        <SurfaceHeader
          title="Identification label"
          description="QR encodes the AST reference. Scan lookup resolves it after authentication."
        />
        <div className="flex flex-wrap items-start gap-3 px-4 py-3">
          <AssetLabel asset={asset} />
          <PrintLabelsButton count={1} />
        </div>
      </Surface>
      <Surface padded={false} className="mt-4">
        <SurfaceHeader title="History" />
        <ul className="divide-y divide-ink-100 text-[13px]">
          {asset.history.map((event, index) => (
            <li key={`${event.kind}-${index}`} className="px-4 py-2">
              <span className="font-semibold text-ink-900">{event.kind.replaceAll('_', ' ').toLowerCase()}</span>
              {[event.departmentLabel, event.locationLabel, event.custodianName, event.condition]
                .filter(Boolean)
                .map((part) => ` · ${part}`)
                .join('')}
              {event.reason ? ` — ${event.reason}` : ''}
            </li>
          ))}
        </ul>
      </Surface>
      {canManage && live ? (
        <Surface className="mt-4">
          <SurfaceHeader title="Assign or move" />
          <InventoryForm
            action={moveAssetAction}
            submitLabel="Save"
            fields={[
              { name: 'id', label: '', type: 'hidden', defaultValue: asset.id },
              { name: 'rowVersion', label: '', type: 'hidden', defaultValue: String(asset.rowVersion) },
              {
                name: 'kind',
                label: 'Action',
                required: true,
                options: [
                  { value: 'ASSIGNED', label: 'Assign to a custodian' },
                  { value: 'MOVED', label: 'Move location' },
                ],
              },
              { name: 'departmentLabel', label: 'Department', defaultValue: asset.departmentLabel ?? '' },
              { name: 'locationLabel', label: 'Location', defaultValue: asset.locationLabel ?? '' },
              { name: 'custodianName', label: 'Custodian', defaultValue: asset.custodianName ?? '' },
              { name: 'condition', label: 'Condition', defaultValue: asset.condition, options: conditionOptions },
              { name: 'reason', label: 'Reason', required: true },
            ]}
          />
        </Surface>
      ) : null}
      {me.permissions.includes('inventory.dispose.request') && live ? (
        <Surface className="mt-4">
          <SurfaceHeader
            title="Request disposal"
            description="Needs ED Operations approval, and ED Finance when the value reaches the Lane B threshold."
          />
          <InventoryForm
            action={disposeAssetAction}
            entityId={asset.entityId}
            submitLabel="Send for approval"
            fields={[
              { name: 'id', label: '', type: 'hidden', defaultValue: asset.id },
              { name: 'rowVersion', label: '', type: 'hidden', defaultValue: String(asset.rowVersion) },
              { name: 'reason', label: 'Reason', required: true },
              { name: 'evidence', label: 'Evidence', type: 'file', required: true },
              { name: 'occurredOn', label: 'Date', type: 'date', required: true, defaultValue: today },
            ]}
          />
        </Surface>
      ) : null}
    </>
  );
}
