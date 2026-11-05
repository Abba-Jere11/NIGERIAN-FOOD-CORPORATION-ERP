import type { DocumentVersionView } from './api-contract';
import type { RoleKey } from './org';

export const EDMS_MODULES = ['procurement', 'finance', 'hr', 'inventory', 'administrative'] as const;
export type EdmsModule = (typeof EDMS_MODULES)[number];

export const EDMS_MODULE_FOLDER_NAMES: Record<EdmsModule, string> = {
  procurement: 'Procurement',
  finance: 'Finance',
  hr: 'HR',
  inventory: 'Inventory',
  administrative: 'Administrative',
};

export const EDMS_FOLDER_KINDS = ['space', 'module', 'year', 'package', 'slot', 'user'] as const;
export type EdmsFolderKind = (typeof EDMS_FOLDER_KINDS)[number];

export const EDMS_CONFIDENTIALITY = ['INTERNAL', 'RESTRICTED', 'CONFIDENTIAL'] as const;
export type EdmsConfidentiality = (typeof EDMS_CONFIDENTIALITY)[number];

export const EDMS_PROCUREMENT_SLOTS = [
  { slot: '01', label: 'Memo' },
  { slot: '02', label: 'Invoice' },
  { slot: '03', label: 'Approval Documents' },
  { slot: '04', label: 'Funding' },
  { slot: '05', label: 'Payment Proof' },
  { slot: '06', label: 'Delivery' },
  { slot: '07', label: 'Vendor Receipt' },
  { slot: '08', label: 'Completion Record' },
  { slot: '09', label: 'Audit Record' },
] as const;

export interface EdmsAccessView {
  allowed: boolean;
}

export interface EdmsGatewayEntityView {
  id: string;
  code: string;
  name: string;
  type: string;
  /** Listed documents filed under this entity (all folders). */
  documentCount: number;
}

export interface EdmsGatewayView {
  admin: boolean;
  entities: EdmsGatewayEntityView[];
}

export interface EdmsFolderNodeView {
  id: string;
  name: string;
  kind: EdmsFolderKind;
  status: string;
  documentCount: number;
  children: EdmsFolderNodeView[];
}

export interface EdmsTreeView {
  entityId: string;
  entityCode: string;
  entityName: string;
  active: EdmsFolderNodeView | null;
  archived: EdmsFolderNodeView | null;
}

export interface EdmsFolderDocumentView {
  id: string;
  referenceNumber: string;
  title: string;
  category: string;
  status: string;
  slot: string | null;
  mimeType: string;
  originalFilename: string;
  currentVersionNumber: number;
  uploadedAt: string;
  uploadedByName: string | null;
}

export interface EdmsFolderView {
  id: string;
  entityId: string;
  entityCode: string;
  entityName: string;
  name: string;
  kind: EdmsFolderKind;
  status: string;
  breadcrumb: Array<{ id: string; name: string }>;
  children: Array<{ id: string; name: string; kind: EdmsFolderKind; status: string; documentCount: number }>;
  documents: EdmsFolderDocumentView[];
  readOnly: boolean;
}

export interface EdmsShareView {
  id: string;
  granteeUserId: string | null;
  granteeRole: RoleKey | null;
  granteeName: string;
  expiresAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

export interface EdmsAccessLogView {
  id: string;
  action: string;
  actorRef: string;
  actorName: string | null;
  occurredAt: string;
}

export interface EdmsRelatedRecordView {
  ownerType: string;
  ownerId: string | null;
  procurementId: string | null;
  procurementReference: string | null;
  entityId: string;
  entityCode: string | null;
  entityName: string | null;
  financeId: string | null;
  inventoryId: string | null;
  employeeId: string | null;
  projectId: string | null;
}

export interface EdmsDocumentView {
  id: string;
  referenceNumber: string;
  title: string;
  category: string;
  categoryId: string | null;
  categoryName: string | null;
  confidentiality: EdmsConfidentiality;
  status: string;
  legalHold: boolean;
  retentionReviewOn: string | null;
  entityId: string;
  entityCode: string | null;
  folderId: string | null;
  folderPath: string[];
  tags: Array<{ id: string; key: string; name: string }>;
  currentVersion: DocumentVersionView;
  versions: DocumentVersionView[];
  related: EdmsRelatedRecordView;
  shares: EdmsShareView[];
  accessLog: EdmsAccessLogView[];
  rowVersion: number;
}

export interface EdmsSearchHitView {
  id: string;
  referenceNumber: string | null;
  title: string;
  entityId: string;
  entityCode: string | null;
  href: string;
}

export interface EdmsCategoryView {
  id: string;
  key: string;
  name: string;
  module: EdmsModule;
  retainYears: number;
  requiresApproval: boolean;
  confidentiality: EdmsConfidentiality;
  status: string;
}

export interface EdmsTagView {
  id: string;
  key: string;
  name: string;
  status: string;
}

export interface EdmsLegalHoldView {
  id: string;
  documentId: string | null;
  folderId: string | null;
  reason: string;
  placedBy: string;
  releasedAt: string | null;
  createdAt: string;
}

export interface EdmsPackageView {
  folderId: string;
  entityCode: string;
  href: string;
}
