import type { PermissionKey } from './permissions';
import type { RecordStatus } from './org';

export const INVENTORY_TRACKING_MODES = ['none', 'batch_lot', 'serial'] as const;
export type InventoryTrackingMode = (typeof INVENTORY_TRACKING_MODES)[number];

export const WAREHOUSE_KINDS = ['store', 'cold_room', 'yard', 'plant'] as const;
export type WarehouseKind = (typeof WAREHOUSE_KINDS)[number];

export const STOCK_MOVEMENT_SOURCES = [
  'GRN',
  'ISSUE',
  'TRANSFER',
  'ADJUSTMENT',
  'COUNT',
  'WRITE_OFF',
  'REVERSE',
  'PRODUCTION',
  'SALE',
  'SALES_RETURN',
] as const;
export type StockMovementSource = (typeof STOCK_MOVEMENT_SOURCES)[number];

export const ISSUE_DESTINATIONS = ['department', 'production', 'project'] as const;
export type IssueDestination = (typeof ISSUE_DESTINATIONS)[number];

export const ADJUSTMENT_KINDS = ['increase', 'decrease', 'damaged', 'expired', 'count_variance'] as const;
export type AdjustmentKind = (typeof ADJUSTMENT_KINDS)[number];

export const INVENTORY_NAV_PERMISSIONS: readonly PermissionKey[] = ['inventory.view'];

export function hasInventoryNavPermission(permissions: readonly string[]): boolean {
  return INVENTORY_NAV_PERMISSIONS.some((key) => permissions.includes(key));
}

export interface InventoryContextView {
  canConsolidate: boolean;
  entities: Array<{ id: string; code: string; name: string; type: string }>;
}

export interface InventoryCategoryView {
  id: string;
  entityId: string;
  entityCode: string | null;
  key: string;
  name: string;
  status: RecordStatus;
  rowVersion: number;
}

export interface WarehouseView {
  id: string;
  entityId: string;
  entityCode: string | null;
  code: string;
  name: string;
  kind: WarehouseKind;
  status: RecordStatus;
  rowVersion: number;
}

export interface InventoryItemListView {
  id: string;
  entityId: string;
  entityCode: string | null;
  code: string;
  name: string;
  categoryId: string;
  categoryName: string;
  uomCode: string;
  trackingMode: InventoryTrackingMode;
  asset: boolean;
  reorderLevel: number;
  onHandQty: number;
  reservedQty: number;
  availableQty: number;
  onHandValueKobo: number;
  belowReorder: boolean;
  status: RecordStatus;
  rowVersion: number;
}

export function inventoryStockStatus(row: {
  onHandQty: number;
  reorderLevel: number;
}): 'out' | 'low' | 'in_stock' {
  if (row.onHandQty <= 0) return 'out';
  if (row.onHandQty <= row.reorderLevel) return 'low';
  return 'in_stock';
}

export interface InventoryItemDetailView extends InventoryItemListView {
  uomId: string;
  defaultWarehouseId: string | null;
  costMethod: 'weighted_average';
  suppliers: Array<{ vendorId: string; vendorName: string }>;
  producedFrom: Array<{
    orderId: string;
    orderReference: string;
    rawBatchCode: string;
    quantity: number;
  }>;
  consumedIn: Array<{
    orderId: string;
    orderReference: string;
    finishedBatchCode: string;
    quantity: number;
  }>;
  soldOn: Array<{
    orderId: string;
    orderReference: string;
    quantity: number;
    status: string;
  }>;
  onHandByWarehouse: Array<{ warehouseId: string; warehouseName: string; qty: number; valueKobo: number }>;
  batches: Array<{ id: string; batchCode: string; warehouseName: string; qty: number }>;
  serials: Array<{ id: string; serialCode: string; status: string; warehouseName: string }>;
  movements: StockMovementView[];
  purchaseHistory: Array<{
    procurementReference: string;
    procurementId: string;
    grnReference: string | null;
    vendorName: string | null;
    quantity: number;
    occurredOn: string;
  }>;
}

export interface ExpectedStockView {
  id: string;
  entityId: string;
  procurementId: string;
  procurementReference: string;
  lineId: string;
  itemId: string | null;
  itemCode: string | null;
  itemName: string | null;
  vendorName: string | null;
  quantityExpected: number;
  quantityRemaining: number;
  requiredDate: string | null;
  status: 'OPEN' | 'CLOSED';
}

export interface StockMovementView {
  id: string;
  referenceNumber: string;
  itemId: string;
  itemCode: string;
  itemName: string;
  entityCode: string | null;
  warehouseName: string;
  quantityIn: number;
  quantityOut: number;
  unitCostKobo: number;
  valueKobo: number;
  source: StockMovementSource;
  procurementId: string | null;
  procurementReference: string | null;
  grnId: string | null;
  grnReference: string | null;
  occurredOn: string;
  createdBy: string;
  notes: string | null;
}

export interface StockIssueView {
  id: string;
  referenceNumber: string;
  warehouseName: string;
  destinationType: IssueDestination;
  destinationLabel: string | null;
  reason: string;
  status: string;
  occurredOn: string;
  lines: Array<{ itemCode: string; itemName: string; quantity: number }>;
}

