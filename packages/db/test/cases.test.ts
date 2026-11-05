/**
 * M8 confidential cases: ACL visibility, assign ≠ grant, CC comment-only.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { DEFAULT_ROLE_GRANTS, SEED_USERS, type PermissionKey } from '@nfc/shared';
import type { ActorContext } from '../src/session';
import { UnitOfWork } from '../../../apps/api/src/database/unit-of-work';
import { CasesService } from '../../../apps/api/src/cases/cases.service';
import { ForbiddenError, NotFoundError, ValidationFailedError } from '../../../apps/api/src/common/errors/domain-error';
import { appPool, entityIdFor, ownerPool } from './support';

function actorFromSeed(email: string, entityIds: string[], extra: PermissionKey[] = []): ActorContext {
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
    permissions: [...DEFAULT_ROLE_GRANTS[user.role], ...extra],
    homePath: '/',
  };
}

describe('M8 confidential cases', () => {
  let owner: Pool;
  let app: Pool;
  let yfz: string;
  let dma: string;
  let nfc: string;
  let cases: CasesService;
  let abubakar: ActorContext;
  let halima: ActorContext;
  let musa: ActorContext;
  let admin: ActorContext;

  beforeAll(async () => {
    owner = ownerPool('nfc-erp-test-m8-cases-owner');
    app = appPool('nfc-erp-test-m8-cases-app');
    yfz = await entityIdFor(owner, 'YFZ');
    dma = await entityIdFor(owner, 'DMA');
    nfc = await entityIdFor(owner, 'NFC');
    cases = new CasesService(new UnitOfWork(app));
    abubakar = actorFromSeed('md@nfc.local', [yfz, dma, nfc]);
    halima = actorFromSeed('ed.operations@nfc.local', [yfz, dma, nfc]);
    musa = actorFromSeed('gm.yfz@nfc.local', [yfz]);
    admin = actorFromSeed('administrator@nfc.local', []);
  });

  afterAll(async () => {
    await Promise.all([owner.end(), app.end()]);
  });

  it('hides a case from GM and Admin until grant, and assign is not grant', async () => {
    const opened = await cases.create(abubakar, {
      entityId: yfz,
      title: 'M8 ACL fixture',
      body: 'Restricted to the people on the case.',
    });
    expect(opened.referenceNumber.startsWith('CASE-')).toBe(true);
    expect(opened.status).toBe('OPEN');
    expect(opened.myKind).toBe('OWNER');

    await expect(cases.get(musa, opened.id)).rejects.toBeInstanceOf(NotFoundError);
    expect(await cases.list(musa)).toEqual([]);
    expect(await cases.list(admin)).toEqual([]);
    await expect(cases.get(admin, opened.id)).rejects.toBeInstanceOf(NotFoundError);

    await expect(cases.assign(abubakar, opened.id, abubakar.ref)).rejects.toBeInstanceOf(
      ValidationFailedError,
    );

    const granted = await cases.grant(abubakar, opened.id, musa.ref);
    expect(granted.assignedUserId).toBeNull();
    expect(granted.status).toBe('OPEN');
    expect(granted.access.some((row) => row.userId === musa.ref && row.kind === 'GRANT')).toBe(true);

    const asGm = await cases.get(musa, opened.id);
    expect(asGm.myKind).toBe('GRANT');
    expect(asGm.title).toBe('M8 ACL fixture');

    const assigned = await cases.assign(abubakar, opened.id, halima.ref);
    expect(assigned.assignedUserId).toBe(halima.ref);
    expect(assigned.status).toBe('IN_PROGRESS');
    expect(assigned.access.some((row) => row.userId === musa.ref && row.kind === 'GRANT')).toBe(true);
    expect(assigned.access.some((row) => row.userId === halima.ref && row.kind === 'ASSIGNEE')).toBe(
      true,
    );

    const asOps = await cases.get(halima, opened.id);
    expect(asOps.myKind).toBe('ASSIGNEE');
  });

  it('lets CC comment and refuses status or access changes', async () => {
    const opened = await cases.create(abubakar, {
      entityId: yfz,
      title: 'M8 CC fixture',
      body: 'CC may read and comment only.',
    });
    await cases.cc(abubakar, opened.id, musa.ref);

    const cc = actorFromSeed('gm.yfz@nfc.local', [yfz], [
      'cases.assign',
      'cases.grant',
      'cases.close',
    ]);
    const commented = await cases.comment(cc, opened.id, { body: 'Noted from YFZ.' });
    expect(commented.comments.some((row) => row.body === 'Noted from YFZ.')).toBe(true);
    expect(commented.myKind).toBe('CC');

    await expect(cases.setStatus(cc, opened.id, { status: 'CLOSED' })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expect(cases.grant(cc, opened.id, halima.ref)).rejects.toBeInstanceOf(ForbiddenError);

    const closed = await cases.setStatus(abubakar, opened.id, { status: 'CLOSED' });
    expect(closed.status).toBe('CLOSED');
  });
});
