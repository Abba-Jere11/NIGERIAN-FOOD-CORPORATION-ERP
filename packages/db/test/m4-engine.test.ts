/**
 * M4 worked example and negative cases, run against the real API services.
 *
 * Spec names Amina / Tunde / Chidi map to the seeded users Musa (`gm.yfz`),
 * Halima (`ed.operations`) and Abubakar (`md`). Behaviour is exact; only the
 * display names differ.
 */
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import {
  DEFAULT_ROLE_GRANTS,
  DUMMY_WORKFLOW_KEY,
  PROCUREMENT_WORKFLOW_KEY,
  SEED_USERS,
  type PermissionKey,
} from '@nfc/shared';
import type { ActorContext } from '../src/session';
import { findRepositoryRoot } from '../src/env';
import { UnitOfWork } from '../../../apps/api/src/database/unit-of-work';
import { DocumentsService } from '../../../apps/api/src/documents/documents.service';
import { FileStorageDriver } from '../../../apps/api/src/documents/file-storage';
import { NoopMalwareScanner, RejectingMalwareScanner } from '../../../apps/api/src/documents/malware';
import { SealsService } from '../../../apps/api/src/seals/seals.service';
import { WorkflowsService } from '../../../apps/api/src/workflows/workflows.service';
import { resetApiEnvCache } from '../../../apps/api/src/config/env';
import {
  ForbiddenError,
  ReasonRequiredError,
  StaleRecordError,
  ValidationFailedError,
} from '../../../apps/api/src/common/errors/domain-error';
import { appPool, entityIdFor, ownerPool } from './support';

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

function ensureApiEnv(): void {
  process.env.SESSION_SECRET ??= 'test-session-secret-not-for-production-use-32';
  process.env.MFA_ENCRYPTION_KEY ??=
    '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
  process.env.DOCUMENT_ENCRYPTION_KEY ??=
    '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
  process.env.SEAL_SIGNING_KEYS ??= JSON.stringify({
    v1: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    v2: 'fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210',
  });
  process.env.SEAL_ACTIVE_KID ??= 'v1';
  process.env.DOCUMENT_STORAGE ??= 'fs';
  resetApiEnvCache();
}

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

