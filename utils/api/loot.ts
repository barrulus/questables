import { fetchJson, buildJsonRequestInit } from '../api-client';

export interface LootTableSummary {
  id: string;
  campaign_id: string;
  name: string;
  description: string | null;
  table_type: string;
  cr_min: number | null;
  cr_max: number | null;
  entry_count: number;
}

export interface LootTableEntry {
  id: string;
  loot_table_id: string;
  item_key: string | null;
  document_source: string;
  weight: number;
  quantity_min: number;
  quantity_max: number;
  currency_amount: string | null;
  item_name: string | null;
  category_key: string | null;
  rarity_key: string | null;
  srd_cost: string | null;
}

export interface LootTableDetail extends LootTableSummary {
  entries: LootTableEntry[];
}

export interface RollResult {
  entryId: string;
  itemKey: string | null;
  itemName: string;
  quantity: number;
  currencyAmount: string | null;
}

export async function fetchLootTables(campaignId: string): Promise<LootTableSummary[]> {
  const data = await fetchJson<{ tables: LootTableSummary[] }>(
    `/api/campaigns/${campaignId}/loot-tables`,
    { method: 'GET' },
    'Failed to load loot tables',
  );
  return data?.tables ?? [];
}

export async function fetchLootTable(campaignId: string, tableId: string): Promise<LootTableDetail | null> {
  const data = await fetchJson<LootTableDetail>(
    `/api/campaigns/${campaignId}/loot-tables/${tableId}`,
    { method: 'GET' },
    'Failed to load loot table',
  );
  return data ?? null;
}

export async function createLootTable(
  campaignId: string,
  body: { name: string; tableType?: string; description?: string; crMin?: number; crMax?: number },
): Promise<LootTableSummary> {
  const data = await fetchJson<LootTableSummary>(
    `/api/campaigns/${campaignId}/loot-tables`,
    buildJsonRequestInit('POST', body),
    'Failed to create loot table',
  );
  return data!;
}

export async function deleteLootTable(campaignId: string, tableId: string): Promise<void> {
  await fetchJson(
    `/api/campaigns/${campaignId}/loot-tables/${tableId}`,
    { method: 'DELETE' },
    'Failed to delete loot table',
  );
}

export async function addLootTableEntry(
  campaignId: string,
  tableId: string,
  body: { itemKey?: string; weight?: number; quantityMin?: number; quantityMax?: number; currencyAmount?: string },
): Promise<LootTableEntry> {
  const data = await fetchJson<LootTableEntry>(
    `/api/campaigns/${campaignId}/loot-tables/${tableId}/entries`,
    buildJsonRequestInit('POST', body),
    'Failed to add entry',
  );
  return data!;
}

export async function removeLootTableEntry(
  campaignId: string,
  tableId: string,
  entryId: string,
): Promise<void> {
  await fetchJson(
    `/api/campaigns/${campaignId}/loot-tables/${tableId}/entries/${entryId}`,
    { method: 'DELETE' },
    'Failed to remove entry',
  );
}

export async function rollOnLootTable(
  campaignId: string,
  tableId: string,
  count: number = 1,
): Promise<RollResult[]> {
  const data = await fetchJson<{ results: RollResult[] }>(
    `/api/campaigns/${campaignId}/loot-tables/${tableId}/roll`,
    buildJsonRequestInit('POST', { count }),
    'Failed to roll on loot table',
  );
  return data?.results ?? [];
}
