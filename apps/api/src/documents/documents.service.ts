import { Inject, Injectable } from '@nestjs/common';
import type { ActorContext } from '@nfc/db';
import { decryptBlob, encryptBlob, sanitizeFilename, sniffMime } from '@nfc/db';
import type { DocumentListItemView, DocumentView, DocumentVersionView, DownloadUrlView } from '@nfc/shared';
import type { DocumentUploadContext } from '@nfc/shared';
import { randomUUID } from 'node:crypto';
import { assertCan, can } from '../auth/can';
import { ForbiddenError, NotFoundError, ReasonRequiredError, ValidationFailedError } from '../common/errors/domain-error';
import { loadApiEnv } from '../config/env';
import type { TxScope } from '../database/unit-of-work';
import { UnitOfWork } from '../database/unit-of-work';
import { signDownloadToken } from './download-tokens';
import { MALWARE_SCANNER, type MalwareScanner } from './malware';
import { STORAGE_DRIVER, type StorageDriver } from './storage';

interface VersionRow {
  id: string;
  document_id: string;
  version_number: number;
  storage_key: string;
  sha256: string;
  size_bytes: string;
  mime_type: string;
  original_filename: string;
  wrapped_key: string;
  iv: Buffer;
  auth_tag: Buffer;
  kek_kid: string;
  uploaded_by: string;
  uploaded_at: Date;
  replacement_reason: string | null;
  uploader_name: string | null;
}

interface DocumentRow {
  id: string;
  reference_number: string;
  owner_type: string;
  owner_id: string | null;
  entity_id: string;
  entity_code: string | null;
  category: string;
  title: string;
  status: string;
  current_version_id: string | null;
  row_version: number;
}

