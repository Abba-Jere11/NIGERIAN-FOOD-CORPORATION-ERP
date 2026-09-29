import {
  DEFAULT_DEPARTMENTS,
  HOLDING_ENTITY,
  ORGANIZATION_CODE,
  ORGANIZATION_NAME,
  SUBSIDIARY_ENTITIES,
  type SeedEntity,
} from '@nfc/shared';
import type { Pool, PoolClient } from 'pg';
import { insertAuditEntry } from './audit';
import { type ActorContext } from './session';

/**
 * Seeds the organisation structure (M1 items 3 and 4).
 *
 * A4: Nigeria Food Corporation is the holding company and Yobe Fertilizer,
 * Yobe Flour & Wheat Mills, Damaturu Modern Abattoir and Nguru Oil Mills are
 * all direct children of it.
 *
 * The seed is idempotent and every row it creates is accompanied by an audit
 * entry written in the same transaction, attributed to `system:seed` - the only
 * actor in the system permitted to act without a user behind it.
 */

const SEED_ACTOR: ActorContext = {
  ref: 'system:seed',
  name: 'Seed process',
  role: null,
  scopeType: null,
  entityIds: [],
  isCorporate: true,
  requestId: 'seed',
};

export interface SeedSummary {
  organizationsCreated: number;
  entitiesCreated: number;
  departmentsCreated: number;
  alreadyPresent: boolean;
}

interface OrganizationRecord {
  id: string;
}

async function seedOrganization(
  client: PoolClient,
  summary: SeedSummary,
): Promise<OrganizationRecord> {
  const existing = await client.query<{ id: string }>(
    'SELECT id FROM organizations WHERE code = $1',
    [ORGANIZATION_CODE],
  );
  const found = existing.rows[0];
  if (found) return { id: found.id };

  const inserted = await client.query<{ id: string }>(
    `INSERT INTO organizations (code, name, legal_name, created_by, updated_by)
     VALUES ($1, $2, $3, $4, $4)
     RETURNING id`,
    [ORGANIZATION_CODE, ORGANIZATION_NAME, ORGANIZATION_NAME, SEED_ACTOR.ref],
  );
  const row = inserted.rows[0];
  if (!row) throw new Error('Failed to create the organization row');

  await insertAuditEntry(client, SEED_ACTOR, {
    action: 'create',
    subjectType: 'organization',
    subjectId: row.id,
    subjectLabel: ORGANIZATION_NAME,
    newValue: { code: ORGANIZATION_CODE, name: ORGANIZATION_NAME, status: 'ACTIVE' },
  });

  summary.organizationsCreated += 1;
  return { id: row.id };
}

async function seedEntity(
  client: PoolClient,
  summary: SeedSummary,
  organizationId: string,
  entity: SeedEntity,
  parentEntityId: string | null,
): Promise<string> {
  const existing = await client.query<{ id: string }>('SELECT id FROM entities WHERE code = $1', [
    entity.code,
  ]);
  const found = existing.rows[0];
  if (found) return found.id;

  const inserted = await client.query<{ id: string }>(
    `INSERT INTO entities
       (organization_id, parent_entity_id, code, name, legal_name, type, created_by, updated_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $7)
     RETURNING id`,
    [
      organizationId,
      parentEntityId,
      entity.code,
      entity.name,
      entity.legalName,
      entity.type,
      SEED_ACTOR.ref,
    ],
  );
  const row = inserted.rows[0];
  if (!row) throw new Error(`Failed to create entity ${entity.code}`);

  await insertAuditEntry(client, SEED_ACTOR, {
    action: 'create',
    subjectType: 'entity',
    subjectId: row.id,
    subjectLabel: `${entity.code} - ${entity.name}`,
    entityId: row.id,
    newValue: {
      code: entity.code,
      name: entity.name,
      legalName: entity.legalName,
      type: entity.type,
      parentEntityId,
      status: 'ACTIVE',
    },
  });

  summary.entitiesCreated += 1;
  return row.id;
}

async function seedDepartments(
  client: PoolClient,
  summary: SeedSummary,
  entityId: string,
  entityCode: string,
): Promise<void> {
  for (const name of DEFAULT_DEPARTMENTS) {
    const existing = await client.query<{ id: string }>(
      'SELECT id FROM departments WHERE entity_id = $1 AND lower(name) = lower($2)',
      [entityId, name],
    );
    if (existing.rows[0]) continue;

    const inserted = await client.query<{ id: string }>(
      `INSERT INTO departments (entity_id, name, created_by, updated_by)
       VALUES ($1, $2, $3, $3)
       RETURNING id`,
      [entityId, name, SEED_ACTOR.ref],
    );
    const row = inserted.rows[0];
    if (!row) throw new Error(`Failed to create department ${name} for ${entityCode}`);

    await insertAuditEntry(client, SEED_ACTOR, {
      action: 'create',
      subjectType: 'department',
      subjectId: row.id,
      subjectLabel: `${entityCode} - ${name}`,
      entityId,
      newValue: { name, status: 'ACTIVE' },
    });

    summary.departmentsCreated += 1;
  }
}

export async function seedOrganizationStructure(pool: Pool): Promise<SeedSummary> {
  const summary: SeedSummary = {
    organizationsCreated: 0,
    entitiesCreated: 0,
    departmentsCreated: 0,
    alreadyPresent: false,
  };

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const organization = await seedOrganization(client, summary);

    const holdingId = await seedEntity(client, summary, organization.id, HOLDING_ENTITY, null);
    await seedDepartments(client, summary, holdingId, HOLDING_ENTITY.code);

    for (const subsidiary of SUBSIDIARY_ENTITIES) {
      const subsidiaryId = await seedEntity(
        client,
        summary,
        organization.id,
        subsidiary,
        holdingId,
      );
      await seedDepartments(client, summary, subsidiaryId, subsidiary.code);
    }

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  summary.alreadyPresent =
    summary.organizationsCreated === 0 &&
    summary.entitiesCreated === 0 &&
    summary.departmentsCreated === 0;

  return summary;
}
