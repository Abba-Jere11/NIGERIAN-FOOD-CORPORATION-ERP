import { Inject, Injectable, Optional, forwardRef } from '@nestjs/common';
import { applyActorSession, isSystemActorRef, type ActorContext } from '@nfc/db';
import {
  EDMS_MODULE_FOLDER_NAMES,
  EDMS_PROCUREMENT_SLOTS,
  formatLagosIsoDate,
  type EdmsAccessView,
  type EdmsCategoryView,
  type EdmsConfidentiality,
  type EdmsDocumentView,
  type EdmsFolderKind,
  type EdmsFolderView,
  type EdmsFolderNodeView,
  type EdmsGatewayView,
  type EdmsLegalHoldView,
  type EdmsModule,
  type EdmsPackageView,
  type EdmsSearchHitView,
  type EdmsTagView,
  type EdmsTreeView,
  type RoleKey,
} from '@nfc/shared';
import { assertCan, can } from '../auth/can';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ReasonRequiredError,
  ValidationFailedError,
} from '../common/errors/domain-error';
import type { TxScope } from '../database/unit-of-work';
import { UnitOfWork } from '../database/unit-of-work';
import { DocumentsService } from '../documents/documents.service';
import { WorkflowsService } from '../workflows/workflows.service';
import { renderApprovalDocumentsPdf, renderAuditRecordPdf, renderCompletionRecordPdf } from './edms-pdf';