@Injectable()
export class DocumentsService {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    @Inject(STORAGE_DRIVER) private readonly storage: StorageDriver,
    @Inject(MALWARE_SCANNER) private readonly scanner: MalwareScanner,
  ) {}

  async list(actor: ActorContext): Promise<DocumentListItemView[]> {
    return this.unitOfWork.read(actor, async (tx) => {
      const result = await tx.client.query<{
        id: string;
        reference_number: string;
        title: string;
        category: string;
        status: string;
        mime_type: string;
        original_filename: string;
        version_number: number;
        uploaded_at: Date;
        entity_id: string;
        owner_type: string;
        owner_id: string | null;
      }>(
        `SELECT d.id, d.reference_number, d.title, d.category, d.status, d.entity_id, d.owner_type, d.owner_id,
                v.mime_type, v.original_filename, v.version_number, v.uploaded_at
           FROM documents d
           JOIN document_versions v ON v.id = d.current_version_id
          ORDER BY d.created_at DESC`,
      );
      const visible: typeof result.rows = [];
      for (const row of result.rows) {
        if (!can(actor, 'document.view', row.entity_id)) continue;
        if (await this.orgOwnerBlocked(tx.client, row.owner_type, row.owner_id)) continue;
        visible.push(row);
      }
      return visible.map((row) => ({
          id: row.id,
          referenceNumber: row.reference_number,
          title: row.title,
          category: row.category,
          status: row.status,
          mimeType: row.mime_type,
          originalFilename: row.original_filename,
          currentVersionNumber: row.version_number,
          uploadedAt: row.uploaded_at.toISOString(),
          entityId: row.entity_id,
        }));
    });
  }

  async get(actor: ActorContext, id: string): Promise<DocumentView> {
    return this.unitOfWork.write(actor, async (tx) => {
      const doc = await this.loadDocument(tx.client, id);
      assertCan(actor, 'document.view', doc.entity_id);
      await this.assertOrgOwnerAccess(tx.client, doc.owner_type, doc.owner_id);
      const versions = await this.loadVersions(tx.client, id);
      const current = versions.find((row) => row.id === doc.current_version_id);
      if (!current) throw new NotFoundError('This document has no current version.');
      const visible = can(actor, 'document.view_history', doc.entity_id)
        ? versions
        : versions.filter((row) => row.id === doc.current_version_id);
      await this.logAccess(tx, actor, doc, current, 'VIEW');
      return this.toView(doc, current, visible);
    });
  }

  async upload(
    actor: ActorContext,
    input: {
      title: string;
      category: string;
      context: DocumentUploadContext;
      entityId?: string;
      ownerType?: string;
      ownerId?: string;
      categoryId?: string | null;
      confidentiality?: string;
      searchPermission?: 'document.view' | 'edms.view';
      asPermission?: 'document.upload' | 'edms.upload';
      file: { buffer: Buffer; originalname: string };
    },
  ): Promise<DocumentView> {
    const entityId = input.entityId ?? actor.entityIds[0];
    if (!entityId) throw new ValidationFailedError('An entity is required to store a document.');
    if (input.context === 'vendor_compliance') {
      if (!can(actor, 'vendor.create')) {
        throw new ForbiddenError('Your role does not permit this action.', { permission: 'vendor.create' });
      }
    } else {
      assertCan(actor, input.asPermission ?? 'document.upload', entityId);
    }

    const prepared = await this.prepareFile(input.file, input.context);
    const env = loadApiEnv();
    const box = encryptBlob(prepared.buffer, env.DOCUMENT_ENCRYPTION_KEY);
    const versionId = randomUUID();
    const storageKey = `${entityId}/${versionId}.bin`;
    await this.storage.put(storageKey, box.ciphertext);

    return this.unitOfWork.write(actor, async (tx) => {
      const allocated = await tx.client.query<{ ref: string }>(
        'SELECT app.next_reference($1, NULL) AS ref',
        ['DOC'],
      );
      const reference = allocated.rows[0]?.ref;
      if (!reference) throw new Error('The document reference was not allocated.');

      const inserted = await tx.client.query<{ id: string }>(
        `INSERT INTO documents (
           reference_number, owner_type, owner_id, entity_id, category, title,
           category_id, confidentiality, created_by, updated_by
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9)
         RETURNING id`,
        [
          reference,
          input.ownerType ?? 'standalone',
          input.ownerId ?? null,
          entityId,
          input.category,
          input.title.trim(),
          input.categoryId ?? null,
          input.confidentiality ?? 'INTERNAL',
          actor.ref,
        ],
      );
      const documentId = inserted.rows[0]?.id;
      if (!documentId) throw new Error('The document row was not created.');

      await tx.client.query(
        `INSERT INTO document_versions (
           id, document_id, entity_id, version_number, storage_key, sha256, size_bytes, mime_type,
           original_filename, wrapped_key, iv, auth_tag, kek_kid, uploaded_by, created_by
         ) VALUES ($1, $2, $3, 1, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $13)`,
        [
          versionId,
          documentId,
          entityId,
          storageKey,
          box.sha256,
          prepared.buffer.length,
          prepared.mimeType,
          prepared.filename,
          box.wrappedKey,
          box.iv,
          box.authTag,
          box.kekKid,
          actor.ref,
        ],
      );
      await tx.client.query(
        `UPDATE documents SET current_version_id = $1, updated_by = $2 WHERE id = $3`,
        [versionId, actor.ref, documentId],
      );

      await tx.audit({
        action: 'upload',
        subjectType: 'document',
        subjectId: documentId,
        subjectLabel: input.title.trim(),
        subjectReferenceNumber: reference,
        entityId,
        newValue: { filename: prepared.filename, mimeType: prepared.mimeType, version: 1 },
      });
      await tx.publish({
        eventType: 'document.uploaded',
        subjectType: 'document',
        subjectId: documentId,
        entityId,
        payload: {
          type: 'document.uploaded',
          reference,
          title: input.title.trim(),
          recipientUserId: actor.ref,
          href: `/documents/${documentId}`,
        },
      });
      await tx.indexSearch({
        recordType: 'DOCUMENT',
        recordId: documentId,
        referenceNumber: reference,
        title: input.title.trim(),
        searchableText: `${reference} ${input.title} ${prepared.filename}`,
        entityId,
        permissionKey: input.searchPermission ?? 'document.view',
      });
      await tx.appendTimeline({
        subjectType: 'DOCUMENT',
        subjectId: documentId,
        text: `Uploaded ${prepared.filename} as version 1.`,
        href: `/documents/${documentId}`,
        entityId,
      });

      const doc = await this.loadDocument(tx.client, documentId);
      const versions = await this.loadVersions(tx.client, documentId);
      const current = versions[0];
      if (!current) throw new Error('The uploaded version was not readable.');
      return this.toView(doc, current, versions);
    });
  }

  async storeGeneratedPdfInTx(
    tx: TxScope,
    actor: ActorContext,
    input: {
      title: string;
      entityId: string;
      ownerType: string;
      ownerId: string;
      buffer: Buffer;
      filename: string;
      category?: string;
      categoryId?: string | null;
      confidentiality?: string;
    },
  ): Promise<{ documentId: string; sha256: string; reference: string }> {
    const env = loadApiEnv();
    const box = encryptBlob(input.buffer, env.DOCUMENT_ENCRYPTION_KEY);
    const versionId = randomUUID();
    const storageKey = `${input.entityId}/${versionId}.bin`;
    await this.storage.put(storageKey, box.ciphertext);

    const allocated = await tx.client.query<{ ref: string }>(
      'SELECT app.next_reference($1, NULL) AS ref',
      ['DOC'],
    );
    const reference = allocated.rows[0]?.ref;
    if (!reference) throw new Error('The document reference was not allocated.');

    const inserted = await tx.client.query<{ id: string }>(
      `INSERT INTO documents (
         reference_number, owner_type, owner_id, entity_id, category, title,
         category_id, confidentiality, created_by, updated_by
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9)
       RETURNING id`,
      [
        reference,
        input.ownerType,
        input.ownerId,
        input.entityId,
        input.category ?? 'procurement-memo',
        input.title,
        input.categoryId ?? null,
        input.confidentiality ?? 'INTERNAL',
        actor.ref,
      ],
    );
    const documentId = inserted.rows[0]?.id;
    if (!documentId) throw new Error('The document row was not created.');

    await tx.client.query(
      `INSERT INTO document_versions (
         id, document_id, entity_id, version_number, storage_key, sha256, size_bytes, mime_type,
         original_filename, wrapped_key, iv, auth_tag, kek_kid, uploaded_by, created_by
       ) VALUES ($1, $2, $3, 1, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $13)`,
      [
        versionId,
        documentId,
        input.entityId,
        storageKey,
        box.sha256,
        input.buffer.length,
        'application/pdf',
        input.filename,
        box.wrappedKey,
        box.iv,
        box.authTag,
        box.kekKid,
        actor.ref,
      ],
    );
    await tx.client.query(
      `UPDATE documents SET current_version_id = $1, updated_by = $2 WHERE id = $3`,
      [versionId, actor.ref, documentId],
    );
    return { documentId, sha256: box.sha256, reference };
  }

  async replace(
    actor: ActorContext,
    documentId: string,
    input: {
      reason: string;
      context: DocumentUploadContext;
      file: { buffer: Buffer; originalname: string };
      asPermission?: 'document.replace' | 'edms.version.replace';
      searchPermission?: 'document.view' | 'edms.view';
    },
  ): Promise<DocumentView> {
    const reason = input.reason.trim();
    if (reason === '') throw new ReasonRequiredError('replace a document');

    const prepared = await this.prepareFile(input.file, input.context);
    const env = loadApiEnv();
    const box = encryptBlob(prepared.buffer, env.DOCUMENT_ENCRYPTION_KEY);
    const versionId = randomUUID();

    return this.unitOfWork.write(actor, async (tx) => {
      const doc = await this.loadDocument(tx.client, documentId);
      assertCan(actor, input.asPermission ?? 'document.replace', doc.entity_id);
      await this.assertOrgOwnerAccess(tx.client, doc.owner_type, doc.owner_id);
      if (['org_report', 'org_minute', 'org_response', 'org_decision'].includes(doc.owner_type)) {
        const locked = await this.orgOwnerIssued(tx.client, doc.owner_type, doc.owner_id);
        if (locked) {
          throw new ForbiddenError('Issued official records cannot have their attachments silently replaced.');
        }
      }
      const nextVersion = await tx.client.query<{ n: number }>(
        `SELECT coalesce(max(version_number), 0) + 1 AS n FROM document_versions WHERE document_id = $1`,
        [documentId],
      );
      const versionNumber = nextVersion.rows[0]?.n ?? 2;
      const storageKey = `${doc.entity_id}/${versionId}.bin`;
      await this.storage.put(storageKey, box.ciphertext);

      await tx.client.query(
        `INSERT INTO document_versions (
           id, document_id, entity_id, version_number, storage_key, sha256, size_bytes, mime_type,
           original_filename, wrapped_key, iv, auth_tag, kek_kid, uploaded_by, replacement_reason, created_by
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $14)`,
        [
          versionId,
          documentId,
          doc.entity_id,
          versionNumber,
          storageKey,
          box.sha256,
          prepared.buffer.length,
          prepared.mimeType,
          prepared.filename,
          box.wrappedKey,
          box.iv,
          box.authTag,
          box.kekKid,
          actor.ref,
          reason,
        ],
      );
      await tx.client.query(
        `UPDATE documents SET current_version_id = $1, updated_by = $2 WHERE id = $3`,
        [versionId, actor.ref, documentId],
      );
      await tx.audit({
        action: 'upload',
        subjectType: 'document',
        subjectId: documentId,
        subjectLabel: doc.title,
        subjectReferenceNumber: doc.reference_number,
        entityId: doc.entity_id,
        reason,
        newValue: { filename: prepared.filename, version: versionNumber },
      });
      await tx.indexSearch({
        recordType: 'DOCUMENT',
        recordId: documentId,
        referenceNumber: doc.reference_number,
        title: doc.title,
        searchableText: `${doc.reference_number} ${doc.title} ${prepared.filename}`,
        entityId: doc.entity_id,
        permissionKey: input.searchPermission ?? 'document.view',
      });
      await tx.appendTimeline({
        subjectType: 'DOCUMENT',
        subjectId: documentId,
        text: `Replaced with version ${versionNumber}. ${reason}`,
        href: `/documents/${documentId}`,
        entityId: doc.entity_id,
      });

      const updated = await this.loadDocument(tx.client, documentId);
      const versions = await this.loadVersions(tx.client, documentId);
      const current = versions.find((row) => row.id === versionId);
      if (!current) throw new Error('The replacement version was not readable.');
      const visible = can(actor, 'document.view_history', doc.entity_id)
        ? versions
        : versions.filter((row) => row.id === versionId);
      return this.toView(updated, current, visible);
    });
  }

  async mintDownloadUrl(
    actor: ActorContext,
    documentId: string,
    versionId?: string,
  ): Promise<DownloadUrlView> {
    const resolved = await this.resolveDownloadTarget(actor, documentId, versionId);
    const signed = signDownloadToken({
      sub: actor.ref,
      documentId,
      versionId: resolved.version.id,
    });
    return {
      url: `/api/documents/${documentId}/download?token=${encodeURIComponent(signed.token)}&versionId=${resolved.version.id}`,
      expiresAt: signed.expiresAt.toISOString(),
    };
  }

  async streamForActor(
    actor: ActorContext,
    documentId: string,
    versionId?: string,
  ): Promise<{ buffer: Buffer; mimeType: string; filename: string }> {
    const resolved = await this.resolveDownloadTarget(actor, documentId, versionId);
    return this.decryptAndLog(actor, resolved.document, resolved.version);
  }

  async decryptAndLog(
    actor: ActorContext,
    document: DocumentRow,
    version: VersionRow,
  ): Promise<{ buffer: Buffer; mimeType: string; filename: string }> {
    const ciphertext = await this.storage.get(version.storage_key);
    const env = loadApiEnv();
    const buffer = decryptBlob(ciphertext, version.iv, version.auth_tag, version.wrapped_key, env.DOCUMENT_ENCRYPTION_KEY);
    await this.unitOfWork.write(actor, async (tx) => {
      await this.logAccess(tx, actor, document, version, 'DOWNLOAD');
    });
    return { buffer, mimeType: version.mime_type, filename: version.original_filename };
  }

  private async resolveDownloadTarget(
    actor: ActorContext,
    documentId: string,
    versionId?: string,
  ): Promise<{ document: DocumentRow; version: VersionRow }> {
    return this.unitOfWork.read(actor, async (tx) => {
      const document = await this.loadDocument(tx.client, documentId);
      assertCan(actor, 'document.view', document.entity_id);
      await this.assertOrgOwnerAccess(tx.client, document.owner_type, document.owner_id);
      const versions = await this.loadVersions(tx.client, documentId);
      const version = versionId
        ? versions.find((row) => row.id === versionId)
        : versions.find((row) => row.id === document.current_version_id);
      if (!version) throw new NotFoundError('That document version does not exist.');
      if (version.id !== document.current_version_id) {
        assertCan(actor, 'document.view_history', document.entity_id);
      }
      return { document, version };
    });
  }

  private async prepareFile(
    file: { buffer: Buffer; originalname: string },
    context: DocumentUploadContext,
  ): Promise<{ buffer: Buffer; mimeType: string; filename: string }> {
    if (!file.buffer || file.buffer.length === 0) {
      throw new ValidationFailedError('A file is required.');
    }
    const sniffed = sniffMime(file.buffer);
    if (!sniffed) {
      throw new ValidationFailedError('This file type is not recognised. Upload a PDF, JPEG or PNG.');
    }
    const policy = await this.loadPolicy(context);
    if (file.buffer.length > policy.maxBytes) {
      throw new ValidationFailedError(
        `This file is larger than the ${Math.floor(policy.maxBytes / (1024 * 1024))} MB limit for ${context}.`,
      );
    }
    if (!policy.allowedMime.includes(sniffed.mimeType)) {
      throw new ValidationFailedError(`Files of type ${sniffed.mimeType} are not accepted for ${context}.`);
    }
    const scan = await this.scanner.scan(file.buffer, sniffed.mimeType);
    if (!scan.clean) {
      throw new ValidationFailedError(scan.detail ?? 'This file was rejected by the malware scanner.');
    }
    return {
      buffer: file.buffer,
      mimeType: sniffed.mimeType,
      filename: sanitizeFilename(file.originalname),
    };
  }

  private async loadPolicy(context: DocumentUploadContext): Promise<{ maxBytes: number; allowedMime: string[] }> {
    const envActor = {
      ref: 'system:outbox',
      name: 'Policy',
      role: null,
      scopeType: null,
      entityIds: [],
      isCorporate: true,
      isAdmin: true,
      permissions: [],
      homePath: null,
    };
    return this.unitOfWork.read(envActor, async (tx) => {
      const result = await tx.client.query<{ max_bytes: string; allowed_mime_types: string[] }>(
        `SELECT max_bytes::text, allowed_mime_types FROM document_upload_policies WHERE context = $1`,
        [context],
      );
      const row = result.rows[0];
      if (!row) throw new ValidationFailedError(`No upload policy is configured for ${context}.`);
      return { maxBytes: Number(row.max_bytes), allowedMime: row.allowed_mime_types };
    });
  }

  private async orgOwnerBlocked(
    client: { query: (sql: string, values?: unknown[]) => Promise<{ rows: Array<{ ok: boolean }> }> },
    ownerType: string,
    ownerId: string | null,
  ): Promise<boolean> {
    if (!['org_report', 'org_minute', 'org_response', 'org_decision'].includes(ownerType) || !ownerId) {
      return false;
    }
    const result = await client.query(`SELECT app.org_report_document_accessible($1, $2) AS ok`, [
      ownerType,
      ownerId,
    ]);
    return result.rows[0]?.ok !== true;
  }

  private async assertOrgOwnerAccess(
    client: { query: (sql: string, values?: unknown[]) => Promise<{ rows: Array<{ ok: boolean }> }> },
    ownerType: string,
    ownerId: string | null,
  ): Promise<void> {
    if (await this.orgOwnerBlocked(client, ownerType, ownerId)) {
      throw new NotFoundError('That document does not exist.');
    }
  }

  private async orgOwnerIssued(
    client: { query: (sql: string, values?: unknown[]) => Promise<{ rows: Array<{ status: string }> }> },
    ownerType: string,
    ownerId: string | null,
  ): Promise<boolean> {
    if (!ownerId) return false;
    if (ownerType === 'org_report') {
      const result = await client.query(`SELECT status FROM org_reports WHERE id = $1`, [ownerId]);
      return result.rows[0]?.status !== 'DRAFT';
    }
    if (ownerType === 'org_minute') {
      const result = await client.query(`SELECT status FROM org_minutes WHERE id = $1`, [ownerId]);
      return result.rows[0]?.status !== 'DRAFT';
    }
    if (ownerType === 'org_response' || ownerType === 'org_decision') return true;
    return false;
  }

  private async loadDocument(
    client: { query: Function },
    id: string,
  ): Promise<DocumentRow> {
    const result = await client.query(
      `SELECT d.id, d.reference_number, d.owner_type, d.owner_id, d.entity_id, e.code AS entity_code,
              d.category, d.title, d.status, d.current_version_id, d.row_version
         FROM documents d
         JOIN entities e ON e.id = d.entity_id
        WHERE d.id = $1`,
      [id],
    );
    const row = result.rows[0] as DocumentRow | undefined;
    if (!row) throw new NotFoundError('That document does not exist.');
    return row;
  }

  private async loadVersions(client: { query: Function }, documentId: string): Promise<VersionRow[]> {
    const result = await client.query(
      `SELECT v.*, app.user_public_name(CASE WHEN v.uploaded_by ~ '^[0-9a-f-]{36}$' THEN v.uploaded_by::uuid ELSE NULL END) AS uploader_name
         FROM document_versions v
        WHERE v.document_id = $1
        ORDER BY v.version_number`,
      [documentId],
    );
    return result.rows as VersionRow[];
  }

  private async logAccess(
    tx: { client: { query: Function }; audit: Function },
    actor: ActorContext,
    document: DocumentRow,
    version: VersionRow,
    action: 'VIEW' | 'DOWNLOAD' | 'SHARE' | 'ARCHIVE',
  ): Promise<void> {
    await tx.client.query(
      `INSERT INTO document_access_log (document_id, version_id, entity_id, actor_ref, action, ip, user_agent, created_by)
       VALUES ($1, $2, $3, $4, $5, $6::inet, $7, $4)`,
      [
        document.id,
        version.id,
        document.entity_id,
        actor.ref,
        action,
        actor.ipAddress ?? null,
        actor.userAgent ?? null,
      ],
    );
    await tx.audit({
      action:
        action === 'DOWNLOAD'
          ? 'download'
          : action === 'SHARE'
            ? 'document_share'
            : action === 'ARCHIVE'
              ? 'archive'
              : 'document_access',
      subjectType: 'document',
      subjectId: document.id,
      subjectLabel: document.title,
      subjectReferenceNumber: document.reference_number,
      entityId: document.entity_id,
      newValue: { versionId: version.id, versionNumber: version.version_number, access: action },
    });
  }

  async recordAccess(
    tx: TxScope,
    actor: ActorContext,
    documentId: string,
    action: 'VIEW' | 'DOWNLOAD' | 'SHARE' | 'ARCHIVE',
  ): Promise<void> {
    const document = await this.loadDocument(tx.client, documentId);
    const versions = await this.loadVersions(tx.client, documentId);
    const current = versions.find((row) => row.id === document.current_version_id) ?? versions[0];
    if (!current) return;
    await this.logAccess(tx, actor, document, current, action);
  }

  private toView(doc: DocumentRow, current: VersionRow, versions: VersionRow[]): DocumentView {
    return {
      id: doc.id,
      referenceNumber: doc.reference_number,
      ownerType: doc.owner_type,
      ownerId: doc.owner_id,
      entityId: doc.entity_id,
      entityCode: doc.entity_code,
      category: doc.category,
      title: doc.title,
      status: doc.status,
      currentVersion: this.toVersionView(current),
      versions: versions.map((row) => this.toVersionView(row)),
      rowVersion: doc.row_version,
    };
  }

  private toVersionView(row: VersionRow): DocumentVersionView {
    return {
      id: row.id,
      versionNumber: row.version_number,
      sha256: row.sha256,
      sizeBytes: Number(row.size_bytes),
      mimeType: row.mime_type,
      originalFilename: row.original_filename,
      uploadedBy: row.uploaded_by,
      uploadedByName: row.uploader_name ?? row.uploaded_by,
      uploadedAt: row.uploaded_at.toISOString(),
      replacementReason: row.replacement_reason,
    };
  }
}