export interface StockTransferView {
  id: string;
  referenceNumber: string;
  sourceEntityId: string;
  destinationEntityId: string;
  sourceEntityCode: string | null;
  destEntityCode: string | null;
  sourceWarehouseName: string;
  destWarehouseName: string | null;
  status: string;
  reason: string;
  occurredOn: string;
  intercompanyId: string | null;
  lines: Array<{ itemCode: string; itemName: string; quantity: number }>;
}

export interface StockAdjustmentView {
  id: string;
  referenceNumber: string;
  warehouseName: string;
  kind: AdjustmentKind;
  reason: string;
  status: string;
  occurredOn: string;
  createdBy: string;
  lines: Array<{ itemCode: string; itemName: string; quantity: number }>;
}

export interface StockCountView {
  id: string;
  referenceNumber: string;
  warehouseName: string;
  mode: 'blind' | 'guided';
  status: string;
  countedOn: string;
  lines: Array<{
    id: string;
    itemId: string;
    itemCode: string;
    itemName: string;
    systemQty: number;
    countedQty: number | null;
    varianceQty: number | null;
  }>;
}

export interface InventoryDashboardBucket {
  key: string;
  label: string;
  href?: string;
  itemCount: number;
  onHandValueKobo: number;
  lowStockCount?: number;
}

export interface InventoryAttentionItem {
  kind: 'low_stock' | 'out_of_stock' | 'overdue_expected' | 'pending_adjustment' | 'in_transit';
  label: string;
  href: string;
  detail: string;
}

export interface InventoryOverviewView {
  consolidated: boolean;
  entityId: string | null;
  entityCode: string | null;
  itemCount: number;
  onHandValueKobo: number;
  expectedLines: number;
  lowStockCount: number;
  outOfStockCount: number;
  reservedSalesLines: number;
  inTransitCount: number;
  inTransitValueKobo: number;
  pendingAdjustments: number;
  openProductionOrders: number;
  damagedOrExpiredPending: number;
  byEntity: InventoryDashboardBucket[];
  byCategory: InventoryDashboardBucket[];
  byWarehouse: InventoryDashboardBucket[];
  attention: InventoryAttentionItem[];
  recentMovements: StockMovementView[];
  rows: InventoryItemListView[];
}

export const PRODUCTION_ORDER_STATUSES = [
  'PLANNED',
  'IN_PROGRESS',
  'AWAITING_APPROVAL',
  'COMPLETED',
  'CANCELLED',
] as const;
export type ProductionOrderStatus = (typeof PRODUCTION_ORDER_STATUSES)[number];

export const SALES_ORDER_STATUSES = [
  'DRAFT',
  'AWAITING_APPROVAL',
  'RESERVED',
  'PART_DISPATCHED',
  'DISPATCHED',
  'INVOICED',
  'CANCELLED',
  'RETURNED',
] as const;
export type SalesOrderStatus = (typeof SALES_ORDER_STATUSES)[number];

export interface ProductionOrderLineView {
  id: string;
  itemId: string;
  itemCode: string;
  itemName: string;
  warehouseId: string;
  warehouseName: string;
  batchId: string | null;
  batchCode: string | null;
  plannedQty: number;
  actualQty: number | null;
  unitCostKobo: number | null;
}

export interface ProductionOrderView {
  id: string;
  referenceNumber: string;
  entityId: string;
  entityCode: string | null;
  warehouseId: string;
  warehouseName: string;
  finishedItemId: string;
  finishedItemCode: string;
  finishedItemName: string;
  plannedOutputQty: number;
  actualOutputQty: number | null;
  wasteQty: number;
  wasteReason: string | null;
  yieldPct: number | null;
  finishedBatchId: string | null;
  finishedBatchCode: string | null;
  producedOn: string | null;
  status: ProductionOrderStatus;
  cancelReason: string | null;
  workflowInstanceId: string | null;
  createdBy: string;
  rowVersion: number;
  inputs: ProductionOrderLineView[];
  outputs: ProductionOrderLineView[];
  batchLinks: Array<{
    finishedBatchCode: string;
    rawBatchCode: string;
    quantity: number;
  }>;
}

export interface SalesOrderLineView {
  id: string;
  itemId: string;
  itemCode: string;
  itemName: string;
  warehouseId: string;
  warehouseName: string;
  quantity: number;
  unitPriceKobo: number;
  reservedQty: number;
  dispatchedQty: number;
}

export interface SalesDispatchView {
  id: string;
  referenceNumber: string;
  salesOrderId: string;
  salesOrderReference: string;
  vehicle: string | null;
  driver: string | null;
  destination: string;
  documentId: string | null;
  status: string;
  occurredOn: string;
  lines: Array<{ itemCode: string; itemName: string; quantity: number }>;
}

export interface SalesInvoiceView {
  id: string;
  referenceNumber: string;
  salesOrderId: string;
  salesOrderReference: string;
  customerName: string;
  amountKobo: number;
  allocatedKobo: number;
  status: string;
  invoiceDate: string;
}

export interface SalesOrderView {
  id: string;
  referenceNumber: string;
  entityId: string;
  entityCode: string | null;
  customerId: string;
  customerName: string;
  terms: string | null;
  dueOn: string | null;
  occurredOn: string;
  status: SalesOrderStatus;
  cancelReason: string | null;
  receivableInvoiceId: string | null;
  receivableInvoiceReference: string | null;
  workflowInstanceId: string | null;
  createdBy: string;
  rowVersion: number;
  lines: SalesOrderLineView[];
  dispatches: SalesDispatchView[];
}

export interface SalesCustomerOption {
  id: string;
  name: string;
}
