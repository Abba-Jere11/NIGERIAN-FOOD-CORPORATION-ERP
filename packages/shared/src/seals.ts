/**
 * Seal / integrity vocabulary (A6 / M4B).
 *
 * The visual badge is a rendering of a server-signed record. There is no
 * upload path and no client-generated signature.
 */

export const SEAL_ACTIONS = [
  'submitted',
  'need_approved',
  'prepared',
  'operations_reviewed',
  'procurement_approved',
  'approved',
  'rejected',
  'returned',
  'paid',
  'verified',
] as const;

export type SealAction = (typeof SEAL_ACTIONS)[number];

export function isSealAction(value: string): value is SealAction {
  return (SEAL_ACTIONS as readonly string[]).includes(value);
}

export const SEAL_BADGE_LABELS: Record<SealAction, string> = {
  submitted: 'REQUESTED BY',
  need_approved: 'NEED APPROVED',
  prepared: 'PREPARED BY',
  operations_reviewed: 'OPERATIONS REVIEWED',
  procurement_approved: 'PROCUREMENT APPROVED',
  approved: 'FINANCE APPROVED',
  rejected: 'REJECTED',
  returned: 'RETURNED FOR CORRECTION',
  paid: 'PAID BY',
  verified: 'DELIVERY VERIFIED BY',
};

export const SEAL_VERIFY_RESULTS = ['VALID', 'INVALID_SIGNATURE', 'SNAPSHOT_MISMATCH'] as const;

export type SealVerifyResult = (typeof SEAL_VERIFY_RESULTS)[number];

export interface SealPayload {
  approverId: string;
  approverRole: string | null;
  entityId: string;
  subjectType: string;
  subjectId: string;
  subjectVersion: number;
  snapshotHash: string;
  action: SealAction;
  timestamp: string;
  kid: string;
  referenceNumber: string;
  reason: string | null;
  paymentRef: string | null;
}

export interface SealView {
  id: string;
  referenceNumber: string;
  action: SealAction;
  badgeLabel: string;
  approverId: string;
  approverName: string;
  approverRole: string | null;
  approverRoleLabel: string | null;
  entityId: string;
  entityCode: string | null;
  entityName: string | null;
  subjectType: string;
  subjectId: string;
  subjectVersion: number;
  snapshotHash: string;
  reason: string | null;
  paymentRef: string | null;
  kid: string;
  occurredAt: string;
  verification: SealVerifyResult;
}
