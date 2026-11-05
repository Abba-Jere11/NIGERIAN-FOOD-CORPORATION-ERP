import { z } from 'zod';

export const entityQuery = z.object({
  entityId: z.string().uuid().optional(),
});

export const upsertCategorySchema = z.object({
  entityId: z.string().uuid(),
  key: z.string().trim().min(1).max(40),
  name: z.string().trim().min(1).max(120),
  status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
  rowVersion: z.number().int().positive().optional(),
});
export type UpsertCategoryInput = z.infer<typeof upsertCategorySchema>;

export const createWarehouseSchema = z.object({
  entityId: z.string().uuid(),
  code: z.string().trim().min(1).max(20),
  name: z.string().trim().min(1).max(120),
  kind: z.enum(['store', 'cold_room', 'yard', 'plant']).default('store'),
});
export type CreateWarehouseInput = z.infer<typeof createWarehouseSchema>;

export const createItemSchema = z.object({
  entityId: z.string().uuid(),
  code: z.string().trim().min(1).max(40),
  name: z.string().trim().min(1).max(200),
  categoryId: z.string().uuid(),
  uomId: z.string().uuid(),
  defaultWarehouseId: z.string().uuid().optional(),
  reorderLevel: z.coerce.number().nonnegative().default(0),
  trackingMode: z.enum(['none', 'batch_lot', 'serial']).default('none'),
  asset: z.boolean().optional(),
  vendorIds: z.array(z.string().uuid()).optional(),
});
export type CreateItemInput = z.infer<typeof createItemSchema>;

export const updateItemSchema = createItemSchema
  .omit({ entityId: true, code: true })
  .extend({
    rowVersion: z.number().int().positive(),
    status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
  });
export type UpdateItemInput = z.infer<typeof updateItemSchema>;

export const issueSchema = z.object({
  entityId: z.string().uuid(),
  warehouseId: z.string().uuid(),
  destinationType: z.enum(['department', 'production', 'project']),
  destinationId: z.string().uuid().optional(),
  destinationLabel: z.string().trim().max(200).optional(),
  reason: z.string().trim().min(1).max(2000),
  occurredOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  idempotencyKey: z.string().trim().min(8).max(80),
  lines: z
    .array(
      z.object({
        itemId: z.string().uuid(),
        quantity: z.coerce.number().positive(),
        batchCode: z.string().trim().max(80).optional(),
        serialCode: z.string().trim().max(80).optional(),
      }),
    )
    .min(1),
});
export type IssueInput = z.infer<typeof issueSchema>;

export const transferSchema = z.object({
  sourceEntityId: z.string().uuid(),
  destinationEntityId: z.string().uuid(),
  sourceWarehouseId: z.string().uuid(),
  destWarehouseId: z.string().uuid().optional(),
  reason: z.string().trim().min(1).max(2000),
  occurredOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  idempotencyKey: z.string().trim().min(8).max(80),
  lines: z
    .array(
      z.object({
        itemId: z.string().uuid(),
        quantity: z.coerce.number().positive(),
        batchCode: z.string().trim().max(80).optional(),
        serialCode: z.string().trim().max(80).optional(),
      }),
    )
    .min(1),
});
export type TransferInput = z.infer<typeof transferSchema>;

export const receiveTransferSchema = z.object({
  destWarehouseId: z.string().uuid(),
});
export type ReceiveTransferInput = z.infer<typeof receiveTransferSchema>;

export const adjustmentSchema = z.object({
  entityId: z.string().uuid(),
  warehouseId: z.string().uuid(),
  kind: z.enum(['increase', 'decrease', 'damaged', 'expired', 'count_variance']),
  reason: z.string().trim().min(1).max(2000),
  evidenceDocumentId: z.string().uuid().optional(),
  occurredOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  lines: z
    .array(
      z.object({
        itemId: z.string().uuid(),
        quantity: z.coerce.number(),
        batchCode: z.string().trim().max(80).optional(),
        serialCode: z.string().trim().max(80).optional(),
      }),
    )
    .min(1),
});
export type AdjustmentInput = z.infer<typeof adjustmentSchema>;