@Injectable()
export class EdmsService {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly documents: DocumentsService,
    @Optional() @Inject(forwardRef(() => WorkflowsService)) private readonly workflows?: WorkflowsService,
  ) {}

  access(actor: ActorContext): EdmsAccessView {
    return { allowed: can(actor, 'edms.portal.access') };
  }

  async gateway(actor: ActorContext): Promise<EdmsGatewayView> {
    this.assertPortal(actor);
    return this.unitOfWork.read(actor, async (tx) => {
      const rows = await tx.client.query<{
        id: string;
        code: string;
        name: string;
        type: string;
        document_count: string;
      }>(
        `SELECT e.id, e.code, e.name, e.type,
                (
                  SELECT count(*)::text
                    FROM edms_folder_items i
                    JOIN edms_folders f ON f.id = i.folder_id
                   WHERE f.entity_id = e.id AND i.listed
                ) AS document_count
           FROM entities e
          WHERE e.status = 'ACTIVE'
          ORDER BY e.type, e.code`,
      );
      const entities = rows.rows
        .filter((row) => can(actor, 'edms.view', row.id))
        .map((row) => ({
          id: row.id,
          code: row.code,
          name: row.name,
          type: row.type,
          documentCount: Number(row.document_count),
        }));
      return { admin: can(actor, 'edms.manage_categories'), entities };
    });
  }

  async tree(actor: ActorContext, entityId: string): Promise<EdmsTreeView> {
    this.assertPortal(actor);
    assertCan(actor, 'edms.view', entityId);
    return this.unitOfWork.read(actor, async (tx) => {
      const entity = await this.loadEntity(tx, entityId);
      const folders = await tx.client.query<{
        id: string;
        parent_id: string | null;
        name: string;
        kind: EdmsFolderKind;
        status: string;
        document_count: string;
      }>(
        `SELECT f.id, f.parent_id, f.name, f.kind, f.status,
                (
                  SELECT count(*)::text FROM edms_folder_items i
                   WHERE i.folder_id = f.id AND i.listed
                ) AS document_count
           FROM edms_folders f
          WHERE f.entity_id = $1
          ORDER BY f.name`,
        [entityId],
      );
      const byParent = new Map<string | null, typeof folders.rows>();
      for (const row of folders.rows) {
        const list = byParent.get(row.parent_id) ?? [];
        list.push(row);
        byParent.set(row.parent_id, list);
      }
      const toNode = (row: (typeof folders.rows)[number]): EdmsFolderNodeView => {
        const children = (byParent.get(row.id) ?? []).map(toNode);
        const direct = Number(row.document_count);
        const descendant = children.reduce((sum, child) => sum + child.documentCount, 0);
        return {
          id: row.id,
          name: row.name,
          kind: row.kind,
          status: row.status,
          documentCount: direct + descendant,
          children,
        };
      };
      const roots = byParent.get(null) ?? [];
      return {
        entityId: entity.id,
        entityCode: entity.code,
        entityName: entity.name,
        active: roots.find((row) => row.name === 'Active') ? toNode(roots.find((row) => row.name === 'Active')!) : null,
        archived: roots.find((row) => row.name === 'Archived')
          ? toNode(roots.find((row) => row.name === 'Archived')!)
          : null,
      };
    });
  }

  async folder(actor: ActorContext, folderId: string): Promise<EdmsFolderView> {
    this.assertPortal(actor);
    return this.unitOfWork.read(actor, async (tx) => {
      const folder = await this.loadFolder(tx, folderId);
      assertCan(actor, 'edms.view', folder.entity_id);
      const breadcrumb = await this.breadcrumb(tx, folderId);
      const children = await tx.client.query<{
        id: string;
        name: string;
        kind: EdmsFolderKind;
        status: string;
        document_count: string;
      }>(
        `SELECT f.id, f.name, f.kind, f.status,
                (
                  WITH RECURSIVE descendants AS (
                    SELECT f.id AS id
                    UNION ALL
                    SELECT c.id FROM edms_folders c
                      JOIN descendants d ON c.parent_id = d.id
                  )
                  SELECT count(*)::text FROM edms_folder_items i
                   WHERE i.folder_id IN (SELECT id FROM descendants) AND i.listed
                ) AS document_count
           FROM edms_folders f
          WHERE f.parent_id = $1
          ORDER BY f.name`,
        [folderId],
      );
      const documents = await tx.client.query<{
        id: string;
        reference_number: string;
        title: string;
        category: string;
        status: string;
        slot: string | null;
        mime_type: string;
        original_filename: string;
        version_number: number;
        uploaded_at: Date;
        uploader_name: string | null;
      }>(
        `SELECT d.id, d.reference_number, d.title, d.category, d.status, i.slot,
                v.mime_type, v.original_filename, v.version_number, v.uploaded_at,
                app.user_public_name(
                  CASE WHEN v.uploaded_by ~ '^[0-9a-f-]{36}$' THEN v.uploaded_by::uuid END
                ) AS uploader_name
           FROM edms_folder_items i
           JOIN documents d ON d.id = i.document_id
           JOIN document_versions v ON v.id = d.current_version_id
          WHERE i.folder_id = $1 AND i.listed
          ORDER BY i.slot NULLS LAST, d.title`,
        [folderId],
      );
      return {
        id: folder.id,
        entityId: folder.entity_id,
        entityCode: folder.entity_code,
        entityName: folder.entity_name,
        name: folder.name,
        kind: folder.kind,
        status: folder.status,
        breadcrumb,
        children: children.rows.map((row) => ({
          id: row.id,
          name: row.name,
          kind: row.kind,
          status: row.status,
          documentCount: Number(row.document_count),
        })),
        documents: documents.rows.map((row) => ({
          id: row.id,
          referenceNumber: row.reference_number,
          title: row.title,
          category: row.category,
          status: row.status,
          slot: row.slot,
          mimeType: row.mime_type,
          originalFilename: row.original_filename,
          currentVersionNumber: row.version_number,
          uploadedAt: row.uploaded_at.toISOString(),
          uploadedByName: row.uploader_name,
        })),
        readOnly: breadcrumb.some((item) => item.name === 'Archived') || folder.status === 'ARCHIVED',
      };
    });
  }

  async getDocument(actor: ActorContext, id: string): Promise<EdmsDocumentView> {
    this.assertPortal(actor);
    return this.unitOfWork.write(actor, async (tx) => {
      const allowed = await this.mayViewDocument(tx, actor, id);
      if (!allowed) {
        throw new ForbiddenError('Your role does not permit this action.', { permission: 'edms.view' });
      }
      const view = await this.loadDocumentView(tx, actor, id);
      await this.documents.recordAccess(tx, actor, id, 'VIEW');
      return view;
    });
  }

  async packageForProcurement(actor: ActorContext, procurementId: string): Promise<EdmsPackageView | null> {
    this.assertPortal(actor);
    return this.unitOfWork.read(actor, async (tx) => {
      const row = await tx.client.query<{ id: string; entity_id: string; code: string }>(
        `SELECT f.id, f.entity_id, e.code
           FROM edms_folders f
           JOIN entities e ON e.id = f.entity_id
          WHERE f.source_type = 'PROCUREMENT' AND f.source_id = $1`,
        [procurementId],
      );
      const found = row.rows[0];
      if (!found) return null;
      if (!can(actor, 'edms.view', found.entity_id)) return null;
      return {
        folderId: found.id,
        entityCode: found.code,
        href: `/edms/${found.code}/folders/${found.id}`,
      };
    });
  }

  async upload(
    actor: ActorContext,
    input: {
      title: string;
      entityId: string;
      folderId: string;
      categoryId: string;
      tags: string[];
      file: { buffer: Buffer; originalname: string };
    },
  ) {
    this.assertPortal(actor);
    if (!input.title.trim()) throw new ValidationFailedError('A title is required.');
    if (!input.entityId) throw new ValidationFailedError('An entity is required.');
    if (!input.folderId) throw new ValidationFailedError('A folder is required.');
    if (!input.categoryId) throw new ValidationFailedError('A category is required.');
    assertCan(actor, 'edms.upload', input.entityId);
    const folder = await this.unitOfWork.read(actor, async (tx) => this.loadFolder(tx, input.folderId));
    if (folder.entity_id !== input.entityId) {
      throw new ValidationFailedError('That folder does not belong to the selected subsidiary.');
    }
    if (folder.status === 'ARCHIVED') {
      throw new ConflictError('The archive tree is read-only.');
    }
    const category = await this.unitOfWork.read(actor, async (tx) => this.loadCategory(tx, input.categoryId));
    const created = await this.documents.upload(actor, {
      title: input.title,
      category: category.key,
      categoryId: category.id,
      confidentiality: category.confidentiality,
      context: 'edms',
      entityId: input.entityId,
      ownerType: 'edms',
      asPermission: 'edms.upload',
      searchPermission: 'edms.view',
      file: input.file,
    });
    const listed = !category.requires_approval;
    await this.unitOfWork.write(actor, async (tx) => {
      await tx.client.query(
        `INSERT INTO edms_folder_items (folder_id, document_id, entity_id, listed, created_by, updated_by)
         VALUES ($1, $2, $3, $4, $5, $5)`,
        [input.folderId, created.id, input.entityId, listed, actor.ref],
      );
      for (const tagId of input.tags) {
        await tx.client.query(
          `INSERT INTO edms_document_tags (document_id, tag_id, entity_id, created_by)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT DO NOTHING`,
          [created.id, tagId, input.entityId, actor.ref],
        );
      }
      if (category.requires_approval && this.workflows) {
        await this.workflows.startEdmsDocumentInTx(tx, actor, {
          documentId: created.id,
          title: created.title,
          reference: created.referenceNumber,
          entityId: input.entityId,
        });
      }
    });
    return this.getDocument(actor, created.id);
  }

  async replace(
    actor: ActorContext,
    documentId: string,
    input: { reason: string; file: { buffer: Buffer; originalname: string } },
  ) {
    this.assertPortal(actor);
    const meta = await this.unitOfWork.read(actor, async (tx) => this.loadDocumentMeta(tx, documentId));
    assertCan(actor, 'edms.version.replace', meta.entity_id);
    await this.documents.replace(actor, documentId, {
      reason: input.reason,
      context: 'edms',
      file: input.file,
      asPermission: 'edms.version.replace',
      searchPermission: 'edms.view',
    });
    return this.getDocument(actor, documentId);
  }

  async archive(actor: ActorContext, documentId: string, reason: string): Promise<EdmsDocumentView> {
    this.assertPortal(actor);
    const trimmed = reason.trim();
    if (trimmed === '') throw new ReasonRequiredError('archive a document');
    return this.unitOfWork.write(actor, async (tx) => {
      const meta = await this.loadDocumentMeta(tx, documentId);
      assertCan(actor, 'edms.archive', meta.entity_id);
      if (meta.legal_hold) {
        throw new ConflictError('A legal hold is in place. Release it before archiving.');
      }
      const dest = await this.archivedModuleFolder(tx, meta.entity_id, meta.module);
      await tx.client.query(
        `UPDATE edms_folder_items SET folder_id = $1, updated_by = $2 WHERE document_id = $3`,
        [dest, actor.ref, documentId],
      );
      await tx.client.query(
        `UPDATE documents SET status = 'ARCHIVED', updated_by = $1 WHERE id = $2`,
        [actor.ref, documentId],
      );
      await this.documents.recordAccess(tx, actor, documentId, 'ARCHIVE');
      await tx.indexSearch({
        recordType: 'DOCUMENT',
        recordId: documentId,
        referenceNumber: meta.reference_number,
        title: meta.title,
        searchableText: `${meta.reference_number} ${meta.title}`,
        entityId: meta.entity_id,
        permissionKey: 'edms.view',
      });
      await tx.appendTimeline({
        subjectType: 'DOCUMENT',
        subjectId: documentId,
        text: `Archived. ${trimmed}`,
        href: `/edms/documents/${documentId}`,
        entityId: meta.entity_id,
      });
      return this.loadDocumentView(tx, actor, documentId);
    });
  }

  async share(
    actor: ActorContext,
    documentId: string,
    input: { granteeUserId?: string; granteeRole?: RoleKey; expiresAt?: string },
  ) {
    this.assertPortal(actor);
    return this.unitOfWork.write(actor, async (tx) => {
      const meta = await this.loadDocumentMeta(tx, documentId);
      assertCan(actor, 'edms.share', meta.entity_id);
      if (!input.granteeUserId && !input.granteeRole) {
        throw new ValidationFailedError('Share with a named user or a role.');
      }
      if (input.granteeUserId && input.granteeRole) {
        throw new ValidationFailedError('Share with either a user or a role, not both.');
      }
      await tx.client.query(
        `INSERT INTO edms_shares (
           document_id, entity_id, grantee_user_id, grantee_role, expires_at, created_by, updated_by
         ) VALUES ($1, $2, $3, $4, $5, $6, $6)`,
        [
          documentId,
          meta.entity_id,
          input.granteeUserId ?? null,
          input.granteeRole ?? null,
          input.expiresAt ?? null,
          actor.ref,
        ],
      );
      await this.documents.recordAccess(tx, actor, documentId, 'SHARE');
      return this.loadDocumentView(tx, actor, documentId);
    });
  }

  async revokeShare(actor: ActorContext, documentId: string, shareId: string) {
    this.assertPortal(actor);
    return this.unitOfWork.write(actor, async (tx) => {
      const meta = await this.loadDocumentMeta(tx, documentId);
      assertCan(actor, 'edms.share', meta.entity_id);
      const updated = await tx.client.query(
        `UPDATE edms_shares SET revoked_at = now(), updated_by = $1
          WHERE id = $2 AND document_id = $3 AND revoked_at IS NULL`,
        [actor.ref, shareId, documentId],
      );
      if (updated.rowCount === 0) throw new NotFoundError('That share was not found.');
      await tx.audit({
        action: 'document_share',
        subjectType: 'document',
        subjectId: documentId,
        subjectLabel: meta.title,
        entityId: meta.entity_id,
        reason: 'Share revoked',
        newValue: { shareId, revoked: true },
      });
      return this.loadDocumentView(tx, actor, documentId);
    });
  }

  async placeHold(actor: ActorContext, documentId: string, reason: string) {
    this.assertPortal(actor);
    const trimmed = reason.trim();
    if (trimmed === '') throw new ReasonRequiredError('place a legal hold');
    return this.unitOfWork.write(actor, async (tx) => {
      const meta = await this.loadDocumentMeta(tx, documentId);
      assertCan(actor, 'edms.manage_retention');
      await tx.client.query(
        `INSERT INTO edms_legal_holds (document_id, entity_id, reason, placed_by, created_by, updated_by)
         VALUES ($1, $2, $3, $4, $4, $4)`,
        [documentId, meta.entity_id, trimmed, actor.ref],
      );
      await tx.client.query(
        `UPDATE documents SET legal_hold = true, updated_by = $1 WHERE id = $2`,
        [actor.ref, documentId],
      );
      await tx.audit({
        action: 'system_configuration_change',
        subjectType: 'document',
        subjectId: documentId,
        subjectLabel: meta.title,
        entityId: meta.entity_id,
        reason: trimmed,
        newValue: { legalHold: true },
      });
      return this.loadDocumentView(tx, actor, documentId);
    });
  }

  async releaseHold(actor: ActorContext, documentId: string, holdId: string, reason: string) {
    this.assertPortal(actor);
    const trimmed = reason.trim();
    if (trimmed === '') throw new ReasonRequiredError('release a legal hold');
    return this.unitOfWork.write(actor, async (tx) => {
      const meta = await this.loadDocumentMeta(tx, documentId);
      assertCan(actor, 'edms.manage_retention');
      const updated = await tx.client.query(
        `UPDATE edms_legal_holds SET released_at = now(), updated_by = $1
          WHERE id = $2 AND document_id = $3 AND released_at IS NULL`,
        [actor.ref, holdId, documentId],
      );
      if (updated.rowCount === 0) throw new NotFoundError('That legal hold was not found.');
      const open = await tx.client.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM edms_legal_holds
          WHERE document_id = $1 AND released_at IS NULL`,
        [documentId],
      );
      if (Number(open.rows[0]?.n ?? 0) === 0) {
        await tx.client.query(
          `UPDATE documents SET legal_hold = false, updated_by = $1 WHERE id = $2`,
          [actor.ref, documentId],
        );
      }
      await tx.audit({
        action: 'system_configuration_change',
        subjectType: 'document',
        subjectId: documentId,
        subjectLabel: meta.title,
        entityId: meta.entity_id,
        reason: trimmed,
        newValue: { legalHold: false, holdId },
      });
      return this.loadDocumentView(tx, actor, documentId);
    });
  }

  async refile(
    actor: ActorContext,
    documentId: string,
    input: { destEntityId: string; destFolderId?: string; reason: string },
  ) {
    this.assertPortal(actor);
    const trimmed = input.reason.trim();
    if (trimmed === '') throw new ReasonRequiredError('re-file a document');
    return this.unitOfWork.write(actor, async (tx) => {
      const meta = await this.loadDocumentMeta(tx, documentId);
      assertCan(actor, 'edms.refile', meta.entity_id);
      const destFolder =
        input.destFolderId ?? (await this.ensureModuleFolder(tx, input.destEntityId, meta.module, 'Active', actor));
      await tx.client.query(`SELECT app.refile_document($1, $2, $3, $4, $5)`, [
        documentId,
        input.destEntityId,
        destFolder,
        trimmed,
        actor.ref,
      ]);
      await tx.audit({
        action: 'edit',
        subjectType: 'document',
        subjectId: documentId,
        subjectLabel: meta.title,
        entityId: input.destEntityId,
        reason: trimmed,
        oldValue: { entityId: meta.entity_id },
        newValue: { entityId: input.destEntityId, folderId: destFolder },
      });
      await tx.indexSearch({
        recordType: 'DOCUMENT',
        recordId: documentId,
        referenceNumber: meta.reference_number,
        title: meta.title,
        searchableText: `${meta.reference_number} ${meta.title}`,
        entityId: input.destEntityId,
        permissionKey: 'edms.view',
      });
      return this.loadDocumentView(tx, actor, documentId);
    });
  }

  async search(
    actor: ActorContext,
    query: string,
    opts: { entityId?: string; all?: boolean },
  ): Promise<EdmsSearchHitView[]> {
    this.assertPortal(actor);
    if (!can(actor, 'edms.view')) {
      throw new ForbiddenError('Your role does not permit this action.', { permission: 'edms.view' });
    }
    return this.unitOfWork.read(actor, async (tx) => {
      const entities = opts.all
        ? (await tx.client.query<{ id: string }>(`SELECT id FROM entities WHERE status = 'ACTIVE'`)).rows
            .map((row) => row.id)
            .filter((id) => can(actor, 'edms.view', id))
        : opts.entityId
          ? [opts.entityId]
          : actor.isCorporate
            ? (await tx.client.query<{ id: string }>(`SELECT id FROM entities WHERE status = 'ACTIVE'`)).rows
                .map((row) => row.id)
                .filter((id) => can(actor, 'edms.view', id))
            : actor.entityIds.filter((id) => can(actor, 'edms.view', id));
      if (opts.entityId) assertCan(actor, 'edms.view', opts.entityId);
      if (entities.length === 0) return [];
      const trimmed = query.trim();
      const result = await tx.client.query<{
        record_id: string;
        reference_number: string | null;
        title: string;
        entity_id: string;
        code: string;
      }>(
        `SELECT s.record_id, s.reference_number, s.title, s.entity_id, e.code
           FROM search_index s
           JOIN entities e ON e.id = s.entity_id
          WHERE s.record_type = 'DOCUMENT'
            AND s.permission_key = 'edms.view'
            AND s.entity_id = ANY($1::uuid[])
            AND (
              $2 = '' OR s.title ILIKE '%' || $2 || '%'
              OR coalesce(s.reference_number, '') ILIKE '%' || $2 || '%'
              OR s.searchable_text ILIKE '%' || $2 || '%'
            )
          ORDER BY s.updated_at DESC
          LIMIT 50`,
        [entities, trimmed],
      );
      return result.rows.map((row) => ({
        id: row.record_id,
        referenceNumber: row.reference_number,
        title: row.title,
        entityId: row.entity_id,
        entityCode: row.code,
        href: `/edms/documents/${row.record_id}`,
      }));
    });
  }

  async listCategories(actor: ActorContext): Promise<EdmsCategoryView[]> {
    this.assertPortal(actor);
    return this.unitOfWork.read(actor, async (tx) => {
      const result = await tx.client.query<{
        id: string;
        key: string;
        name: string;
        module: EdmsModule;
        retain_years: number;
        requires_approval: boolean;
        confidentiality: EdmsConfidentiality;
        status: string;
      }>(
        `SELECT id, key, name, module, retain_years, requires_approval, confidentiality, status
           FROM edms_categories ORDER BY module, name`,
      );
      return result.rows.map((row) => ({
        id: row.id,
        key: row.key,
        name: row.name,
        module: row.module,
        retainYears: row.retain_years,
        requiresApproval: row.requires_approval,
        confidentiality: row.confidentiality,
        status: row.status,
      }));
    });
  }

  async saveCategory(
    actor: ActorContext,
    input: {
      id?: string;
      key: string;
      name: string;
      module: EdmsModule;
      retainYears: number;
      requiresApproval: boolean;
      confidentiality: EdmsConfidentiality;
    },
  ): Promise<EdmsCategoryView[]> {
    this.assertPortal(actor);
    assertCan(actor, 'edms.manage_categories');
    await this.unitOfWork.write(actor, async (tx) => {
      if (input.id) {
        await tx.client.query(
          `UPDATE edms_categories
              SET name = $2, module = $3, retain_years = $4, requires_approval = $5,
                  confidentiality = $6, updated_by = $7
            WHERE id = $1`,
          [
            input.id,
            input.name,
            input.module,
            input.retainYears,
            input.requiresApproval,
            input.confidentiality,
            actor.ref,
          ],
        );
      } else {
        await tx.client.query(
          `INSERT INTO edms_categories (
             key, name, module, retain_years, requires_approval, confidentiality, created_by, updated_by
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $7)`,
          [
            input.key,
            input.name,
            input.module,
            input.retainYears,
            input.requiresApproval,
            input.confidentiality,
            actor.ref,
          ],
        );
      }
      await tx.audit({
        action: 'system_configuration_change',
        subjectType: 'edms_category',
        subjectLabel: input.name,
        reason: input.id ? 'Updated category' : 'Created category',
        newValue: { key: input.key, module: input.module, retainYears: input.retainYears },
      });
    });
    return this.listCategories(actor);
  }

  async listTags(actor: ActorContext): Promise<EdmsTagView[]> {
    this.assertPortal(actor);
    return this.unitOfWork.read(actor, async (tx) => {
      const result = await tx.client.query<{ id: string; key: string; name: string; status: string }>(
        `SELECT id, key, name, status FROM edms_tags ORDER BY name`,
      );
      return result.rows.map((row) => ({
        id: row.id,
        key: row.key,
        name: row.name,
        status: row.status,
      }));
    });
  }

  async saveTag(actor: ActorContext, input: { id?: string; key: string; name: string }): Promise<EdmsTagView[]> {
    this.assertPortal(actor);
    assertCan(actor, 'edms.manage_categories');
    await this.unitOfWork.write(actor, async (tx) => {
      if (input.id) {
        await tx.client.query(`UPDATE edms_tags SET name = $2, updated_by = $3 WHERE id = $1`, [
          input.id,
          input.name,
          actor.ref,
        ]);
      } else {
        await tx.client.query(
          `INSERT INTO edms_tags (key, name, created_by, updated_by) VALUES ($1, $2, $3, $3)`,
          [input.key, input.name, actor.ref],
        );
      }
      await tx.audit({
        action: 'system_configuration_change',
        subjectType: 'edms_tag',
        subjectLabel: input.name,
        newValue: { key: input.key },
      });
    });
    return this.listTags(actor);
  }

  async legalHolds(actor: ActorContext): Promise<EdmsLegalHoldView[]> {
    this.assertPortal(actor);
    assertCan(actor, 'edms.manage_retention');
    return this.unitOfWork.read(actor, async (tx) => {
      const result = await tx.client.query<{
        id: string;
        document_id: string | null;
        folder_id: string | null;
        reason: string;
        placed_by: string;
        released_at: Date | null;
        created_at: Date;
      }>(
        `SELECT id, document_id, folder_id, reason, placed_by, released_at, created_at
           FROM edms_legal_holds
          WHERE released_at IS NULL
          ORDER BY created_at DESC`,
      );
      return result.rows.map((row) => ({
        id: row.id,
        documentId: row.document_id,
        folderId: row.folder_id,
        reason: row.reason,
        placedBy: row.placed_by,
        releasedAt: row.released_at?.toISOString() ?? null,
        createdAt: row.created_at.toISOString(),
      }));
    });
  }

  async shareTargets(actor: ActorContext) {
    this.assertPortal(actor);
    return this.unitOfWork.read(actor, async (tx) => {
      const users = await tx.client.query<{ id: string; name: string; email: string }>(
        `SELECT id, name, email::text AS email FROM app.edms_user_directory()`,
      );
      return { users: users.rows };
    });
  }

  async markDocumentListed(tx: TxScope, documentId: string, listed: boolean): Promise<void> {
    await tx.client.query(`UPDATE edms_folder_items SET listed = $2 WHERE document_id = $1`, [
      documentId,
      listed,
    ]);
  }

  async fileProcurementInTx(tx: TxScope, actor: ActorContext, requestId: string): Promise<string | null> {
    await applyActorSession(tx.client, actor);
    const existing = await tx.client.query<{ id: string }>(
      `SELECT id FROM edms_folders WHERE source_type = 'PROCUREMENT' AND source_id = $1`,
      [requestId],
    );
    if (existing.rows[0]) return existing.rows[0].id;

    const request = await tx.client.query<{
      id: string;
      entity_id: string;
      entity_name: string;
      entity_code: string;
      reference_number: string;
      status: string;
      created_at: Date;
      title: string;
      subject: string | null;
    }>(
      `SELECT r.id, r.entity_id, e.name AS entity_name, e.code AS entity_code, r.reference_number, r.status,
              r.created_at, v.title, v.subject
         FROM procurement_requests r
         JOIN entities e ON e.id = r.entity_id
         JOIN procurement_versions v ON v.request_id = r.id AND v.version_number = r.current_version
        WHERE r.id = $1`,
      [requestId],
    );
    const row = request.rows[0];
    if (!row || row.status !== 'COMPLETED') return null;

    const year = formatLagosIsoDate(row.created_at).slice(0, 4);
    let packageName = (row.subject?.trim() || row.title).trim();
    const yearFolder = await this.ensureYearFolder(tx, row.entity_id, year, actor);
    const clash = await tx.client.query<{ id: string }>(
      `SELECT id FROM edms_folders WHERE parent_id = $1 AND name = $2`,
      [yearFolder, packageName],
    );
    if (clash.rows[0]) packageName = `${packageName} [${row.reference_number}]`;

    const inserted = await tx.client.query<{ id: string }>(
      `INSERT INTO edms_folders (
         entity_id, parent_id, name, kind, source_type, source_id, created_by, updated_by
       ) VALUES ($1, $2, $3, 'package', 'PROCUREMENT', $4, $5, $5)
       ON CONFLICT (source_type, source_id) WHERE source_type IS NOT NULL AND source_id IS NOT NULL
       DO NOTHING
       RETURNING id`,
      [row.entity_id, yearFolder, packageName, requestId, actor.ref],
    );
    let packageId = inserted.rows[0]?.id;
    if (!packageId) {
      const again = await tx.client.query<{ id: string }>(
        `SELECT id FROM edms_folders WHERE source_type = 'PROCUREMENT' AND source_id = $1`,
        [requestId],
      );
      packageId = again.rows[0]?.id;
    }
    if (!packageId) return null;

    const categoryId = await this.packageCategoryId(tx);
    const slots = await this.ensureSlotFolders(tx, row.entity_id, packageId, actor);

    const memo = await tx.client.query<{ pdf_document_id: string }>(
      `SELECT pdf_document_id FROM procurement_memo_snapshots
        WHERE request_id = $1 AND pdf_document_id IS NOT NULL
        ORDER BY created_at DESC LIMIT 1`,
      [requestId],
    );
    await this.linkSlot(tx, slots['01'], memo.rows[0]?.pdf_document_id, '01', row.entity_id, actor);

    const invoices = await tx.client.query<{ document_id: string }>(
      `SELECT document_id FROM procurement_invoices WHERE request_id = $1`,
      [requestId],
    );
    for (const invoice of invoices.rows) {
      await this.linkSlot(tx, slots['02'], invoice.document_id, '02', row.entity_id, actor);
    }

    const funding = await tx.client.query<{ id: string }>(
      `SELECT id FROM documents WHERE owner_id = $1 AND category = 'funding_transfer'`,
      [requestId],
    );
    for (const doc of funding.rows) {
      await this.linkSlot(tx, slots['04'], doc.id, '04', row.entity_id, actor);
    }

    const proofs = await tx.client.query<{ id: string }>(
      `SELECT id FROM documents WHERE owner_id = $1 AND category = 'payment_proof'`,
      [requestId],
    );
    for (const doc of proofs.rows) {
      await this.linkSlot(tx, slots['05'], doc.id, '05', row.entity_id, actor);
    }

    const receipts = await tx.client.query<{ document_id: string; kind: string }>(
      `SELECT document_id, kind FROM procurement_receipt_documents WHERE request_id = $1`,
      [requestId],
    );
    for (const receipt of receipts.rows) {
      const slot = receipt.kind === 'delivery_note' || receipt.kind === 'goods_received_note' ? '06' : '07';
      await this.linkSlot(tx, slots[slot], receipt.document_id, slot, row.entity_id, actor);
    }

    const seals = await tx.client.query<{ action: string; actor_name: string; occurred_at: Date }>(
      `SELECT action, coalesce(app.user_public_name(approver_id), 'system') AS actor_name, occurred_at
         FROM seals WHERE subject_id = $1 ORDER BY occurred_at`,
      [requestId],
    );
    const actions = await tx.client.query<{
      stage: string;
      action: string;
      actor_name: string;
      occurred_at: Date;
      reason: string | null;
    }>(
      `SELECT s.label AS stage, a.action, app.user_public_name(a.actor_id) AS actor_name, a.occurred_at, a.reason
         FROM workflow_actions a
         JOIN workflow_instances i ON i.id = a.instance_id
         JOIN workflow_stages s ON s.id = a.stage_id
        WHERE i.subject_id = $1
        ORDER BY a.occurred_at`,
      [requestId],
    );
    const approvalPdf = await renderApprovalDocumentsPdf({
      reference: row.reference_number,
      title: packageName,
      entityName: row.entity_name,
      seals: seals.rows.map((item) => ({
        action: item.action,
        actorName: item.actor_name,
        occurredAt: item.occurred_at.toISOString(),
      })),
      actions: actions.rows.map((item) => ({
        stage: item.stage,
        action: item.action,
        actorName: item.actor_name,
        occurredAt: item.occurred_at.toISOString(),
        reason: item.reason,
      })),
    });
    const approvalDoc = await this.documents.storeGeneratedPdfInTx(tx, actor, {
      title: `${row.reference_number} approval documents`,
      entityId: row.entity_id,
      ownerType: 'procurement_request',
      ownerId: requestId,
      buffer: approvalPdf,
      filename: `${row.reference_number}-approvals.pdf`,
      category: 'edms-generated',
      categoryId,
    });
    await this.linkSlot(tx, slots['03'], approvalDoc.documentId, '03', row.entity_id, actor);

    const completionPdf = await renderCompletionRecordPdf({
      reference: row.reference_number,
      title: packageName,
      entityName: row.entity_name,
      status: row.status,
      completedAt: new Date().toISOString(),
    });
    const completionDoc = await this.documents.storeGeneratedPdfInTx(tx, actor, {
      title: `${row.reference_number} completion record`,
      entityId: row.entity_id,
      ownerType: 'procurement_request',
      ownerId: requestId,
      buffer: completionPdf,
      filename: `${row.reference_number}-completion.pdf`,
      category: 'edms-generated',
      categoryId,
    });
    await this.linkSlot(tx, slots['08'], completionDoc.documentId, '08', row.entity_id, actor);

    const timeline = await tx.client.query<{ occurred_at: Date; actor_name: string; event_text: string }>(
      `SELECT occurred_at, actor_name, event_text
         FROM timeline_events
        WHERE subject_id = $1
        ORDER BY occurred_at`,
      [requestId],
    );
    const auditPdf = await renderAuditRecordPdf({
      reference: row.reference_number,
      title: packageName,
      events: timeline.rows.map((item) => ({
        occurredAt: item.occurred_at.toISOString(),
        actorName: item.actor_name,
        text: item.event_text,
      })),
    });
    const auditDoc = await this.documents.storeGeneratedPdfInTx(tx, actor, {
      title: `${row.reference_number} audit record`,
      entityId: row.entity_id,
      ownerType: 'procurement_request',
      ownerId: requestId,
      buffer: auditPdf,
      filename: `${row.reference_number}-audit.pdf`,
      category: 'edms-generated',
      categoryId,
    });
    await this.linkSlot(tx, slots['09'], auditDoc.documentId, '09', row.entity_id, actor);

    for (const documentId of [
      memo.rows[0]?.pdf_document_id,
      ...invoices.rows.map((item) => item.document_id),
      ...funding.rows.map((item) => item.id),
      ...proofs.rows.map((item) => item.id),
      ...receipts.rows.map((item) => item.document_id),
      approvalDoc.documentId,
      completionDoc.documentId,
      auditDoc.documentId,
    ].filter((value): value is string => Boolean(value))) {
      const doc = await tx.client.query<{ reference_number: string; title: string }>(
        `SELECT reference_number, title FROM documents WHERE id = $1`,
        [documentId],
      );
      const found = doc.rows[0];
      if (!found) continue;
      await tx.indexSearch({
        recordType: 'DOCUMENT',
        recordId: documentId,
        referenceNumber: found.reference_number,
        title: found.title,
        searchableText: `${found.reference_number} ${found.title} ${row.reference_number} ${packageName}`,
        entityId: row.entity_id,
        permissionKey: 'edms.view',
      });
    }

    await tx.appendTimeline({
      subjectType: 'PROCUREMENT',
      subjectId: requestId,
      text: 'EDMS archive generated.',
      href: `/edms/${row.entity_code}/folders/${packageId}`,
      entityId: row.entity_id,
    });
    return packageId;
  }

  async backfillCompleted(actor: ActorContext): Promise<{ filed: number }> {
    let filed = 0;
    const ids = await this.unitOfWork.read(actor, async (tx) => {
      const result = await tx.client.query<{ id: string }>(
        `SELECT r.id FROM procurement_requests r
          WHERE r.status = 'COMPLETED'
            AND NOT EXISTS (
              SELECT 1 FROM edms_folders f
               WHERE f.source_type = 'PROCUREMENT' AND f.source_id = r.id
            )`,
      );
      return result.rows.map((row) => row.id);
    });
    for (const id of ids) {
      await this.unitOfWork.write(actor, async (tx) => {
        const created = await this.fileProcurementInTx(tx, actor, id);
        if (created) filed += 1;
      });
    }
    return { filed };
  }

  private assertPortal(actor: ActorContext): void {
    assertCan(actor, 'edms.portal.access');
  }

  private async mayViewDocument(tx: TxScope, actor: ActorContext, documentId: string): Promise<boolean> {
    const meta = await this.loadDocumentMeta(tx, documentId);
    if (can(actor, 'edms.view', meta.entity_id)) return true;
    const share = await tx.client.query<{ id: string }>(
      `SELECT id FROM edms_shares
        WHERE document_id = $1 AND revoked_at IS NULL
          AND (expires_at IS NULL OR expires_at > now())
          AND (
          ($2::uuid IS NOT NULL AND grantee_user_id = $2::uuid)
          OR ($3::text IS NOT NULL AND grantee_role = $3::role_key)
        )
        LIMIT 1`,
      [documentId, isSystemActorRef(actor.ref) ? null : actor.ref, actor.role],
    );
    return Boolean(share.rows[0]);
  }

  private async loadEntity(tx: TxScope, entityId: string) {
    const result = await tx.client.query<{ id: string; code: string; name: string }>(
      `SELECT id, code, name FROM entities WHERE id = $1`,
      [entityId],
    );
    const row = result.rows[0];
    if (!row) throw new NotFoundError('That subsidiary was not found.');
    return row;
  }

  private async loadFolder(tx: TxScope, folderId: string) {
    const result = await tx.client.query<{
      id: string;
      entity_id: string;
      entity_code: string;
      entity_name: string;
      name: string;
      kind: EdmsFolderKind;
      status: string;
    }>(
      `SELECT f.id, f.entity_id, e.code AS entity_code, e.name AS entity_name, f.name, f.kind, f.status
         FROM edms_folders f
         JOIN entities e ON e.id = f.entity_id
        WHERE f.id = $1`,
      [folderId],
    );
    const row = result.rows[0];
    if (!row) throw new NotFoundError('That folder was not found.');
    return row;
  }

  private async breadcrumb(tx: TxScope, folderId: string): Promise<Array<{ id: string; name: string }>> {
    const result = await tx.client.query<{ id: string; name: string }>(
      `WITH RECURSIVE trail AS (
         SELECT id, parent_id, name, 1 AS depth FROM edms_folders WHERE id = $1
         UNION ALL
         SELECT f.id, f.parent_id, f.name, trail.depth + 1
           FROM edms_folders f
           JOIN trail ON trail.parent_id = f.id
       )
       SELECT id, name FROM trail ORDER BY depth DESC`,
      [folderId],
    );
    return result.rows;
  }

  private async loadCategory(tx: TxScope, categoryId: string) {
    const result = await tx.client.query<{
      id: string;
      key: string;
      confidentiality: string;
      requires_approval: boolean;
    }>(`SELECT id, key, confidentiality, requires_approval FROM edms_categories WHERE id = $1`, [categoryId]);
    const row = result.rows[0];
    if (!row) throw new ValidationFailedError('That category was not found.');
    return row;
  }

  private async loadDocumentMeta(tx: TxScope, documentId: string) {
    const result = await tx.client.query<{
      id: string;
      entity_id: string;
      title: string;
      reference_number: string;
      legal_hold: boolean;
      module: EdmsModule;
    }>(
      `SELECT d.id, d.entity_id, d.title, d.reference_number, d.legal_hold,
              coalesce(c.module, 'administrative') AS module
         FROM documents d
         LEFT JOIN edms_categories c ON c.id = d.category_id
        WHERE d.id = $1`,
      [documentId],
    );
    const row = result.rows[0];
    if (!row) throw new NotFoundError('That document does not exist.');
    return row;
  }

  private async loadDocumentView(tx: TxScope, actor: ActorContext, id: string): Promise<EdmsDocumentView> {
    const doc = await tx.client.query<{
      id: string;
      reference_number: string;
      title: string;
      category: string;
      category_id: string | null;
      category_name: string | null;
      confidentiality: EdmsConfidentiality;
      status: string;
      legal_hold: boolean;
      retention_review_on: Date | null;
      entity_id: string;
      entity_code: string;
      owner_type: string;
      owner_id: string | null;
      row_version: number;
      current_version_id: string;
    }>(
      `SELECT d.id, d.reference_number, d.title, d.category, d.category_id, c.name AS category_name,
              d.confidentiality, d.status, d.legal_hold, d.retention_review_on, d.entity_id,
              e.code AS entity_code, d.owner_type, d.owner_id, d.row_version, d.current_version_id
         FROM documents d
         JOIN entities e ON e.id = d.entity_id
         LEFT JOIN edms_categories c ON c.id = d.category_id
        WHERE d.id = $1`,
      [id],
    );
    const row = doc.rows[0];
    if (!row) throw new NotFoundError('That document does not exist.');
    const versions = await this.documentsVersions(tx, id);
    const current = versions.find((item) => item.id === row.current_version_id) ?? versions[versions.length - 1];
    if (!current) throw new NotFoundError('This document has no current version.');
    const showHistory = can(actor, 'document.view_history', row.entity_id);
    const folder = await tx.client.query<{ id: string }>(
      `SELECT folder_id AS id FROM edms_folder_items WHERE document_id = $1 LIMIT 1`,
      [id],
    );
    const folderId = folder.rows[0]?.id ?? null;
    const folderPath = folderId ? (await this.breadcrumb(tx, folderId)).map((item) => item.name) : [];
    const tags = await tx.client.query<{ id: string; key: string; name: string }>(
      `SELECT t.id, t.key, t.name
         FROM edms_document_tags dt
         JOIN edms_tags t ON t.id = dt.tag_id
        WHERE dt.document_id = $1
        ORDER BY t.name`,
      [id],
    );
    const shares = await tx.client.query<{
      id: string;
      grantee_user_id: string | null;
      grantee_role: RoleKey | null;
      grantee_name: string;
      expires_at: Date | null;
      revoked_at: Date | null;
      created_at: Date;
    }>(
      `SELECT s.id, s.grantee_user_id, s.grantee_role,
              coalesce(u.name, s.grantee_role::text, '—') AS grantee_name,
              s.expires_at, s.revoked_at, s.created_at
         FROM edms_shares s
         LEFT JOIN users u ON u.id = s.grantee_user_id
        WHERE s.document_id = $1
        ORDER BY s.created_at DESC`,
      [id],
    );
    const access = await tx.client.query<{
      id: string;
      action: string;
      actor_ref: string;
      actor_name: string | null;
      occurred_at: Date;
    }>(
      `SELECT l.id, l.action, l.actor_ref,
              coalesce(app.user_public_name(CASE WHEN l.actor_ref ~ '^[0-9a-f-]{36}$' THEN l.actor_ref::uuid END), l.actor_ref) AS actor_name,
              l.occurred_at
         FROM document_access_log l
        WHERE l.document_id = $1
        ORDER BY l.occurred_at DESC
        LIMIT 100`,
      [id],
    );
    const procurement =
      row.owner_type === 'procurement_request' && row.owner_id
        ? await tx.client.query<{ id: string; reference_number: string }>(
            `SELECT id, reference_number FROM procurement_requests WHERE id = $1`,
            [row.owner_id],
          )
        : { rows: [] as Array<{ id: string; reference_number: string }> };
    const entity = await tx.client.query<{ name: string }>(`SELECT name FROM entities WHERE id = $1`, [row.entity_id]);
    return {
      id: row.id,
      referenceNumber: row.reference_number,
      title: row.title,
      category: row.category,
      categoryId: row.category_id,
      categoryName: row.category_name,
      confidentiality: row.confidentiality,
      status: row.status,
      legalHold: row.legal_hold,
      retentionReviewOn: row.retention_review_on?.toISOString().slice(0, 10) ?? null,
      entityId: row.entity_id,
      entityCode: row.entity_code,
      folderId,
      folderPath,
      tags: tags.rows,
      currentVersion: current,
      versions: showHistory ? versions : versions.filter((item) => item.id === current.id),
      related: {
        ownerType: row.owner_type,
        ownerId: row.owner_id,
        procurementId: procurement.rows[0]?.id ?? null,
        procurementReference: procurement.rows[0]?.reference_number ?? null,
        entityId: row.entity_id,
        entityCode: row.entity_code,
        entityName: entity.rows[0]?.name ?? null,
        financeId: null,
        inventoryId: null,
        employeeId: null,
        projectId: null,
      },
      shares: shares.rows.map((item) => ({
        id: item.id,
        granteeUserId: item.grantee_user_id,
        granteeRole: item.grantee_role,
        granteeName: item.grantee_name,
        expiresAt: item.expires_at?.toISOString() ?? null,
        revokedAt: item.revoked_at?.toISOString() ?? null,
        createdAt: item.created_at.toISOString(),
      })),
      accessLog: access.rows.map((item) => ({
        id: item.id,
        action: item.action,
        actorRef: item.actor_ref,
        actorName: item.actor_name,
        occurredAt: item.occurred_at.toISOString(),
      })),
      rowVersion: row.row_version,
    };
  }

  private async documentsVersions(tx: TxScope, documentId: string) {
    const result = await tx.client.query<{
      id: string;
      version_number: number;
      sha256: string;
      size_bytes: string;
      mime_type: string;
      original_filename: string;
      uploaded_by: string;
      uploader_name: string | null;
      uploaded_at: Date;
      replacement_reason: string | null;
    }>(
      `SELECT v.id, v.version_number, v.sha256, v.size_bytes::text, v.mime_type, v.original_filename,
              v.uploaded_by,
              app.user_public_name(CASE WHEN v.uploaded_by ~ '^[0-9a-f-]{36}$' THEN v.uploaded_by::uuid END) AS uploader_name,
              v.uploaded_at, v.replacement_reason
         FROM document_versions v
        WHERE v.document_id = $1
        ORDER BY v.version_number`,
      [documentId],
    );
    return result.rows.map((row) => ({
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
    }));
  }

  private async packageCategoryId(tx: TxScope): Promise<string | null> {
    const result = await tx.client.query<{ id: string }>(
      `SELECT id FROM edms_categories WHERE key = 'procurement_package'`,
    );
    return result.rows[0]?.id ?? null;
  }

  private async ensureYearFolder(tx: TxScope, entityId: string, year: string, actor: ActorContext): Promise<string> {
    const procurement = await this.ensureModuleFolder(tx, entityId, 'procurement', 'Active', actor);
    return this.ensureChild(tx, entityId, procurement, year, 'year', actor);
  }

  private async ensureModuleFolder(
    tx: TxScope,
    entityId: string,
    module: EdmsModule,
    space: 'Active' | 'Archived',
    actor: ActorContext,
  ): Promise<string> {
    await tx.client.query(`SELECT app.seed_edms_entity_folders($1, $2)`, [entityId, actor.ref]);
    const root = await tx.client.query<{ id: string }>(
      `SELECT id FROM edms_folders WHERE entity_id = $1 AND parent_id IS NULL AND name = $2`,
      [entityId, space],
    );
    const rootId = root.rows[0]?.id;
    if (!rootId) throw new ConflictError('EDMS folders are not seeded for this subsidiary.');
    const name = EDMS_MODULE_FOLDER_NAMES[module];
    const child = await tx.client.query<{ id: string }>(
      `SELECT id FROM edms_folders WHERE entity_id = $1 AND parent_id = $2 AND name = $3`,
      [entityId, rootId, name],
    );
    if (child.rows[0]) return child.rows[0].id;
    return this.ensureChild(tx, entityId, rootId, name, 'module', actor, space === 'Archived' ? 'ARCHIVED' : 'ACTIVE');
  }

  private async archivedModuleFolder(tx: TxScope, entityId: string, module: EdmsModule): Promise<string> {
    return this.ensureModuleFolder(tx, entityId, module, 'Archived', {
      ref: 'system:edms',
      name: 'EDMS archive',
      role: null,
      scopeType: null,
      entityIds: [],
      isCorporate: true,
      isAdmin: false,
      permissions: [],
      homePath: null,
    });
  }

  private async ensureSlotFolders(
    tx: TxScope,
    entityId: string,
    packageId: string,
    actor: ActorContext,
  ): Promise<Record<string, string>> {
    const map: Record<string, string> = {};
    for (const slot of EDMS_PROCUREMENT_SLOTS) {
      map[slot.slot] = await this.ensureChild(
        tx,
        entityId,
        packageId,
        `${slot.slot} ${slot.label}`,
        'slot',
        actor,
      );
    }
    return map;
  }

  private async ensureChild(
    tx: TxScope,
    entityId: string,
    parentId: string,
    name: string,
    kind: EdmsFolderKind,
    actor: ActorContext,
    status: 'ACTIVE' | 'ARCHIVED' = 'ACTIVE',
  ): Promise<string> {
    const inserted = await tx.client.query<{ id: string }>(
      `INSERT INTO edms_folders (entity_id, parent_id, name, kind, status, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $6)
       ON CONFLICT (entity_id, parent_id, name) WHERE parent_id IS NOT NULL
       DO NOTHING
       RETURNING id`,
      [entityId, parentId, name, kind, status, actor.ref],
    );
    if (inserted.rows[0]) return inserted.rows[0].id;
    const existing = await tx.client.query<{ id: string }>(
      `SELECT id FROM edms_folders WHERE entity_id = $1 AND parent_id = $2 AND name = $3`,
      [entityId, parentId, name],
    );
    const id = existing.rows[0]?.id;
    if (!id) throw new Error(`Could not create EDMS folder ${name}.`);
    return id;
  }

  private async linkSlot(
    tx: TxScope,
    folderId: string | undefined,
    documentId: string | undefined,
    slot: string,
    entityId: string,
    actor: ActorContext,
  ): Promise<void> {
    if (!folderId || !documentId) return;
    await tx.client.query(
      `INSERT INTO edms_folder_items (folder_id, document_id, entity_id, slot, listed, created_by, updated_by)
       VALUES ($1, $2, $3, $4, true, $5, $5)
       ON CONFLICT (folder_id, document_id) DO NOTHING`,
      [folderId, documentId, entityId, slot, actor.ref],
    );
  }
}
