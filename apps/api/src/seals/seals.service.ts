import { Injectable } from '@nestjs/common';
import type { ActorContext } from '@nfc/db';
import { hmacSha256Hex, parseSigningKeyHex, snapshotHash } from '@nfc/db';
import type { TxScope } from '../database/unit-of-work';
import {
  ROLES,
  SEAL_BADGE_LABELS,
  type RoleKey,
  type SealAction,
  type SealPayload,
  type SealVerifyResult,
  type SealView,
  canonicalize,
  isRoleKey,
} from '@nfc/shared';
import { loadApiEnv } from '../config/env';

interface SealRow {
  id: string;
  reference_number: string;
  approver_id: string;
  approver_name: string | null;
  approver_role: string | null;
  entity_id: string;
  entity_code: string | null;
  entity_name: string | null;
  subject_type: string;
  subject_id: string;
  subject_version: number;
  snapshot_hash: string;
  action: SealAction;
  reason: string | null;
  payment_ref: string | null;
  kid: string;
  signature: string;
  signed_at: string;
  occurred_at: Date;
}

export function parseSealSigningKeys(raw: string): Record<string, Buffer> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('SEAL_SIGNING_KEYS must be a JSON object of kid to hex key.');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('SEAL_SIGNING_KEYS must be a JSON object of kid to hex key.');
  }
  const keys: Record<string, Buffer> = {};
  for (const [kid, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof value !== 'string') {
      throw new Error(`Seal signing key "${kid}" must be a hex string.`);
    }
    keys[kid] = parseSigningKeyHex(value);
  }
  if (Object.keys(keys).length === 0) {
    throw new Error('SEAL_SIGNING_KEYS must contain at least one key.');
  }
  return keys;
}

@Injectable()
export class SealsService {
  private keys(): Record<string, Buffer> {
    return parseSealSigningKeys(loadApiEnv().SEAL_SIGNING_KEYS);
  }

  private activeKid(): string {
    const kid = loadApiEnv().SEAL_ACTIVE_KID;
    if (!this.keys()[kid]) {
      throw new Error(`SEAL_ACTIVE_KID "${kid}" is not present in SEAL_SIGNING_KEYS.`);
    }
    return kid;
  }

  signPayload(payload: SealPayload): string {
    const key = this.keys()[payload.kid];
    if (!key) throw new Error(`Unknown seal key id "${payload.kid}".`);
    return hmacSha256Hex(key, canonicalize(payload));
  }

  verify(seal: SealRow | SealView & { signature?: string; kid: string }, currentSnapshot: unknown): SealVerifyResult {
    const payload = this.payloadFromSeal(seal);
    const key = this.keys()[payload.kid];
    if (!key) return 'INVALID_SIGNATURE';
    const expected = hmacSha256Hex(key, canonicalize(payload));
    const signature = 'signature' in seal ? (seal as SealRow).signature : undefined;
    if (!signature || expected !== signature) return 'INVALID_SIGNATURE';
    const current = snapshotHash(currentSnapshot);
    if (current !== payload.snapshotHash) return 'SNAPSHOT_MISMATCH';
    return 'VALID';
  }

  async create(
    tx: TxScope,
    input: {
      actor: ActorContext;
      entityId: string;
      subjectType: string;
      subjectId: string;
      subjectVersion: number;
      snapshot: unknown;
      action: SealAction;
      reason?: string | null;
      paymentRef?: string | null;
      occurredAt?: Date;
    },
  ): Promise<SealRow> {
    const allocated = await tx.client.query<{ ref: string }>(
      'SELECT app.next_reference($1, NULL) AS ref',
      ['SEAL'],
    );
    const reference = allocated.rows[0]?.ref;
    if (!reference) throw new Error('The seal reference was not allocated.');
    const occurredAt = input.occurredAt ?? new Date();
    const kid = this.activeKid();
    const payload: SealPayload = {
      approverId: input.actor.ref,
      approverRole: input.actor.role,
      entityId: input.entityId,
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      subjectVersion: input.subjectVersion,
      snapshotHash: snapshotHash(input.snapshot),
      action: input.action,
      timestamp: occurredAt.toISOString(),
      kid,
      referenceNumber: reference,
      reason: input.reason ?? null,
      paymentRef: input.paymentRef ?? null,
    };
    const signature = this.signPayload(payload);
    const inserted = await tx.client.query<SealRow>(
      `INSERT INTO seals (
         reference_number, approver_id, approver_role, entity_id, subject_type, subject_id,
         subject_version, snapshot_hash, action, reason, payment_ref, kid, signature, signed_at, occurred_at, created_by
       ) VALUES ($1, $2::uuid, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $2::text)
       RETURNING *`,
      [
        reference,
        input.actor.ref,
        input.actor.role,
        input.entityId,
        input.subjectType,
        input.subjectId,
        input.subjectVersion,
        payload.snapshotHash,
        input.action,
        input.reason ?? null,
        input.paymentRef ?? null,
        kid,
        signature,
        payload.timestamp,
        occurredAt,
      ],
    );
    const row = inserted.rows[0];
    if (!row) throw new Error('The seal was not written.');
    return row;
  }

