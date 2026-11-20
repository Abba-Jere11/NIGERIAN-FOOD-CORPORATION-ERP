'use client';

import { QRCodeSVG } from 'qrcode.react';
import type { FixedAssetView } from '@nfc/shared';

/** Compact printable asset identification. QR payload is the stable AST reference. */
export function AssetLabel({ asset, entityCode }: { asset: FixedAssetView; entityCode?: string | null }) {
  return (
    <div className="asset-label w-[220px] border border-ink-900 bg-white p-2 text-ink-900">
      <p className="text-[10px] font-semibold uppercase tracking-wider">{entityCode ?? asset.entityCode ?? 'NFC'}</p>
      <p className="truncate text-[12px] font-medium">{asset.itemName}</p>
      <div className="mt-1 flex items-center gap-2">
        <QRCodeSVG value={asset.referenceNumber} size={72} level="M" includeMargin={false} />
        <div>
          <p className="font-mono text-[13px] font-semibold">{asset.referenceNumber}</p>
          {asset.serialCode ? <p className="font-mono text-[10px]">{asset.serialCode}</p> : null}
        </div>
      </div>
    </div>
  );
}

export function PrintLabelsButton({ count }: { count: number }) {
  return (
    <button
      type="button"
      className="border border-ink-300 px-3 py-1.5 text-[13px] print:hidden"
      onClick={() => window.print()}
    >
      Print {count === 1 ? 'label' : `${count} labels`}
    </button>
  );
}
