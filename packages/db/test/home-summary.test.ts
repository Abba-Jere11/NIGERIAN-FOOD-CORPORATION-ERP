import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { DEFAULT_ROLE_GRANTS, SEED_USERS, type PermissionKey } from '@nfc/shared';
import type { ActorContext } from '../src/session';
import { UnitOfWork } from '../../../apps/api/src/database/unit-of-work';
import { HomeService } from '../../../apps/api/src/home/home.service';
import type { JobsService } from '../../../apps/api/src/engines/jobs.service';
import type { NotificationsService } from '../../../apps/api/src/engines/notifications.service';
import { AccountsService } from '../../../apps/api/src/finance/accounts.service';
import { HrService } from '../../../apps/api/src/hr/hr.service';
import { InventoryService } from '../../../apps/api/src/inventory/inventory.service';
import type { ProcurementService } from '../../../apps/api/src/procurement/procurement.service';
import { WorkflowsService } from '../../../apps/api/src/workflows/workflows.service';
import { SealsService } from '../../../apps/api/src/seals/seals.service';
import { EntityDirectory } from '../../../apps/api/src/auth/entity-directory.service';
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
    homePath: '/home/md',
  };
}

describe('corporate home summary', () => {
  let app: Pool;
  let owner: Pool;
  let home: HomeService;
  let yfz: string;
  let dma: string;

  beforeAll(async () => {
    owner = ownerPool('nfc-erp-test-home-owner');
    app = appPool('nfc-erp-test-home-app');
    yfz = await entityIdFor(owner, 'YFZ');
    dma = await entityIdFor(owner, 'DMA');
    const uow = new UnitOfWork(app);
    const workflows = new WorkflowsService(uow, new SealsService());
    home = new HomeService(
      workflows,
      new AccountsService(uow),
      new HrService(uow, workflows),
      new InventoryService(uow),
      { deadLetters: async () => [] } as unknown as JobsService,
      {
        failedDeliveryCount: async () => 0,
        failedMailCount: async () => 0,
      } as unknown as NotificationsService,
      new EntityDirectory(app),
      { myActions: async () => [] } as unknown as ProcurementService,
    );
  });

  afterAll(async () => {
    await Promise.all([owner.end(), app.end()]);
  });

  it('MD sees subsidiaries and no admin-only ops block', async () => {
    const md = actor('md@nfc.local', [yfz, dma]);
    const summary = await home.summary(md);
    expect(summary.roleDashboardPath).toBe('/home/md');
    expect(summary.adminOps).toBeNull();
    expect(summary.subsidiaries.some((row) => row.code === 'YFZ')).toBe(true);
    expect(summary.subsidiaries.some((row) => row.code === 'DMA')).toBe(true);
  });

  it('Administrator corporate summary avoids business procurement counts', async () => {
    const admin = actor('administrator@nfc.local', []);
    admin.isAdmin = true;
    admin.permissions = [...DEFAULT_ROLE_GRANTS.administrator] as PermissionKey[];
    const summary = await home.summary(admin);
    expect(summary.subsidiaries).toEqual([]);
    expect(summary.pendingLines.every((line) => !line.key.includes('awaiting-payment'))).toBe(true);
    expect(summary.adminOps).not.toBeNull();
  });

  it('YFZ GM summary scopes subsidiaries to YFZ only', async () => {
    const gm = actor('gm.yfz@nfc.local', [yfz]);
    const summary = await home.summary(gm);
    expect(summary.subsidiaries.map((row) => row.code)).toEqual(['YFZ']);
  });
});
