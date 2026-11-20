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
  'QC',
  'RETURN_IN',
  'RETURN_SUPPLIER',
  'DISPOSAL',
] as const;
export type StockMovementSource = (typeof STOCK_MOVEMENT_SOURCES)[number];

/** Status of a quantity on the one stock ledger. Only AVAILABLE stock can be issued, sold or reserved. */
export const STOCK_STATUSES = ['AVAILABLE', 'QUARANTINED', 'REJECTED'] as const;
export type StockStatus = (typeof STOCK_STATUSES)[number];

export const ISSUE_DESTINATIONS = ['department', 'production', 'project'] as const;
export type IssueDestination = (typeof ISSUE_DESTINATIONS)[number];

export const ADJUSTMENT_KINDS = [
  'increase',
  'decrease',
  'damaged',
  'expired',
  'count_variance',
  'disposal',
  'asset_disposal',
] as const;
export type AdjustmentKind = (typeof ADJUSTMENT_KINDS)[number];

/** Lane B write-off kinds raised from the desk Dispose tile. */
export const DISPOSAL_KINDS = ['damaged', 'expired', 'disposal'] as const;
export type DisposalKind = (typeof DISPOSAL_KINDS)[number];

/** Adjustment kinds that may only start from a completed count. */
export const COUNT_ADJUSTMENT_KINDS = ['increase', 'decrease', 'count_variance'] as const;

export const INVENTORY_SETTING_KEYS = [
  'lane_b_value_threshold_kobo',
  'production_variance_tolerance_bps',
  'expiry_warning_days',
] as const;
export type InventorySettingKey = (typeof INVENTORY_SETTING_KEYS)[number];

/** Whole-unit codes that reject a fractional quantity on desk forms. */
export const INTEGER_UOM_CODES = ['PCS', 'BAG', 'CTN', 'HEAD'] as const;

export const BATCH_EXPIRY_STATUSES = ['valid', 'expired', 'near', 'undated'] as const;
export type BatchExpiryStatus = (typeof BATCH_EXPIRY_STATUSES)[number];

/** Calendar-date expiry status. `today` must be YYYY-MM-DD (server CURRENT_DATE). */
export function batchExpiryStatus(
  expiresOn: string | null | undefined,
  warningDays: number | null,
  today: string,
): BatchExpiryStatus {
  if (!expiresOn) return 'undated';
  if (expiresOn < today) return 'expired';
  if (warningDays != null && warningDays >= 0) {
    const until = new Date(`${today}T00:00:00Z`);
    until.setUTCDate(until.getUTCDate() + warningDays);
    const limit = until.toISOString().slice(0, 10);
    if (expiresOn <= limit) return 'near';
  }
  return 'valid';
}

export interface InventorySettingView {
  key: InventorySettingKey;
  description: string;
  unit: string;
  status: 'UNCONFIRMED' | 'CONFIRMED';
  value: number | null;
  confirmedBy: string | null;
  confirmedAt: string | null;
}

export const DESK_TILES = [
  'issue',
  'transfer',
  'dispatch',
  'production_issue',
  'receive_return',
  'return_supplier',
  'dispose',
  'asset_move',
  'adjust',
  'qc',
] as const;
export type DeskTile = (typeof DESK_TILES)[number];

/** Permission that shows each Operations Desk tile. GM sees only QC. */
export const DESK_TILE_PERMISSION: Record<DeskTile, PermissionKey> = {
  issue: 'inventory.issue',
  transfer: 'inventory.transfer',
  dispatch: 'sales.dispatch',
  production_issue: 'production.complete',
  receive_return: 'inventory.issue',
  return_supplier: 'inventory.return.supplier',
  dispose: 'inventory.dispose.request',
  asset_move: 'inventory.asset.manage',
  adjust: 'inventory.adjust.prepare',
  qc: 'inventory.qc.release',
};

export function deskTilesFor(permissions: readonly string[]): DeskTile[] {
  return DESK_TILES.filter((tile) => permissions.includes(DESK_TILE_PERMISSION[tile]));
}

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

