import type { AssetStatus, FixedAssetView } from '@nfc/shared';

export const ASSET_STATUS_LABEL: Record<AssetStatus, string> = {
  IN_STORE: 'In store',
  IN_SERVICE: 'In service',
  DISPOSAL_PENDING: 'Disposal pending',
  DISPOSED: 'Disposed',
};

/** The photo is streamed through the web app so the browser never calls the API directly. */
export function assetPhotoSrc(asset: Pick<FixedAssetView, 'id' | 'photoUrl' | 'photoDocumentId'>): string | null {
  if (!asset.photoUrl) return null;
  return `/inventory/assets/${asset.id}/photo?v=${asset.photoDocumentId ?? ''}`;
}

export function AssetThumb({ asset, size = 160 }: { asset: FixedAssetView; size?: number }) {
  const src = assetPhotoSrc(asset);
  if (!src) {
    return (
      <span
        className="flex items-center justify-center border border-dashed border-ink-300 bg-ink-50 text-[11px] text-ink-500"
        style={{ width: size, height: size }}
      >
        No photo
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={`${asset.referenceNumber} ${asset.itemName}`}
      width={size}
      height={size}
      className="border border-ink-200 object-cover"
      style={{ width: size, height: size }}
      data-testid="asset-photo"
    />
  );
}
