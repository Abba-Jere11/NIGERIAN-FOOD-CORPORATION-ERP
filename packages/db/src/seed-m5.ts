import {
  ALADE_VENDOR_ID,
  NORTHERN_SACKS_VENDOR_ID,
  SAHEL_VENDOR_ID,
  SEED_USERS,
  XYZ_VENDOR_ID,
  XYZ_VENDOR_REFERENCE,
} from '@nfc/shared';
import type { Pool, PoolClient } from 'pg';
import { upsertSearchIndex } from './search';

const EMEKA_ID = SEED_USERS.find((user) => user.email === 'ed.finance@nfc.local')?.id;
const HALIMA_ID = SEED_USERS.find((user) => user.email === 'ed.operations@nfc.local')?.id;

/**
 * A second active, compliant vendor. Added on its own so databases seeded
 * before structured quotations also get one.
 */
async function seedSecondActiveVendor(client: PoolClient): Promise<void> {
  const existing = await client.query('SELECT 1 FROM vendors WHERE id = $1', [ALADE_VENDOR_ID]);
  if (existing.rows[0]) return;
  const nfc = await client.query<{ id: string }>('SELECT id FROM entities WHERE code = $1', ['NFC']);
  const entityId = nfc.rows[0]?.id;
  const equipment = await client.query<{ id: string }>(`SELECT id FROM vendor_categories WHERE key = 'equipment'`);
  const equipmentId = equipment.rows[0]?.id;
  if (!entityId || !equipmentId || !EMEKA_ID) return;
  const reference = await client.query<{ ref: string }>(`SELECT app.next_reference('VND') AS ref`);
  const referenceNumber = reference.rows[0]?.ref;
  if (!referenceNumber) return;
  await client.query(
    `INSERT INTO vendors (
       id, reference_number, entity_id, legal_name, cac_registration_number, category_id, status,
       notes, contacts, bank_name, account_name, account_number, activated_at, activated_by,
       created_by, updated_by
     ) VALUES (
       $1, $2, $3, 'Alade Agro Supplies Limited', 'RC-2100004', $4, 'ACTIVE',
       'Seeded second active vendor for price comparison.',
       $5::jsonb, 'Access Bank', 'Alade Agro Supplies Limited', '0712100004',
       now(), $6, $6, $6
     )`,
    [
      ALADE_VENDOR_ID,
      referenceNumber,
      entityId,
      equipmentId,
      JSON.stringify([{ name: 'Bola Alade', phone: '+2348021000004', email: 'sales@alade.example', role: 'Sales' }]),
      EMEKA_ID,
    ],
  );
  await client.query(
    `INSERT INTO vendor_bank_account_versions (
       vendor_id, entity_id, bank_name, account_name, account_number, created_by
     ) VALUES ($1, $2, 'Access Bank', 'Alade Agro Supplies Limited', '0712100004', $3)`,
    [ALADE_VENDOR_ID, entityId, EMEKA_ID],
  );
  await upsertSearchIndex(client, {
    recordType: 'VENDOR',
    recordId: ALADE_VENDOR_ID,
    referenceNumber,
    title: 'Alade Agro Supplies Limited',
    searchableText: `Alade Agro Supplies Limited RC-2100004 equipment ${referenceNumber}`,
    entityId,
    permissionKey: 'vendor.view',
  });
}