export interface WarehouseLocationView {
  id: string;
  entityId: string;
  warehouseId: string;
  warehouseCode: string;
  warehouseName: string;
  code: string;
  name: string;
  status: RecordStatus;
  rowVersion: number;
}

export interface StockBatchListView {
  id: string;
  entityId: string;
  entityCode: string | null;
  itemId: string;
  itemCode: string;
  itemName: string;
  warehouseId: string;
  warehouseName: string;
  batchCode: string;
  qty: number;
  manufacturedOn: string | null;
  expiresOn: string | null;
  expiryStatus: BatchExpiryStatus;
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
  /** Physical quantity in the store, whatever its status. */
  onHandQty: number;
  reservedQty: number;
  /** Released stock less reservations. Quarantined and rejected stock is never available. */
  availableQty: number;
  quarantinedQty: number;
  rejectedQty: number;
  /** Raw material issued to production orders that are not yet completed. */
  wipQty: number;
  /** Approved, not yet received procurement quantity. A forecast, never a balance. */
  incomingQty: number;
  onHandValueKobo: number;
  belowReorder: boolean;
  status: RecordStatus;
  rowVersion: number;
}

export function inventoryStockStatus(row: {
  onHandQty: number;
  availableQty?: number;
  reorderLevel: number;
}): 'out' | 'low' | 'in_stock' {
  const usable = row.availableQty ?? row.onHandQty;
  if (usable <= 0) return 'out';
  if (usable <= row.reorderLevel) return 'low';
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
  batches: Array<{
    id: string;
    batchCode: string;
    warehouseName: string;
    qty: number;
    manufacturedOn: string | null;
    expiresOn: string | null;
    expiryStatus: BatchExpiryStatus;
  }>;
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
  stockStatus: StockStatus;
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
  warehouseId: string;
  warehouseName: string;
  destinationType: IssueDestination;
  destinationLabel: string | null;
  reason: string;
  status: string;
  occurredOn: string;
  recipientName: string | null;
  valueKobo: number | null;
  workflowInstanceId: string | null;
  lines: Array<{
    id: string;
    itemId: string;
    itemCode: string;
    itemName: string;
    quantity: number;
    remainingQty: number;
  }>;
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
  countId: string | null;
  countReference: string | null;
  assetId: string | null;
  valueKobo: number | null;
  requiresFinance: boolean;
  lines: Array<{ itemCode: string; itemName: string; quantity: number }>;
}

export interface StockCountView {
  id: string;
  referenceNumber: string;
  entityId: string;
  warehouseId: string;
  warehouseName: string;
  mode: 'blind' | 'guided';
  status: string;
  countedOn: string;
  completedAt: string | null;
  adjustmentId: string | null;
  adjustmentReference: string | null;
  lines: Array<{
    id: string;
    itemId: string;
    itemCode: string;
    itemName: string;
    systemQty: number;
    countedQty: number | null;
    varianceQty: number | null;
    explanation: string | null;
  }>;
}

/** Quarantined stock awaiting the GM's QC decision. */
export interface QuarantineLineView {
  entityId: string;
  itemId: string;
  itemCode: string;
  itemName: string;
  uomCode: string;
  warehouseId: string;
  warehouseName: string;
  batchId: string | null;
  batchCode: string | null;
  serialId: string | null;
  serialCode: string | null;
  quantity: number;
  grnId: string | null;
  grnReference: string | null;
  procurementId: string | null;
  procurementReference: string | null;
  productionOrderId: string | null;
  productionReference: string | null;
  returnId: string | null;
  returnReference: string | null;
}

export interface QcDecisionView {
  id: string;
  entityId: string;
  itemCode: string;
  itemName: string;
  warehouseName: string;
  batchCode: string | null;
  decision: 'RELEASE' | 'REJECT';
  quantity: number;
  reason: string;
  grnReference: string | null;
  procurementReference: string | null;
  productionReference: string | null;
  createdBy: string;
  createdAt: string;
}

