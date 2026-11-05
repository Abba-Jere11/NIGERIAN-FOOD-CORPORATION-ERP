import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import type { ActorContext } from '@nfc/db';
import { ActorOnly, RequirePermission } from '../auth/require-permission.decorator';
import { CurrentActor } from '../auth/current-actor.decorator';
import { ValidationFailedError } from '../common/errors/domain-error';
import { zodPipe } from '../common/validation/zod-validation.pipe';
import {
  adjustmentSchema,
  cancelProductionSchema,
  cancelSalesSchema,
  completeProductionSchema,
  countLineSchema,
  createCountSchema,
  createItemSchema,
  createProductionSchema,
  createSalesSchema,
  createWarehouseSchema,
  dispatchSalesSchema,
  entityQuery,
  invoiceSalesSchema,
  issueSchema,
  receiveTransferSchema,
  returnSalesSchema,
  startProductionSchema,
  submitSalesSchema,
  transferSchema,
  updateItemSchema,
  upsertCategorySchema,
  type AdjustmentInput,
  type CancelProductionInput,
  type CancelSalesInput,
  type CompleteProductionInput,
  type CountLineInput,
  type CreateCountInput,
  type CreateItemInput,
  type CreateProductionInput,
  type CreateSalesInput,
  type CreateWarehouseInput,
  type DispatchSalesInput,
  type InvoiceSalesInput,
  type IssueInput,
  type ReceiveTransferInput,
  type ReturnSalesInput,
  type StartProductionInput,
  type SubmitSalesInput,
  type TransferInput,
  type UpdateItemInput,
  type UpsertCategoryInput,
} from './inventory.dto';
import { InventoryService } from './inventory.service';
import { ProductionService } from './production.service';
import { SalesService } from './sales.service';

@Controller()
export class InventoryController {
  constructor(
    private readonly inventory: InventoryService,
    private readonly production: ProductionService,
    private readonly sales: SalesService,
  ) {}

  @Get('api/inventory/context')
  @RequirePermission('inventory.view')
  context(@CurrentActor() actor: ActorContext) {
    return this.inventory.context(actor);
  }

  @Get('api/inventory/kpis')
  @ActorOnly()
  kpis(@CurrentActor() actor: ActorContext) {
    return this.inventory.kpis(actor);
  }

  @Get('api/inventory/units')
  @RequirePermission('inventory.view')
  units(@CurrentActor() actor: ActorContext) {
    return this.inventory.units(actor);
  }

  @Get('api/inventory')
  @RequirePermission('inventory.view')
  overview(@CurrentActor() actor: ActorContext, @Query('entityId') entityId?: string) {
    return this.inventory.overview(actor, entityId);
  }

  @Get('api/inventory/categories')
  @RequirePermission('inventory.view')
  categories(@CurrentActor() actor: ActorContext, @Query('entityId') entityId?: string) {
    return this.inventory.categories(actor, entityId);
  }

  @Post('api/inventory/categories')
  @RequirePermission('inventory.config')
  upsertCategory(
    @CurrentActor() actor: ActorContext,
    @Body(zodPipe(upsertCategorySchema)) body: UpsertCategoryInput,
  ) {
    return this.inventory.upsertCategory(actor, body);
  }

  @Get('api/inventory/warehouses')
  @RequirePermission('inventory.view')
  warehouses(@CurrentActor() actor: ActorContext, @Query('entityId') entityId?: string) {
    return this.inventory.warehouses(actor, entityId);
  }

  @Post('api/inventory/warehouses')
  @RequirePermission('inventory.config')
  createWarehouse(
    @CurrentActor() actor: ActorContext,
    @Body(zodPipe(createWarehouseSchema)) body: CreateWarehouseInput,
  ) {
    return this.inventory.createWarehouse(actor, body);
  }

  @Get('api/inventory/items')
  @RequirePermission('inventory.view')
  listItems(
    @CurrentActor() actor: ActorContext,
    @Query('entityId') entityId?: string,
    @Query('q') q?: string,
    @Query('categoryId') categoryId?: string,
    @Query('stockStatus') stockStatus?: 'in_stock' | 'low' | 'out',
    @Query('warehouseId') warehouseId?: string,
  ) {
    return this.inventory.listItems(actor, entityId, { q, categoryId, stockStatus, warehouseId });
  }

  @Post('api/inventory/items')
  @RequirePermission('inventory.item.manage')
  createItem(@CurrentActor() actor: ActorContext, @Body(zodPipe(createItemSchema)) body: CreateItemInput) {
    return this.inventory.createItem(actor, body);
  }

