import type { PermissionKey } from './permissions';
import type { ProcurementUrgency } from './procurement';

export const REQUISITION_STATUSES = [
  'DRAFT',
  'SUBMITTED',
  'NEED_APPROVED',
  'RETURNED',
  'REJECTED',
  'ARCHIVED',
  'DISCARDED',
] as const;
export type RequisitionStatus = (typeof REQUISITION_STATUSES)[number];

export function isRequisitionStatus(value: string): value is RequisitionStatus {
  return (REQUISITION_STATUSES as readonly string[]).includes(value);
}

export const REQUISITION_NAV_PERMISSIONS: readonly PermissionKey[] = [
  'requisition.create',
  'requisition.approve.need',
  'procurement.view',
];

export function hasRequisitionNavPermission(permissions: readonly string[]): boolean {
  return REQUISITION_NAV_PERMISSIONS.some((key) => permissions.includes(key));
}

export interface RequisitionLineView {
  id: string;
  lineNumber: number;
  description: string;
  quantity: number;
  unitId: string | null;
  unitCode: string | null;
  unitName: string | null;
}

export interface RequisitionMemoLine {
  lineNumber: number;
  description: string;
  quantity: number;
  unitCode: string;
  unitName: string;
}

export interface RequisitionMemoSnapshot {
  templateVersion: number;
  referenceNumber: string;
  title: string;
  memoDate: string;
  originatorName: string;
  originatorPosition: string;
  entityCode: string;
  entityName: string;
  departmentName: string;
  categoryName: string;
  background: string;
  justification: string;
  prayer: string;
  requiredDate: string;
  deliveryLocation: string;
  urgency: string;
  version: number;
  lines: RequisitionMemoLine[];
}

export interface RequisitionView {
  id: string;
  referenceNumber: string;
  entityId: string;
  entityCode: string | null;
  entityName: string | null;
  departmentId: string | null;
  departmentName: string | null;
  originatorUserId: string;
  originatorName: string | null;
  originatorPosition: string | null;
  currentVersion: number;
  status: RequisitionStatus;
  title: string;
  background: string | null;
  justification: string | null;
  prayer: string | null;
  categoryId: string | null;
  categoryKey: string | null;
  categoryName: string | null;
  operationsMachinery: boolean;
  requiredDate: string | null;
  urgency: ProcurementUrgency;
  deliveryLocation: string | null;
  versionId: string;
  rowVersion: number;
  createdAt: string;
  procurementRequestId: string | null;
  procurementReference: string | null;
  workflowInstanceId: string | null;
  memoSnapshotHash: string | null;
  pdfDocumentId: string | null;
  lastReturnReason: string | null;
  lines: RequisitionLineView[];
}

export const REQUISITION_MEMO_TEMPLATE_VERSION = 1;