export interface StockReturnView {
  id: string;
  referenceNumber: string;
  entityId: string;
  kind: 'RECEIVE_RETURN' | 'SUPPLIER_RETURN';
  warehouseName: string;
  vendorName: string | null;
  grnReference: string | null;
  returnedByName: string | null;
  departmentLabel: string | null;
  reason: string;
  occurredOn: string;
  lines: Array<{ itemCode: string; itemName: string; quantity: number; fromStatus: StockStatus | null }>;
}

/** Eligible rejected or quarantined stock that can still be returned to a supplier. */
export interface SupplierReturnableLineView {
  itemId: string;
  itemCode: string;
  itemName: string;
  uomCode: string;
  warehouseId: string;
  warehouseName: string;
  batchId: string | null;
  batchCode: string | null;
  serialId: string | null;
  serialCode: string | null;
  fromStatus: Extract<StockStatus, 'QUARANTINED' | 'REJECTED'>;
  remainingQty: number;
  vendorId: string | null;
  vendorName: string | null;
  grnId: string | null;
  grnReference: string | null;
}

export const ASSET_CONDITIONS = ['new', 'good', 'fair', 'poor', 'damaged'] as const;
export type AssetCondition = (typeof ASSET_CONDITIONS)[number];
export const ASSET_STATUSES = ['IN_STORE', 'IN_SERVICE', 'DISPOSAL_PENDING', 'DISPOSED'] as const;
export type AssetStatus = (typeof ASSET_STATUSES)[number];

export interface FixedAssetView {
  id: string;
  referenceNumber: string;
  entityId: string;
  entityCode: string | null;
  itemId: string;
  itemCode: string;
  itemName: string;
  serialCode: string | null;
  grnReference: string | null;
  procurementReference: string | null;
  procurementId: string | null;
  warehouseName: string | null;
  locationLabel: string | null;
  departmentLabel: string | null;
  custodianName: string | null;
  condition: AssetCondition;
  status: AssetStatus;
  costKobo: number;
  acquiredOn: string | null;
  photoDocumentId: string | null;
  /** Authenticated API path that streams the photo, or null when none was uploaded. */
  photoUrl: string | null;
  rowVersion: number;
  history: Array<{
    kind: string;
    departmentLabel: string | null;
    locationLabel: string | null;
    custodianName: string | null;
    condition: string | null;
    reason: string | null;
    createdBy: string;
    createdAt: string;
  }>;
}

/** Result of a scan or typed code lookup (asset ID, serial, item code or batch). */
export interface ScanLookupView {
  query: string;
  asset: FixedAssetView | null;
  items: Array<{
    id: string;
    entityCode: string | null;
    code: string;
    name: string;
    availableQty: number;
    quarantinedQty: number;
    uomCode: string;
    batchCode: string | null;
  }>;
}

export interface ProductionFormulaView {
  id: string;
  entityId: string;
  code: string;
  name: string;
  version: number;
  finishedItemId: string;
  finishedItemCode: string;
  finishedItemName: string;
  baseOutputQty: number;
  toleranceBps: number | null;
  status: 'ACTIVE' | 'RETIRED';
  lines: Array<{ itemId: string; itemCode: string; itemName: string; lineKind: 'INPUT' | 'BY_PRODUCT'; quantity: number }>;
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
  kind:
    | 'low_stock'
    | 'out_of_stock'
    | 'overdue_expected'
    | 'pending_adjustment'
    | 'in_transit'
    | 'pending_qc'
    | 'expired'
    | 'near_expiry';
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
  /** Approved incoming procurement lines not yet fully received (forecast only). */
  expectedLines: number;
  quarantinedLines: number;
  lowStockCount: number;
  outOfStockCount: number;
  reservedSalesLines: number;
  inTransitCount: number;
  inTransitValueKobo: number;
  pendingAdjustments: number;
  openProductionOrders: number;
  damagedOrExpiredPending: number;
  expiredBatchCount: number;
  nearExpiryBatchCount: number;
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
  'CLOSED',
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
  formulaId: string | null;
  varianceBps: number | null;
  closeNote: string | null;
  closedAt: string | null;
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
