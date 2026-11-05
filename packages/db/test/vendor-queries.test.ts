import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { XYZ_VENDOR_ID } from '@nfc/shared';
import {
  isInvoiceNumberUsedElsewhere,
  isVendorValidAndActive,
  previousPayments,
  totalSpendKobo,
} from '../src/vendor-queries';
import { appPool, entityIdFor, inCommittedTransaction, ownerPool, userActor } from './support';

describe('ED Finance vendor query contracts', () => {
  let owner: Pool;
  let app: Pool;
  let nfc: string;

  beforeAll(async () => {
    owner = ownerPool('nfc-erp-test-vq-owner');
    app = appPool('nfc-erp-test-vq-app');
    nfc = await entityIdFor(owner, 'NFC');
  });

  afterAll(async () => {
    await Promise.all([owner.end(), app.end()]);
  });

  it('reports XYZ as valid; Holding has no XYZ payments (subsidiary spend is M8+)', async () => {
    const actor = userActor({
      isCorporate: true,
      permissions: ['vendor.view', 'procurement.review.finance'],
      entityIds: [nfc],
    });
    await inCommittedTransaction(app, actor, async (client) => {
      expect(await isVendorValidAndActive(client, XYZ_VENDOR_ID)).toBe(true);
      expect(await totalSpendKobo(client, XYZ_VENDOR_ID, nfc)).toBe(0);
      expect(await totalSpendKobo(client, XYZ_VENDOR_ID)).toBeGreaterThanOrEqual(0);
      const payments = await previousPayments(client, XYZ_VENDOR_ID);
      expect(payments.every((row) => row.referenceNumber.startsWith('PAY-'))).toBe(true);
    });
  });

  it('finds a duplicate invoice number from the claims table', async () => {
    const actor = userActor({
      isCorporate: true,
      permissions: ['vendor.view', 'vendor.create', 'procurement.review.finance'],
      entityIds: [nfc],
    });
    await inCommittedTransaction(app, actor, async (client) => {
      await client.query(
        `INSERT INTO vendor_invoice_claims (vendor_id, entity_id, invoice_number, procurement_ref, created_by)
         VALUES ($1, $2, 'INV-DUP-1', 'PR-2026-000001', $3)`,
        [XYZ_VENDOR_ID, nfc, actor.ref],
      );
      expect(await isInvoiceNumberUsedElsewhere(client, XYZ_VENDOR_ID, 'INV-DUP-1')).toBe(true);
      expect(await isInvoiceNumberUsedElsewhere(client, XYZ_VENDOR_ID, 'INV-DUP-1', 'PR-2026-000001')).toBe(
        false,
      );
      expect(await isInvoiceNumberUsedElsewhere(client, XYZ_VENDOR_ID, 'INV-NEW')).toBe(false);
    });
  });
});