export const createCountSchema = z.object({
  entityId: z.string().uuid(),
  warehouseId: z.string().uuid(),
  mode: z.enum(['blind', 'guided']),
  countedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});
export type CreateCountInput = z.infer<typeof createCountSchema>;

export const countLineSchema = z.object({
  countedQty: z.coerce.number().nonnegative(),
});
export type CountLineInput = z.infer<typeof countLineSchema>;

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const createProductionSchema = z.object({
  entityId: z.string().uuid(),
  warehouseId: z.string().uuid(),
  finishedItemId: z.string().uuid(),
  plannedOutputQty: z.coerce.number().positive(),
  inputs: z
    .array(
      z.object({
        itemId: z.string().uuid(),
        warehouseId: z.string().uuid().optional(),
        plannedQty: z.coerce.number().positive(),
        batchCode: z.string().trim().max(80).optional(),
      }),
    )
    .min(1),
});
export type CreateProductionInput = z.infer<typeof createProductionSchema>;

export const startProductionSchema = z.object({
  rowVersion: z.number().int().positive(),
  occurredOn: isoDate.optional(),
  inputs: z
    .array(
      z.object({
        id: z.string().uuid().optional(),
        itemId: z.string().uuid().optional(),
        actualQty: z.coerce.number().positive(),
        batchCode: z.string().trim().max(80).optional(),
      }),
    )
    .optional(),
});
export type StartProductionInput = z.infer<typeof startProductionSchema>;

export const completeProductionSchema = z.object({
  rowVersion: z.number().int().positive(),
  actualOutputQty: z.coerce.number().positive(),
  wasteQty: z.coerce.number().nonnegative().default(0),
  wasteReason: z.string().trim().max(2000).optional(),
  finishedBatchCode: z.string().trim().min(1).max(80),
  producedOn: isoDate,
});
export type CompleteProductionInput = z.infer<typeof completeProductionSchema>;

export const cancelProductionSchema = z.object({
  rowVersion: z.number().int().positive(),
  reason: z.string().trim().min(1).max(2000),
});
export type CancelProductionInput = z.infer<typeof cancelProductionSchema>;

export const createSalesSchema = z.object({
  entityId: z.string().uuid(),
  customerId: z.string().uuid(),
  terms: z.string().trim().max(200).optional(),
  dueOn: isoDate.optional(),
  occurredOn: isoDate,
  lines: z
    .array(
      z.object({
        itemId: z.string().uuid(),
        warehouseId: z.string().uuid(),
        quantity: z.coerce.number().positive(),
        unitPriceKobo: z.coerce.number().int().nonnegative(),
      }),
    )
    .min(1),
});
export type CreateSalesInput = z.infer<typeof createSalesSchema>;

export const submitSalesSchema = z.object({
  rowVersion: z.number().int().positive(),
});
export type SubmitSalesInput = z.infer<typeof submitSalesSchema>;

export const cancelSalesSchema = z.object({
  rowVersion: z.number().int().positive(),
  reason: z.string().trim().min(1).max(2000),
});
export type CancelSalesInput = z.infer<typeof cancelSalesSchema>;

export const dispatchSalesSchema = z.object({
  vehicle: z.string().trim().max(120).optional(),
  driver: z.string().trim().max(120).optional(),
  destination: z.string().trim().min(1).max(200),
  occurredOn: isoDate,
  documentId: z.string().uuid().optional(),
  lines: z
    .array(
      z.object({
        orderLineId: z.string().uuid(),
        quantity: z.coerce.number().positive(),
        batchCode: z.string().trim().max(80).optional(),
      }),
    )
    .min(1),
});
export type DispatchSalesInput = z.infer<typeof dispatchSalesSchema>;

export const invoiceSalesSchema = z.object({
  occurredOn: isoDate.optional(),
  dueOn: isoDate.optional(),
});
export type InvoiceSalesInput = z.infer<typeof invoiceSalesSchema>;

export const returnSalesSchema = z.object({
  dispatchId: z.string().uuid().optional(),
  reason: z.string().trim().min(1).max(2000),
  occurredOn: isoDate,
});
export type ReturnSalesInput = z.infer<typeof returnSalesSchema>;