  async verifyAll(
    tx: TxScope,
    subjectType: string,
    subjectId: string,
    subjectVersion: number,
    currentSnapshot: unknown,
    viewer: ActorContext,
    snapshotsByVersion?: ReadonlyMap<number, unknown>,
    frozenSnapshots: readonly unknown[] = [],
  ): Promise<SealView[]> {
    const result = await tx.client.query<SealRow>(
      `SELECT s.*, app.user_public_name(s.approver_id) AS approver_name,
              e.code AS entity_code, e.name AS entity_name
         FROM seals s
         JOIN entities e ON e.id = s.entity_id
        WHERE s.subject_type = $1 AND s.subject_id = $2
        ORDER BY s.occurred_at`,
      [subjectType, subjectId],
    );
    const views: SealView[] = [];
    for (const row of result.rows) {
      const mapped = snapshotsByVersion?.get(row.subject_version);
      const sameVersion = row.subject_version === subjectVersion ? currentSnapshot : undefined;
      const candidates = [mapped, sameVersion, currentSnapshot, ...frozenSnapshots].filter(
        (snapshot): snapshot is unknown => snapshot !== undefined,
      );
      let verification = this.verify(row, candidates[0] ?? currentSnapshot);
      if (verification === 'SNAPSHOT_MISMATCH') {
        for (const snapshot of candidates.slice(1)) {
          const next = this.verify(row, snapshot);
          if (next === 'VALID') {
            verification = 'VALID';
            break;
          }
        }
      }
      if (verification !== 'VALID') {
        await tx.audit({
          action: 'document_access',
          subjectType: 'seal',
          subjectId: row.id,
          subjectLabel: row.reference_number,
          subjectReferenceNumber: row.reference_number,
          entityId: row.entity_id,
          reason: 'Seal verification failed',
          newValue: {
            result: verification,
            expectedHash: row.snapshot_hash,
            recomputedHash: snapshotHash(currentSnapshot),
            sealId: row.id,
            viewer: viewer.ref,
          },
        });
      }
      views.push(this.toView(row, verification));
    }
    return views;
  }

  toView(row: SealRow, verification: SealVerifyResult): SealView {
    const role = row.approver_role && isRoleKey(row.approver_role) ? (row.approver_role as RoleKey) : null;
    return {
      id: row.id,
      referenceNumber: row.reference_number,
      action: row.action,
      badgeLabel: SEAL_BADGE_LABELS[row.action],
      approverId: row.approver_id,
      approverName: row.approver_name ?? row.approver_id,
      approverRole: row.approver_role,
      approverRoleLabel: role ? ROLES[role].name : row.approver_role,
      entityId: row.entity_id,
      entityCode: row.entity_code,
      entityName: row.entity_name,
      subjectType: row.subject_type,
      subjectId: row.subject_id,
      subjectVersion: row.subject_version,
      snapshotHash: row.snapshot_hash,
      reason: row.reason,
      paymentRef: row.payment_ref,
      kid: row.kid,
      occurredAt: row.occurred_at.toISOString(),
      verification,
    };
  }

  private payloadFromSeal(seal: {
    approver_id?: string;
    approverId?: string;
    approver_role?: string | null;
    approverRole?: string | null;
    entity_id?: string;
    entityId?: string;
    subject_type?: string;
    subjectType?: string;
    subject_id?: string;
    subjectId?: string;
    subject_version?: number;
    subjectVersion?: number;
    snapshot_hash?: string;
    snapshotHash?: string;
    action: SealAction;
    occurred_at?: Date;
    occurredAt?: string;
    kid: string;
    reference_number?: string;
    referenceNumber?: string;
    reason?: string | null;
    payment_ref?: string | null;
    paymentRef?: string | null;
  }): SealPayload {
    const occurred =
      'signed_at' in seal && typeof (seal as { signed_at?: string }).signed_at === 'string'
        ? (seal as { signed_at: string }).signed_at
        : (seal.occurredAt ?? (seal.occurred_at instanceof Date ? seal.occurred_at.toISOString() : ''));
    return {
      approverId: seal.approver_id ?? seal.approverId ?? '',
      approverRole: seal.approver_role ?? seal.approverRole ?? null,
      entityId: seal.entity_id ?? seal.entityId ?? '',
      subjectType: seal.subject_type ?? seal.subjectType ?? '',
      subjectId: seal.subject_id ?? seal.subjectId ?? '',
      subjectVersion: seal.subject_version ?? seal.subjectVersion ?? 0,
      snapshotHash: seal.snapshot_hash ?? seal.snapshotHash ?? '',
      action: seal.action,
      timestamp: occurred,
      kid: seal.kid,
      referenceNumber: seal.reference_number ?? seal.referenceNumber ?? '',
      reason: seal.reason ?? null,
      paymentRef: seal.payment_ref ?? seal.paymentRef ?? null,
    };
  }
}
