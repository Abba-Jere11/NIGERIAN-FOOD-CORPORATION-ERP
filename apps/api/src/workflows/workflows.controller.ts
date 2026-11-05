import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import type { ActorContext } from '@nfc/db';
import { PR_2026_000184_SUBJECT_ID } from '@nfc/shared';
import { z } from 'zod';
import { CurrentActor } from '../auth/current-actor.decorator';
import { ActorOnly } from '../auth/require-permission.decorator';
import { NotFoundError } from '../common/errors/domain-error';
import { zodPipe } from '../common/validation/zod-validation.pipe';
import { WorkflowsService } from './workflows.service';

const actSchema = z.object({
  action: z.string().trim().min(1),
  reason: z.string().optional(),
  rowVersion: z.number().int().positive(),
  idempotencyKey: z.string().uuid().optional(),
});

const submitSchema = z.object({
  definitionKey: z.string().trim().min(1).optional(),
});

@Controller()
export class WorkflowsController {
  constructor(private readonly workflows: WorkflowsService) {}

  @Get('api/workflows/pending')
  @ActorOnly()
  pending(@CurrentActor() actor: ActorContext) {
    return this.workflows.pending(actor);
  }

  @Get('api/workflows/fixture/milling-machine')
  @ActorOnly()
  fixture(@CurrentActor() actor: ActorContext) {
    return this.workflows.getBySubject(actor, PR_2026_000184_SUBJECT_ID);
  }

  @Get('api/workflows/:id')
  @ActorOnly()
  async get(@CurrentActor() actor: ActorContext, @Param('id', ParseUUIDPipe) id: string) {
    try {
      return await this.workflows.get(actor, id);
    } catch (error) {
      if (error instanceof NotFoundError) return this.workflows.getBySubject(actor, id);
      throw error;
    }
  }

  @Post('api/workflows/demo')
  @ActorOnly()
  createDemo(
    @CurrentActor() actor: ActorContext,
    @Body(zodPipe(z.object({ title: z.string().trim().min(1), definitionKey: z.string().optional() })))
    body: { title: string; definitionKey?: string },
  ) {
    return this.workflows.createAndSubmit(actor, body.title, body.definitionKey);
  }

  @Post('api/workflows/subjects/:id/submit')
  @ActorOnly()
  submit(
    @CurrentActor() actor: ActorContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(submitSchema)) body: z.infer<typeof submitSchema>,
  ) {
    return this.workflows.submit(actor, { subjectId: id, definitionKey: body.definitionKey });
  }

  @Post('api/workflows/:id/actions')
  @ActorOnly()
  act(
    @CurrentActor() actor: ActorContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(actSchema)) body: z.infer<typeof actSchema>,
  ) {
    return this.workflows.act(actor, { instanceId: id, ...body });
  }

  @Post('api/workflows/:id/resubmit')
  @ActorOnly()
  resubmit(
    @CurrentActor() actor: ActorContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(z.object({ rowVersion: z.number().int().positive() }))) body: { rowVersion: number },
  ) {
    return this.workflows.resubmit(actor, id, body.rowVersion);
  }
}