export async function seedM5(pool: Pool): Promise<{ alreadyPresent: boolean }> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const existing = await client.query('SELECT 1 FROM vendors WHERE id = $1', [XYZ_VENDOR_ID]);
    if (existing.rows[0]) {
      await seedSecondActiveVendor(client);
      await client.query('COMMIT');
      return { alreadyPresent: true };
    }

    const nfc = await client.query<{ id: string }>('SELECT id FROM entities WHERE code = $1', ['NFC']);
    const entityId = nfc.rows[0]?.id;
    if (!entityId) throw new Error('Seed organisations before M5 fixtures.');
    if (!EMEKA_ID || !HALIMA_ID) throw new Error('Seed identities before M5 fixtures.');

    const goods = await client.query<{ id: string }>(
      `SELECT id FROM vendor_categories WHERE key = 'goods'`,
    );
    const services = await client.query<{ id: string }>(
      `SELECT id FROM vendor_categories WHERE key = 'services'`,
    );
    const equipment = await client.query<{ id: string }>(
      `SELECT id FROM vendor_categories WHERE key = 'equipment'`,
    );
    const goodsId = goods.rows[0]?.id;
    const servicesId = services.rows[0]?.id;
    const equipmentId = equipment.rows[0]?.id;
    if (!goodsId || !servicesId || !equipmentId) {
      throw new Error('Vendor categories were not seeded by migration 0018.');
    }

    await client.query(
      `INSERT INTO vendors (
         id, reference_number, entity_id, legal_name, cac_registration_number, category_id, status,
         notes, contacts, bank_name, account_name, account_number, activated_at, activated_by,
         created_by, updated_by
       ) VALUES (
         $1, $2, $3, 'XYZ Limited', 'RC-1840001', $4, 'ACTIVE',
         'Seeded milling-machine vendor from the M4 fixture.',
         $5::jsonb, 'First Bank of Nigeria', 'XYZ Limited', '2011840001',
         now(), $6, $6, $6
       )`,
      [
        XYZ_VENDOR_ID,
        XYZ_VENDOR_REFERENCE,
        entityId,
        equipmentId,
        JSON.stringify([{ name: 'Ibrahim XYZ', phone: '+2348018400018', email: 'accounts@xyz.example', role: 'Accounts' }]),
        EMEKA_ID,
      ],
    );
    await client.query(
      `INSERT INTO vendor_bank_account_versions (
         vendor_id, entity_id, bank_name, account_name, account_number, created_by
       ) VALUES ($1, $2, 'First Bank of Nigeria', 'XYZ Limited', '2011840001', $3)`,
      [XYZ_VENDOR_ID, entityId, EMEKA_ID],
    );

    await client.query(
      `INSERT INTO vendors (
         id, reference_number, entity_id, legal_name, cac_registration_number, category_id, status,
         notes, contacts, bank_name, account_name, account_number, created_by, updated_by
       ) VALUES (
         $1, 'VND-000019', $2, 'Sahel Logistics Limited', 'RC-1900002', $3, 'SUSPENDED',
         'Suspended after a missed delivery. Seeded for negative selection tests.',
         $4::jsonb, 'Zenith Bank', 'Sahel Logistics Limited', '1011900002', $5, $5
       )`,
      [
        SAHEL_VENDOR_ID,
        entityId,
        servicesId,
        JSON.stringify([{ name: 'Amina Sahel', phone: '+2348090001902', email: 'ops@sahel.example', role: 'Operations' }]),
        EMEKA_ID,
      ],
    );

    await client.query(
      `INSERT INTO vendors (
         id, reference_number, entity_id, legal_name, cac_registration_number, category_id, status,
         notes, contacts, created_by, updated_by
       ) VALUES (
         $1, 'VND-000020', $2, 'Northern Sacks Ltd', 'RC-2000003', $3, 'DRAFT',
         'Draft onboarding. Not selectable.',
         $4::jsonb, $5, $5
       )`,
      [
        NORTHERN_SACKS_VENDOR_ID,
        entityId,
        goodsId,
        JSON.stringify([{ name: 'Musa Sacks', phone: '+2348030002003', email: 'hello@sacks.example', role: 'Director' }]),
        HALIMA_ID,
      ],
    );

    await client.query(
      `INSERT INTO reference_counters (kind, year, last_value)
       VALUES ('VND', 0, 20)
       ON CONFLICT (kind, year) DO UPDATE
         SET last_value = GREATEST(reference_counters.last_value, 20)`,
    );

    await upsertSearchIndex(client, {
      recordType: 'VENDOR',
      recordId: XYZ_VENDOR_ID,
      referenceNumber: XYZ_VENDOR_REFERENCE,
      title: 'XYZ Limited',
      searchableText: `XYZ Limited RC-1840001 equipment milling ${XYZ_VENDOR_REFERENCE}`,
      entityId,
      permissionKey: 'vendor.view',
    });

    await seedSecondActiveVendor(client);

    await client.query('COMMIT');
    return { alreadyPresent: false };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
