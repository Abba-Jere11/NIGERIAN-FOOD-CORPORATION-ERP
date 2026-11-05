import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import type { ActorContext } from '@nfc/db';
import { CurrentActor } from '../auth/current-actor.decorator';
import { ActorOnly, RequirePermission } from '../auth/require-permission.decorator';
import { zodPipe } from '../common/validation/zod-validation.pipe';
import { DepartmentsService } from './departments.service';
import { EntitiesService } from './entities.service';
import {
  createDepartmentSchema,
  createEntitySchema,
  departmentStatusChangeSchema,
  entityStatusChangeSchema,
  listDepartmentsSchema,
  updateDepartmentSchema,
  updateEntitySchema,
  type CreateDepartmentInput,
  type CreateEntityInput,
  type EntityStatusChangeInput,
  type ListDepartmentsInput,
  type UpdateDepartmentInput,
  type UpdateEntityInput,
} from './org.dto';

/**
 * Entity and department administration.
 *
 * Reading is open to every signed-in role that holds organization.view, but
 * scoped by Row-Level Security. Writing requires organization.entity.manage,
 * which the Administrator holds.
 */
@Controller('api/entities')
export class EntitiesController {
  constructor(
    private readonly entities: EntitiesService,
    private readonly departments: DepartmentsService,
  ) {}

  @Get()
  @RequirePermission('organization.view')
  list(@CurrentActor() actor: ActorContext) {
    return this.entities.list(actor);
  }

  @Get(':id')
  @RequirePermission('organization.view')
  get(@CurrentActor() actor: ActorContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.entities.get(actor, id);
  }

  @Post()
  @RequirePermission('organization.entity.manage')
  create(
    @CurrentActor() actor: ActorContext,
    @Body(zodPipe(createEntitySchema)) body: CreateEntityInput,
  ) {
    return this.entities.create(actor, body);
  }

  @Patch(':id')
  @RequirePermission('organization.entity.manage')
  update(
    @CurrentActor() actor: ActorContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(updateEntitySchema)) body: UpdateEntityInput,
  ) {
    return this.entities.update(actor, id, body);
  }

  /** Deactivation, not deletion (rule R3). A reason is mandatory (rule R11). */
  @Post(':id/deactivate')
  @RequirePermission('organization.entity.manage')
  deactivate(
    @CurrentActor() actor: ActorContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(entityStatusChangeSchema)) body: EntityStatusChangeInput,
  ) {
    return this.entities.setStatus(actor, id, 'INACTIVE', body);
  }

  @Post(':id/activate')
  @RequirePermission('organization.entity.manage')
  activate(
    @CurrentActor() actor: ActorContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(entityStatusChangeSchema)) body: EntityStatusChangeInput,
  ) {
    return this.entities.setStatus(actor, id, 'ACTIVE', body);
  }

  @Get(':id/departments')
  @RequirePermission('organization.view')
  listDepartments(
    @CurrentActor() actor: ActorContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Query(zodPipe(listDepartmentsSchema)) query: ListDepartmentsInput,
  ) {
    return this.departments.listForEntity(actor, id, query);
  }

  @Post(':id/departments')
  @ActorOnly()
  createDepartment(
    @CurrentActor() actor: ActorContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(createDepartmentSchema)) body: CreateDepartmentInput,
  ) {
    return this.departments.create(actor, id, body);
  }
}

@Controller('api/departments')
export class DepartmentsController {
  constructor(private readonly departments: DepartmentsService) {}

  @Patch(':id')
  @ActorOnly()
  update(
    @CurrentActor() actor: ActorContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(updateDepartmentSchema)) body: UpdateDepartmentInput,
  ) {
    return this.departments.update(actor, id, body);
  }

  @Post(':id/deactivate')
  @ActorOnly()
  deactivate(
    @CurrentActor() actor: ActorContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(departmentStatusChangeSchema)) body: EntityStatusChangeInput,
  ) {
    return this.departments.setStatus(actor, id, 'INACTIVE', body);
  }

  @Post(':id/activate')
  @ActorOnly()
  activate(
    @CurrentActor() actor: ActorContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(departmentStatusChangeSchema)) body: EntityStatusChangeInput,
  ) {
    return this.departments.setStatus(actor, id, 'ACTIVE', body);
  }
}
