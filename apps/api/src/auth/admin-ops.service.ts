import { Injectable } from '@nestjs/common';
import type { ActorContext } from '@nfc/db';
import type { PermissionKey, SealView } from '@nfc/shared';
import { assertCan } from './can';
import { NotFoundError } from '../common/errors/domain-error';
import { UnitOfWork } from '../database/unit-of-work';
import { SealsService } from '../seals/seals.service';

export interface WorkflowDefinitionAdminView {
  id: string;
  key: string;
  name: string;
  version: number;
  stages: Array<{
    id: string;
    key: string;
    label: string;
    sortOrder: number;
    requiredPermission: PermissionKey | null;
  }>;
}

@Injectable()
export class AdminOpsService {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly seals: SealsService,
  ) {}

  async listWorkflowDefinitions(actor: ActorContext): Promise<WorkflowDefinitionAdminView[]> {
    assertCan(actor, 'admin.health.view');
    return this.unitOfWork.read(actor, async (tx) => {
      const defs = await tx.client.query<{ id: string; key: string; name: string; version: number }>(
        `SELECT id, key, name, version FROM workflow_definitions ORDER BY key, version DESC`,
      );
      const stages = await tx.client.query<{
        definition_id: string;
        id: string;
        key: string;
        label: string;
        sort_order: number;
        required_permission: PermissionKey | null;
      }>(
        `SELECT definition_id, id, key, label, sort_order, required_permission
           FROM workflow_stages ORDER BY definition_id, sort_order`,
      );
      const byDef = new Map<string, WorkflowDefinitionAdminView['stages']>();
      for (const stage of stages.rows) {
        const list = byDef.get(stage.definition_id) ?? [];
        list.push({
          id: stage.id,
          key: stage.key,
          label: stage.label,
          sortOrder: stage.sort_order,
          requiredPermission: stage.required_permission,
        });
        byDef.set(stage.definition_id, list);
      }
      const seen = new Set<string>();
      const views: WorkflowDefinitionAdminView[] = [];
      for (const row of defs.rows) {
        if (seen.has(row.key)) continue;
        seen.add(row.key);
        views.push({
          id: row.id,
          key: row.key,
          name: row.name,
          version: row.version,
          stages: byDef.get(row.id) ?? [],
        });
      }
      return views;
    });
  }

  async listSlaThresholds(actor: ActorContext): Promise<Array<{ days: number }>> {
    assertCan(actor, 'admin.health.view');
    return this.unitOfWork.read(actor, async (tx) => {
      const result = await tx.client.query<{ days: number }>(
        `SELECT days FROM sla_thresholds ORDER BY days`,
      );
      return result.rows;
    });
  }

  async listNotificationTypes(actor: ActorContext): Promise<
    Array<{ type: string; label: string; category: string; mandatory: boolean }>
  > {
    assertCan(actor, 'admin.user.manage');
    return this.unitOfWork.read(actor, async (tx) => {
      const result = await tx.client.query<{
        type: string;
        label: string;
        category: string;
        mandatory: boolean;
      }>(`SELECT type, label, category, mandatory FROM notification_types ORDER BY category, type`);
      return result.rows;
    });
  }

  async documentAccess(
    actor: ActorContext,
    query: string,
    limit = 50,
    offset = 0,
  ): Promise<{
    items: Array<{
      id: string;
      documentId: string;
      documentTitle: string | null;
      action: string;
      actorRef: string;
      occurredAt: string;
      entityCode: string | null;
    }>;
    total: number;
  }> {
    assertCan(actor, 'admin.health.view');
    const trimmed = query.trim();
    return this.unitOfWork.read(actor, async (tx) => {
      const pattern = trimmed === '' ? null : `%${trimmed}%`;
      const totalResult = await tx.client.query<{ n: string }>(
        `SELECT count(*)::text AS n
           FROM document_access_log l
           LEFT JOIN documents d ON d.id = l.document_id
          WHERE ($1::text IS NULL OR d.title ILIKE $1 OR l.actor_ref ILIKE $1 OR l.action ILIKE $1)`,
        [pattern],
      );
      const result = await tx.client.query<{
        id: string;
        document_id: string;
        document_title: string | null;
        action: string;
        actor_ref: string;
        occurred_at: Date;
        entity_code: string | null;
      }>(
        `SELECT l.id, l.document_id, d.title AS document_title, l.action, l.actor_ref, l.occurred_at,
                e.code AS entity_code
           FROM document_access_log l
           LEFT JOIN documents d ON d.id = l.document_id
           LEFT JOIN entities e ON e.id = l.entity_id
          WHERE ($1::text IS NULL OR d.title ILIKE $1 OR l.actor_ref ILIKE $1 OR l.action ILIKE $1)
          ORDER BY l.occurred_at DESC
          LIMIT $2 OFFSET $3`,
        [pattern, limit, offset],
      );
      return {
        total: Number(totalResult.rows[0]?.n ?? 0),
        items: result.rows.map((row) => ({
          id: row.id,
          documentId: row.document_id,
          documentTitle: row.document_title,
          action: row.action,
          actorRef: row.actor_ref,
          occurredAt: row.occurred_at.toISOString(),
          entityCode: row.entity_code,
        })),
      };
    });
  }

  async verifySealsByReference(
    actor: ActorContext,
    reference: string,
  ): Promise<{ reference: string; subjectId: string; seals: SealView[] }> {
    assertCan(actor, 'admin.health.view');
    const trimmed = reference.trim();
    if (trimmed === '') throw new NotFoundError('Enter a procurement or requisition reference.');
    return this.unitOfWork.read(actor, async (tx) => {
      const request = await tx.client.query<{ id: string; current_version: number; reference_number: string }>(
        `SELECT id, current_version, reference_number
           FROM procurement_requests
          WHERE reference_number = $1
          LIMIT 1`,
        [trimmed],
      );
      const row = request.rows[0];
      if (!row) throw new NotFoundError('No procurement request matches that reference.');
      const snapshots = await tx.client.query<{ canonical_json: unknown; version_number: number }>(
        `SELECT ms.canonical_json, v.version_number
           FROM procurement_memo_snapshots ms
           JOIN procurement_versions v ON v.id = ms.version_id
          WHERE ms.request_id = $1
          ORDER BY v.version_number DESC`,
        [row.id],
      );
      const frozen = snapshots.rows.map((snap) => snap.canonical_json);
      const current = frozen[0] ?? { reference: row.reference_number };
      const byVersion = new Map(
        snapshots.rows.map((snap) => [snap.version_number, snap.canonical_json] as const),
      );
      const seals = await this.seals.verifyAll(
        tx,
        'PROCUREMENT',
        row.id,
        row.current_version,
        current,
        actor,
        byVersion,
        frozen,
      );
      return { reference: row.reference_number, subjectId: row.id, seals };
    });
  }
}
