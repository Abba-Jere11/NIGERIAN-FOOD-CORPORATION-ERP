'use server';

import type { InventoryItemListView, StockBatchListView, StockIssueView } from '@nfc/shared';
import { apiFetch } from '@/lib/api';

export async function fetchWarehouseItems(entityId: string, warehouseId: string): Promise<InventoryItemListView[]> {
  if (!entityId || !warehouseId) return [];
  return apiFetch<InventoryItemListView[]>('/api/inventory/items', { query: { entityId, warehouseId } });
}

export async function fetchBatches(entityId: string): Promise<StockBatchListView[]> {
  if (!entityId) return [];
  return apiFetch<StockBatchListView[]>('/api/inventory/batches', { query: { entityId } });
}

export async function fetchIssues(entityId: string): Promise<StockIssueView[]> {
  if (!entityId) return [];
  return apiFetch<StockIssueView[]>('/api/inventory/issues', { query: { entityId } });
}
