export const DOCUMENT_STATUSES = ['ACTIVE', 'ARCHIVED'] as const;
export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number];

export const DOCUMENT_UPLOAD_CONTEXTS = ['procurement', 'edms', 'general', 'vendor_compliance'] as const;
export type DocumentUploadContext = (typeof DOCUMENT_UPLOAD_CONTEXTS)[number];

export const DOCUMENT_ACCESS_ACTIONS = ['VIEW', 'DOWNLOAD', 'SHARE', 'ARCHIVE'] as const;
export type DocumentAccessAction = (typeof DOCUMENT_ACCESS_ACTIONS)[number];

export const PROCUREMENT_DOCUMENT_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
] as const;