describe('M4 documents, seals and approval engine', () => {
  let owner: Pool;
  let app: Pool;
  let yfz: string;
  let dma: string;
  let uow: UnitOfWork;
  let workflows: WorkflowsService;
  let documents: DocumentsService;
  let seals: SealsService;
  let musa: ActorContext;
  let halima: ActorContext;
  let abubakar: ActorContext;
  let admin: ActorContext;
  let emeka: ActorContext;
  let dmaGm: ActorContext;

  beforeAll(async () => {
    ensureApiEnv();
    owner = ownerPool('nfc-erp-test-m4-owner');
    app = appPool('nfc-erp-test-m4-app');
    yfz = await entityIdFor(owner, 'YFZ');
    dma = await entityIdFor(owner, 'DMA');
    uow = new UnitOfWork(app);
    seals = new SealsService();
    workflows = new WorkflowsService(uow, seals);
    documents = new DocumentsService(uow, new FileStorageDriver(), new NoopMalwareScanner());
    musa = actorFromSeed('gm.yfz@nfc.local', [yfz]);
    halima = actorFromSeed('ed.operations@nfc.local', [yfz, dma]);
    abubakar = actorFromSeed('md@nfc.local', [yfz, dma]);
    admin = actorFromSeed('administrator@nfc.local', [yfz, dma]);
    emeka = actorFromSeed('ed.finance@nfc.local', [yfz, dma]);
    dmaGm = actorFromSeed('gm.dma@nfc.local', [dma]);
  });

  afterAll(async () => {
    await Promise.all([owner.end(), app.end()]);
  });

  async function startProcurement(title: string) {
    return workflows.createAndSubmit(musa, title, PROCUREMENT_WORKFLOW_KEY);
  }

  it('stores ciphertext that is not the plaintext', async () => {
    const uploaded = await documents.upload(musa, {
      title: `Cipher ${randomUUID()}`,
      category: 'general',
      context: 'general',
      entityId: yfz,
      file: { buffer: PNG, originalname: 'plain.png' },
    });
    const stored = await owner.query<{ storage_key: string }>(
      `SELECT storage_key FROM document_versions WHERE id = $1`,
      [uploaded.currentVersion.id],
    );
    const key = stored.rows[0]?.storage_key;
    expect(key).toBeTruthy();
    const ciphertext = await readFile(join(findRepositoryRoot(), 'data', 'documents', key ?? ''));
    expect(ciphertext.equals(PNG)).toBe(false);
    expect(ciphertext.includes(PNG.subarray(0, 8))).toBe(false);
  });

  it('lets MD and ED Finance see version history that the GM cannot', async () => {
    const uploaded = await documents.upload(musa, {
      title: `Invoice ${randomUUID()}`,
      category: 'general',
      context: 'general',
      entityId: yfz,
      file: { buffer: PNG, originalname: 'Invoice.png' },
    });
    const firstVersion = uploaded.currentVersion.id;
    await documents.replace(musa, uploaded.id, {
      reason: 'Corrected scan of the vendor invoice.',
      context: 'general',
      file: { buffer: PNG, originalname: 'Invoice-v2.png' },
    });

    const gmView = await documents.get(musa, uploaded.id);
    expect(gmView.versions.map((row) => row.versionNumber)).toEqual([2]);

    const mdView = await documents.get(abubakar, uploaded.id);
    expect(mdView.versions.map((row) => row.versionNumber)).toEqual([1, 2]);

    const financeView = await documents.get(emeka, uploaded.id);
    expect(financeView.versions.map((row) => row.versionNumber)).toEqual([1, 2]);

    await expect(documents.mintDownloadUrl(musa, uploaded.id, firstVersion)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    const minted = await documents.mintDownloadUrl(abubakar, uploaded.id, firstVersion);
    expect(minted.url).toContain('token=');

    await expect(documents.upload(admin, {
      title: 'Admin should fail',
      category: 'general',
      context: 'general',
      entityId: yfz,
      file: { buffer: PNG, originalname: 'a.png' },
    })).rejects.toBeInstanceOf(ForbiddenError);

    await expect(documents.get(dmaGm, uploaded.id)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('rejects a file the malware scanner flags', async () => {
    const rejecting = new DocumentsService(uow, new FileStorageDriver(), new RejectingMalwareScanner());
    await expect(
      rejecting.upload(musa, {
        title: 'Infected',
        category: 'general',
        context: 'general',
        entityId: yfz,
        file: { buffer: PNG, originalname: 'bad.png' },
      }),
    ).rejects.toBeInstanceOf(ValidationFailedError);
  });

  it('walks Musa → Halima approve → Abubakar reject and releases the commitment', async () => {
    const submitted = await startProcurement(`Reject branch ${randomUUID()}`);
    expect(submitted.currentStageKey).toBe('ed-operations');
    expect(submitted.history).toHaveLength(0);
    expect(submitted.seals.some((seal) => seal.badgeLabel === 'REQUESTED BY')).toBe(true);

    const approved = await workflows.act(halima, {
      instanceId: submitted.id,
      action: 'APPROVE',
      rowVersion: submitted.rowVersion,
    });
    expect(approved.currentStageKey).toBe('md');
    expect(approved.seals.some((seal) => seal.badgeLabel === 'FINANCE APPROVED')).toBe(true);
    expect(approved.seals.every((seal) => seal.verification === 'VALID')).toBe(true);

    await expect(
      workflows.act(abubakar, {
        instanceId: approved.id,
        action: 'REJECT',
        rowVersion: approved.rowVersion,
      }),
    ).rejects.toBeInstanceOf(ReasonRequiredError);

    const rejected = await workflows.act(abubakar, {
      instanceId: approved.id,
      action: 'REJECT',
      reason: 'The quoted machine is not in the approved capex list.',
      rowVersion: approved.rowVersion,
    });
    expect(rejected.status).toBe('REJECTED');
    expect(rejected.seals.some((seal) => seal.badgeLabel === 'REJECTED')).toBe(true);

    const commitments = await owner.query<{ action: string }>(
      `SELECT action FROM demo_commitment_events WHERE subject_id = $1 ORDER BY created_at`,
      [rejected.subjectId],
    );
    expect(commitments.rows.map((row) => row.action)).toEqual(['OPEN', 'RELEASE']);

    const events = await owner.query<{ event_type: string }>(
      `SELECT event_type FROM domain_events WHERE subject_id = $1 AND event_type = 'procurement.rejected'`,
      [rejected.subjectId],
    );
    expect(events.rows.length).toBeGreaterThan(0);

    const pending = await workflows.pending(halima);
    expect(pending.some((row) => row.id === rejected.id)).toBe(false);
  });

  it('returns to Musa (not Halima), freezes version 1, and resubmits at ed-operations', async () => {
    const submitted = await startProcurement(`Return branch ${randomUUID()}`);
    const approved = await workflows.act(halima, {
      instanceId: submitted.id,
      action: 'APPROVE',
      rowVersion: submitted.rowVersion,
    });

    await expect(
      workflows.act(abubakar, {
        instanceId: approved.id,
        action: 'RETURN_FOR_CORRECTION',
        rowVersion: approved.rowVersion,
      }),
    ).rejects.toBeInstanceOf(ReasonRequiredError);

    const returned = await workflows.act(abubakar, {
      instanceId: approved.id,
      action: 'RETURN_FOR_CORRECTION',
      reason: 'Add a comparative quote from a second vendor.',
      rowVersion: approved.rowVersion,
    });
    expect(returned.status).toBe('DRAFT');
    expect(returned.subjectVersion).toBe(2);
    expect(returned.originatorUserId).toBe(musa.ref);
    const asOriginator = await workflows.get(musa, returned.id);
    expect(asOriginator.allowedActions).toContain('RESUBMIT');
    expect(returned.seals.some((seal) => seal.badgeLabel === 'RETURNED FOR CORRECTION')).toBe(true);
    expect(returned.seals.filter((seal) => seal.subjectVersion === 1).every((seal) => seal.verification === 'VALID')).toBe(
      true,
    );

    const versions = await owner.query<{ version: number }>(
      `SELECT version FROM workflow_demo_subject_versions WHERE subject_id = $1 ORDER BY version`,
      [returned.subjectId],
    );
    expect(versions.rows.map((row) => row.version)).toEqual([1, 2]);

    const pendingHalima = await workflows.pending(halima);
    expect(pendingHalima.some((row) => row.id === returned.id)).toBe(false);
    const pendingMusa = await workflows.pending(musa);
    expect(pendingMusa.some((row) => row.id === returned.id)).toBe(true);

    await expect(workflows.resubmit(halima, returned.id, returned.rowVersion)).rejects.toBeInstanceOf(
      ForbiddenError,
    );

    const resubmitted = await workflows.resubmit(musa, returned.id, returned.rowVersion);
    expect(resubmitted.status).toBe('IN_PROGRESS');
    expect(resubmitted.currentStageKey).toBe('ed-operations');
    expect(resubmitted.subjectVersion).toBe(2);
    expect(resubmitted.seals.some((seal) => seal.subjectVersion === 1 && seal.verification === 'VALID')).toBe(
      true,
    );
  });

  it('lets Abubakar archive, refuses the Administrator, and drops the item from pending', async () => {
    const submitted = await startProcurement(`Archive ${randomUUID()}`);
    await expect(
      workflows.act(admin, {
        instanceId: submitted.id,
        action: 'ARCHIVE',
        reason: 'Administrator must not archive.',
        rowVersion: submitted.rowVersion,
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);

    const archived = await workflows.act(abubakar, {
      instanceId: submitted.id,
      action: 'ARCHIVE',
      reason: 'Parked before payment while quotes are collected.',
      rowVersion: submitted.rowVersion,
    });
    expect(archived.status).toBe('ARCHIVED');
    const actions = await owner.query<{ id: string }>(
      `SELECT id FROM workflow_actions WHERE instance_id = $1`,
      [archived.id],
    );
    expect(actions.rows.length).toBeGreaterThan(0);
    const pending = await workflows.pending(halima);
    expect(pending.some((row) => row.id === archived.id)).toBe(false);
  });

  it('refuses self-approve, skip-stage, double-stage approve and dummy-v1 starts at reviewer-a', async () => {
    const submitted = await startProcurement(`Guards ${randomUUID()}`);
    await expect(
      workflows.act(musa, {
        instanceId: submitted.id,
        action: 'APPROVE',
        rowVersion: submitted.rowVersion,
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);

    await expect(
      workflows.act(abubakar, {
        instanceId: submitted.id,
        action: 'APPROVE',
        rowVersion: submitted.rowVersion,
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);

    const dual = actorFromSeed('ed.operations@nfc.local', [yfz, dma], ['procurement.approve.final']);
    const first = await workflows.act(dual, {
      instanceId: submitted.id,
      action: 'APPROVE',
      rowVersion: submitted.rowVersion,
    });
    await expect(
      workflows.act(dual, {
        instanceId: first.id,
        action: 'APPROVE',
        rowVersion: first.rowVersion,
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);

    const dummy = await workflows.createAndSubmit(musa, `Dummy ${randomUUID()}`, DUMMY_WORKFLOW_KEY);
    expect(dummy.definitionKey).toBe(DUMMY_WORKFLOW_KEY);
    expect(dummy.currentStageKey).toBe('reviewer-a');
    expect(dummy.history).toHaveLength(0);
  });

  it('lets only one of two concurrent approves succeed', async () => {
    const submitted = await startProcurement(`Concurrent ${randomUUID()}`);
    const results = await Promise.allSettled([
      workflows.act(halima, {
        instanceId: submitted.id,
        action: 'APPROVE',
        rowVersion: submitted.rowVersion,
      }),
      workflows.act(halima, {
        instanceId: submitted.id,
        action: 'APPROVE',
        rowVersion: submitted.rowVersion,
      }),
    ]);
    const fulfilled = results.filter((row) => row.status === 'fulfilled');
    const rejected = results.filter((row) => row.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    const failed = rejected[0];
    expect(failed?.status).toBe('rejected');
    if (failed?.status === 'rejected') {
      expect(failed.reason).toBeInstanceOf(StaleRecordError);
    }
    const winner = fulfilled[0];
    if (winner?.status === 'fulfilled') {
      expect(winner.value.history).toHaveLength(1);
      expect(winner.value.currentStageKey).toBe('md');
    }
  });

  it('marks a tampered snapshot INVALID and writes an audit row', async () => {
    const submitted = await startProcurement(`Tamper ${randomUUID()}`);
    await uow.write(abubakar, async (tx) => {
      const views = await seals.verifyAll(
        tx,
        submitted.subjectType,
        submitted.subjectId,
        submitted.subjectVersion,
        { title: 'tampered milling machine', version: 1 },
        abubakar,
      );
      expect(views.some((seal) => seal.verification === 'SNAPSHOT_MISMATCH')).toBe(true);
    });
    const audit = await owner.query<{ id: string }>(
      `SELECT id FROM audit_log
        WHERE subject_type = 'seal' AND new_value->>'result' = 'SNAPSHOT_MISMATCH'
          AND new_value->>'viewer' = $1
        ORDER BY occurred_at DESC
        LIMIT 1`,
      [abubakar.ref],
    );
    expect(audit.rows[0]?.id).toBeTruthy();
  });
});
