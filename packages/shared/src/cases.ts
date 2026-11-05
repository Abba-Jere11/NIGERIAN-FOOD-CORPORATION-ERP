export const CASE_STATUSES = ['OPEN', 'IN_PROGRESS', 'CLOSED'] as const;
export type CaseStatus = (typeof CASE_STATUSES)[number];

export const CASE_ACCESS_KINDS = ['ASSIGNEE', 'GRANT', 'CC'] as const;
export type CaseAccessKind = (typeof CASE_ACCESS_KINDS)[number];

export interface CasePersonView {
  id: string;
  name: string;
}

export interface CaseAccessView {
  userId: string;
  userName: string | null;
  kind: CaseAccessKind;
}

export interface CaseCommentView {
  id: string;
  body: string;
  createdBy: string;
  createdByName: string | null;
  createdAt: string;
}

export interface CaseListItemView {
  id: string;
  referenceNumber: string;
  title: string;
  status: CaseStatus;
  entityId: string;
  assignedUserId: string | null;
  assignedUserName: string | null;
  updatedAt: string;
}

export interface CaseView extends CaseListItemView {
  body: string;
  createdBy: string;
  createdByName: string | null;
  createdAt: string;
  rowVersion: number;
  access: CaseAccessView[];
  comments: CaseCommentView[];
  myKind: CaseAccessKind | 'OWNER' | null;
}
