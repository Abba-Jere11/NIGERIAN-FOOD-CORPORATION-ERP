import { Controller, Get, Query, Res } from '@nestjs/common';
import type { ActorContext } from '@nfc/db';
import { AUDIT_ACTIONS, AUDIT_ACTION_LABELS } from '@nfc/shared';
import type { Response } from 'express';
import { CurrentActor } from '../auth/current-actor.decorator';
import { RequirePermission } from '../auth/require-permission.decorator';
import { zodPipe } from '../common/validation/zod-validation.pipe';
import { auditExportQuerySchema, auditQuerySchema } from './audit.dto';
import { AuditService } from './audit.service';

/**
 * The audit viewer's API (M1 item 7).
 *
 * `audit.view` is held only by the MD and ED Finance, the two roles with
 * group-wide visibility in the five-role model (A5). Every other role is
 * refused here, not merely denied a menu item.
 */
@Controller('api/audit')
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  @Get()
  @RequirePermission('audit.view')
  async list(
    @CurrentActor() actor: ActorContext,
    @Query(zodPipe(auditQuerySchema)) query: ReturnType<typeof auditQuerySchema.parse>,
  ) {
    return this.auditService.query(actor, query);
  }

  /** Filter options for the viewer, so the interface never hardcodes them. */
  @Get('filters')
  @RequirePermission('audit.view')
  async filters(@CurrentActor() actor: ActorContext) {
    return {
      actions: AUDIT_ACTIONS.map((action) => ({
        value: action,
        label: AUDIT_ACTION_LABELS[action],
      })),
      subjectTypes: await this.auditService.subjectTypes(actor),
    };
  }

  @Get('export')
  @RequirePermission('audit.export')
  async exportCsv(
    @CurrentActor() actor: ActorContext,
    @Query(zodPipe(auditExportQuerySchema)) query: ReturnType<typeof auditExportQuerySchema.parse>,
    @Res() response: Response,
  ): Promise<void> {
    const { csv, rowCount, truncated } = await this.auditService.exportCsv(actor, query);
    const stamp = new Date().toISOString().slice(0, 10);

    response
      .status(200)
      .setHeader('Content-Type', 'text/csv; charset=utf-8')
      .setHeader('Content-Disposition', `attachment; filename="nfc-audit-log-${stamp}.csv"`)
      .setHeader('X-Row-Count', String(rowCount))
      .setHeader('X-Truncated', String(truncated))
      // Excel needs a byte-order mark to read UTF-8 correctly.
      .send(`\uFEFF${csv}`);
  }
}