  @Get('api/inventory/items/:id')
  @RequirePermission('inventory.view')
  getItem(@CurrentActor() actor: ActorContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.inventory.getItem(actor, id);
  }

  @Patch('api/inventory/items/:id')
  @RequirePermission('inventory.item.manage')
  updateItem(
    @CurrentActor() actor: ActorContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(updateItemSchema)) body: UpdateItemInput,
  ) {
    return this.inventory.updateItem(actor, id, body);
  }

  @Get('api/inventory/expected')
  @RequirePermission('inventory.view')
  expected(@CurrentActor() actor: ActorContext, @Query('entityId') entityId?: string) {
    return this.inventory.expected(actor, entityId);
  }

  @Get('api/inventory/movements')
  @RequirePermission('inventory.view')
  movements(
    @CurrentActor() actor: ActorContext,
    @Query('entityId') entityId?: string,
    @Query('source') source?: string,
    @Query('from') from?: string,
    @Query('q') q?: string,
    @Query('to') to?: string,
  ) {
    return this.inventory.movements(actor, entityId, { source, from, to, q });
  }

  @Get('api/inventory/alerts')
  @RequirePermission('inventory.view')
  alerts(@CurrentActor() actor: ActorContext, @Query('entityId') entityId?: string) {
    return this.inventory.alerts(actor, entityId);
  }

  @Get('api/inventory/issues')
  @RequirePermission('inventory.view')
  listIssues(@CurrentActor() actor: ActorContext, @Query('entityId') entityId?: string) {
    return this.inventory.listIssues(actor, entityId);
  }

  @Post('api/inventory/issues')
  @RequirePermission('inventory.issue')
  issue(@CurrentActor() actor: ActorContext, @Body(zodPipe(issueSchema)) body: IssueInput) {
    return this.inventory.issue(actor, body);
  }

  @Get('api/inventory/transfers')
  @RequirePermission('inventory.view')
  listTransfers(@CurrentActor() actor: ActorContext, @Query('entityId') entityId?: string) {
    return this.inventory.listTransfers(actor, entityId);
  }

  @Post('api/inventory/transfers')
  @RequirePermission('inventory.transfer')
  transfer(@CurrentActor() actor: ActorContext, @Body(zodPipe(transferSchema)) body: TransferInput) {
    return this.inventory.transfer(actor, body);
  }

  @Post('api/inventory/transfers/:id/receive')
  @RequirePermission('inventory.receive')
  receiveTransfer(
    @CurrentActor() actor: ActorContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(receiveTransferSchema)) body: ReceiveTransferInput,
  ) {
    return this.inventory.receiveTransfer(actor, id, body);
  }

  @Get('api/inventory/adjustments')
  @RequirePermission('inventory.view')
  listAdjustments(@CurrentActor() actor: ActorContext, @Query('entityId') entityId?: string) {
    return this.inventory.listAdjustments(actor, entityId);
  }

  @Post('api/inventory/adjustments')
  @RequirePermission('inventory.adjust.prepare')
  prepareAdjustment(
    @CurrentActor() actor: ActorContext,
    @Body(zodPipe(adjustmentSchema)) body: AdjustmentInput,
  ) {
    return this.inventory.prepareAdjustment(actor, body);
  }

  @Get('api/inventory/counts')
  @RequirePermission('inventory.view')
  listCounts(@CurrentActor() actor: ActorContext, @Query('entityId') entityId?: string) {
    return this.inventory.listCounts(actor, entityId);
  }

  @Post('api/inventory/counts')
  @RequirePermission('inventory.count')
  createCount(@CurrentActor() actor: ActorContext, @Body(zodPipe(createCountSchema)) body: CreateCountInput) {
    return this.inventory.createCount(actor, body);
  }

  @Patch('api/inventory/counts/:id/lines/:lineId')
  @RequirePermission('inventory.count')
  updateCountLine(
    @CurrentActor() actor: ActorContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('lineId', ParseUUIDPipe) lineId: string,
    @Body(zodPipe(countLineSchema)) body: CountLineInput,
  ) {
    return this.inventory.updateCountLine(actor, id, lineId, body);
  }

  @Post('api/inventory/counts/:id/submit')
  @RequirePermission('inventory.count')
  submitCount(@CurrentActor() actor: ActorContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.inventory.submitCount(actor, id);
  }

  @Get('api/inventory/production')
  @RequirePermission('sales.view')
  listProduction(@CurrentActor() actor: ActorContext, @Query('entityId') entityId?: string) {
    return this.production.list(actor, entityId);
  }

  @Post('api/inventory/production')
  @RequirePermission('production.create')
  createProduction(
    @CurrentActor() actor: ActorContext,
    @Body(zodPipe(createProductionSchema)) body: CreateProductionInput,
  ) {
    return this.production.create(actor, body);
  }

  @Get('api/inventory/production/:id')
  @RequirePermission('sales.view')
  getProduction(@CurrentActor() actor: ActorContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.production.get(actor, id);
  }

  @Post('api/inventory/production/:id/start')
  @RequirePermission('production.create')
  startProduction(
    @CurrentActor() actor: ActorContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(startProductionSchema)) body: StartProductionInput,
  ) {
    return this.production.start(actor, id, body);
  }

  @Post('api/inventory/production/:id/complete')
  @RequirePermission('production.complete')
  completeProduction(
    @CurrentActor() actor: ActorContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(completeProductionSchema)) body: CompleteProductionInput,
  ) {
    return this.production.submitComplete(actor, id, body);
  }

  @Post('api/inventory/production/:id/cancel')
  @RequirePermission('production.create')
  cancelProduction(
    @CurrentActor() actor: ActorContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(cancelProductionSchema)) body: CancelProductionInput,
  ) {
    return this.production.cancel(actor, id, body);
  }

  @Get('api/inventory/sales')
  @RequirePermission('sales.view')
  listSales(@CurrentActor() actor: ActorContext, @Query('entityId') entityId?: string) {
    return this.sales.list(actor, entityId);
  }

  @Post('api/inventory/sales')
  @RequirePermission('sales.order.create')
  createSales(@CurrentActor() actor: ActorContext, @Body(zodPipe(createSalesSchema)) body: CreateSalesInput) {
    return this.sales.create(actor, body);
  }

  @Get('api/inventory/sales/customers')
  @RequirePermission('sales.view')
  salesCustomers(@CurrentActor() actor: ActorContext, @Query('entityId') entityId?: string) {
    return this.sales.customers(actor, this.requireEntity(entityId));
  }

  @Get('api/inventory/sales/dispatches')
  @RequirePermission('sales.view')
  listDispatches(@CurrentActor() actor: ActorContext, @Query('entityId') entityId?: string) {
    return this.sales.listDispatches(actor, entityId);
  }

  @Get('api/inventory/sales/invoices')
  @RequirePermission('sales.view')
  listSalesInvoices(@CurrentActor() actor: ActorContext, @Query('entityId') entityId?: string) {
    return this.sales.listInvoices(actor, entityId);
  }

  @Get('api/inventory/sales/:id')
  @RequirePermission('sales.view')
  getSales(@CurrentActor() actor: ActorContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.sales.get(actor, id);
  }

  @Post('api/inventory/sales/:id/submit')
  @RequirePermission('sales.order.create')
  submitSales(
    @CurrentActor() actor: ActorContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(submitSalesSchema)) body: SubmitSalesInput,
  ) {
    return this.sales.submit(actor, id, body);
  }

  @Post('api/inventory/sales/:id/cancel')
  @RequirePermission('sales.order.create')
  cancelSales(
    @CurrentActor() actor: ActorContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(cancelSalesSchema)) body: CancelSalesInput,
  ) {
    return this.sales.cancel(actor, id, body);
  }

  @Post('api/inventory/sales/:id/dispatch')
  @RequirePermission('sales.dispatch')
  dispatchSales(
    @CurrentActor() actor: ActorContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(dispatchSalesSchema)) body: DispatchSalesInput,
  ) {
    return this.sales.dispatch(actor, id, body);
  }

  @Post('api/inventory/sales/:id/invoice')
  @RequirePermission('sales.invoice')
  invoiceSales(
    @CurrentActor() actor: ActorContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(invoiceSalesSchema)) body: InvoiceSalesInput,
  ) {
    return this.sales.invoice(actor, id, body);
  }

  @Post('api/inventory/sales/:id/return')
  @RequirePermission('sales.dispatch')
  returnSales(
    @CurrentActor() actor: ActorContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(returnSalesSchema)) body: ReturnSalesInput,
  ) {
    return this.sales.returnOrder(actor, id, body);
  }

  private requireEntity(entityId?: string): string {
    void entityQuery;
    if (!entityId) throw new ValidationFailedError('An entity is required.');
    return entityId;
  }
}
