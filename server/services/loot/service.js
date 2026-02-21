/**
 * Loot table service — CRUD and roll mechanics.
 */

/**
 * Create a new loot table for a campaign.
 */
export async function createLootTable(client, { campaignId, name, description, tableType, crMin, crMax }) {
  const { rows } = await client.query(
    `INSERT INTO public.loot_tables (campaign_id, name, description, table_type, cr_min, cr_max)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [campaignId, name, description ?? null, tableType ?? 'custom', crMin ?? null, crMax ?? null],
  );
  return rows[0];
}

/**
 * List loot tables for a campaign.
 */
export async function listLootTables(client, { campaignId }) {
  const { rows } = await client.query(
    `SELECT lt.*, COUNT(lte.id)::int AS entry_count
       FROM public.loot_tables lt
       LEFT JOIN public.loot_table_entries lte ON lte.loot_table_id = lt.id
      WHERE lt.campaign_id = $1
      GROUP BY lt.id
      ORDER BY lt.name ASC`,
    [campaignId],
  );
  return rows;
}

/**
 * Get a loot table with its entries (enriched with SRD item data).
 */
export async function getLootTableWithEntries(client, { tableId }) {
  const { rows: tableRows } = await client.query(
    'SELECT * FROM public.loot_tables WHERE id = $1',
    [tableId],
  );
  if (tableRows.length === 0) return null;

  const table = tableRows[0];

  const { rows: entries } = await client.query(
    `SELECT lte.*, i.name AS item_name, i.category_key, i.rarity_key, i.cost AS srd_cost
       FROM public.loot_table_entries lte
       LEFT JOIN public.srd_items i ON i.key = lte.item_key AND i.document_source = lte.document_source
      WHERE lte.loot_table_id = $1
      ORDER BY lte.weight DESC, i.name ASC`,
    [tableId],
  );

  return { ...table, entries };
}

/**
 * Update a loot table's metadata.
 */
export async function updateLootTable(client, { tableId, updates }) {
  const allowed = ['name', 'description', 'table_type', 'cr_min', 'cr_max'];
  const setClauses = [];
  const values = [];
  let idx = 1;

  for (const key of allowed) {
    if (updates[key] !== undefined) {
      setClauses.push(`${key} = $${idx++}`);
      values.push(updates[key]);
    }
  }

  if (setClauses.length === 0) return null;

  setClauses.push('updated_at = NOW()');
  values.push(tableId);

  const { rows } = await client.query(
    `UPDATE public.loot_tables SET ${setClauses.join(', ')} WHERE id = $${idx} RETURNING *`,
    values,
  );
  return rows[0] ?? null;
}

/**
 * Delete a loot table.
 */
export async function deleteLootTable(client, { tableId }) {
  await client.query('DELETE FROM public.loot_tables WHERE id = $1', [tableId]);
}

/**
 * Add an entry to a loot table.
 */
export async function addLootTableEntry(client, { tableId, itemKey, documentSource, weight, quantityMin, quantityMax, currencyAmount }) {
  const { rows } = await client.query(
    `INSERT INTO public.loot_table_entries (loot_table_id, item_key, document_source, weight, quantity_min, quantity_max, currency_amount)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [tableId, itemKey ?? null, documentSource ?? 'srd-2024', weight ?? 1, quantityMin ?? 1, quantityMax ?? 1, currencyAmount ?? null],
  );
  return rows[0];
}

/**
 * Update a loot table entry.
 */
export async function updateLootTableEntry(client, { entryId, weight, quantityMin, quantityMax, currencyAmount }) {
  const setClauses = [];
  const values = [];
  let idx = 1;

  if (weight !== undefined) { setClauses.push(`weight = $${idx++}`); values.push(weight); }
  if (quantityMin !== undefined) { setClauses.push(`quantity_min = $${idx++}`); values.push(quantityMin); }
  if (quantityMax !== undefined) { setClauses.push(`quantity_max = $${idx++}`); values.push(quantityMax); }
  if (currencyAmount !== undefined) { setClauses.push(`currency_amount = $${idx++}`); values.push(currencyAmount); }

  if (setClauses.length === 0) return null;

  values.push(entryId);
  const { rows } = await client.query(
    `UPDATE public.loot_table_entries SET ${setClauses.join(', ')} WHERE id = $${idx} RETURNING *`,
    values,
  );
  return rows[0] ?? null;
}

/**
 * Remove a loot table entry.
 */
export async function removeLootTableEntry(client, { entryId }) {
  await client.query('DELETE FROM public.loot_table_entries WHERE id = $1', [entryId]);
}

/**
 * Roll on a loot table. Returns an array of rolled results.
 * Uses weighted random selection with optional count parameter.
 */
export async function rollOnLootTable(client, { tableId, count }) {
  count = count ?? 1;

  const { rows: entries } = await client.query(
    `SELECT lte.*, i.name AS item_name, i.cost AS srd_cost
       FROM public.loot_table_entries lte
       LEFT JOIN public.srd_items i ON i.key = lte.item_key AND i.document_source = lte.document_source
      WHERE lte.loot_table_id = $1`,
    [tableId],
  );

  if (entries.length === 0) return [];

  const totalWeight = entries.reduce((sum, e) => sum + e.weight, 0);
  const results = [];

  for (let i = 0; i < count; i++) {
    let roll = Math.random() * totalWeight;
    let selected = entries[0];

    for (const entry of entries) {
      roll -= entry.weight;
      if (roll <= 0) {
        selected = entry;
        break;
      }
    }

    // Roll quantity
    const qty = selected.quantity_min === selected.quantity_max
      ? selected.quantity_min
      : selected.quantity_min + Math.floor(Math.random() * (selected.quantity_max - selected.quantity_min + 1));

    results.push({
      entryId: selected.id,
      itemKey: selected.item_key,
      itemName: selected.item_name ?? selected.item_key,
      quantity: qty,
      currencyAmount: selected.currency_amount,
    });
  }

  return results;
}
