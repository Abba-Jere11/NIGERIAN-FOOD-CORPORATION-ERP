import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { DEFAULT_ROLE_GRANTS, SEED_USERS, type PermissionKey } from '@nfc/shared';
import type { ActorContext } from '../src/session';
import { UnitOfWork } from '../../../apps/api/src/database/unit-of-work';
import { ProcurementService } from '../../../apps/api/src/procurement/procurement.service';
import { WorkflowsService } from '../../../apps/api/src/workflows/workflows.service';
import { SealsService } from '../../../apps/api/src/seals/seals.service';
import { DocumentsService } from '../../../apps/api/src/documents/documents.service';
import { FileStorageDriver } from '../../../apps/api/src/documents/file-storage';
import { NoopMalwareScanner } from '../../../apps/api/src/documents/malware';
import { VendorValidationService } from '../../../apps/api/src/vendors/vendor-validation.service';
import { FinancialChecksService } from '../../../apps/api/src/procurement/financial-checks.service';
import { JournalsService } from '../../../apps/api/src/finance/journals.service';
import { ForbiddenError, NotFoundError } from '../../../apps/api/src/common/errors/domain-error';
import { resetApiEnvCache } from '../../../apps/api/src/config/env';
import { appPool, entityIdFor, ownerPool } from './support';

function actor(email: string, entityIds: string[]): ActorContext {
  const user = SEED_USERS.find((row) => row.email === email);
  if (!user) throw new Error(`Unknown seed user ${email}`);
  return {
    ref: user.id,
    name: user.name,
    role: user.role,
    scopeType: user.scopeType,
    entityIds,
    isCorporate: user.scopeType === 'CORPORATE' && user.role !== 'administrator',
    isAdmin: user.role === 'administrator',
    permissions: [...DEFAULT_ROLE_GRANTS[user.role]] as PermissionKey[],
    homePath: '/',
  };
}

describe('scope bypass (M19)', () => {
  let owner: Pool;
  let app: Pool;
  let yfz: string;
  let dma: string;
  let dmaRequestId: string | null;
  let procurement: ProcurementService;
  let journals: JournalsService;

  beforeAll(async () => {
    process.env.SESSION_SECRET ??= 'test-session-secret-not-for-production-use-32';
    resetApiEnvCache();
    owner = ownerPool('nfc-erp-test-scope-owner');
    app = appPool('nfc-erp-test-scope-app');
    yfz = await entityIdFor(owner, 'YFZ');
    dma = await entityIdFor(owner, 'DMA');
    const uow = new UnitOfWork(app);
    const workflows = new WorkflowsService(uow, new SealsService());
    procurement = new ProcurementService(
      uow,
      workflows,
      new DocumentsService(uow, new FileStorageDriver(), new NoopMalwareScanner()),
      new VendorValidationService(uow),
      new FinancialChecksService(uow),
    );
    journals = new JournalsService(uow, workflows);
    const row = await owner.query<{ id: string }>(
      `SELECT id FROM procurement_requests WHERE entity_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [dma],
    );
    dmaRequestId = row.rows[0]?.id ?? null;
  });

  afterAll(async () => {
    await Promise.all([owner.end(), app.end()]);
  });

  it('YFZ GM cannot read a DMA procurement row by id', async () => {
    if (!dmaRequestId) return;
    const gmYfz = actor('gm.yfz@nfc.local', [yfz]);
    await expect(procurement.get(gmYfz, dmaRequestId)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('MD corporate actor can read cross-entity procurement when permitted', async () => {
    if (!dmaRequestId) return;
    const md = actor('md@nfc.local', [yfz, dma]);
    const view = await procurement.get(md, dmaRequestId);
    expect(view.entityId).toBe(dma);
  });

  it('Administrator receives Forbidden on business procurement list', async () => {
    const admin = actor('administrator@nfc.local', []);
    await expect(procurement.list(admin)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('Administrator receives Forbidden on finance journals list', async () => {
    const admin = actor('administrator@nfc.local', []);
    await expect(journals.list(admin)).rejects.toBeInstanceOf(ForbiddenError);
  });
});
