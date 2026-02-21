/**
 * NPC Shop service — shop CRUD, inventory management, purchases.
 */

/**
 * Create a new shop for a campaign.
 */
export async function createShop(client, { campaignId, name, description, npcId, shopType, priceModifier, locationText }) {
  const { rows } = await client.query(
    `INSERT INTO public.npc_shops (campaign_id, name, description, npc_id, shop_type, price_modifier, location_text)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [campaignId, name, description ?? null, npcId ?? null, shopType ?? 'general', priceModifier ?? 1.0, locationText ?? null],
  );
  return rows[0];
}

/**
 * List shops for a campaign. If playerView=true, only active shops are returned.
 */
export async function listShops(client, { campaignId, playerView }) {
  const sql = playerView
    ? `SELECT s.*, n.name AS npc_name FROM public.npc_shops s
       LEFT JOIN public.npcs n ON n.id = s.npc_id
       WHERE s.campaign_id = $1 AND s.is_active = true
       ORDER BY s.name ASC`
    : `SELECT s.*, n.name AS npc_name FROM public.npc_shops s
       LEFT JOIN public.npcs n ON n.id = s.npc_id
       WHERE s.campaign_id = $1
       ORDER BY s.name ASC`;
  const { rows } = await client.query(sql, [campaignId]);
  return rows;
}

/**
 * Get a single shop with its inventory (enriched with SRD item data).
 */
export async function getShopWithInventory(client, { shopId }) {
  const { rows: shopRows } = await client.query(
    `SELECT s.*, n.name AS npc_name FROM public.npc_shops s
     LEFT JOIN public.npcs n ON n.id = s.npc_id
     WHERE s.id = $1`,
    [shopId],
  );
  if (shopRows.length === 0) return null;

  const shop = shopRows[0];

  const { rows: inventory } = await client.query(
    `SELECT si.*, i.name AS item_name, i.desc_text, i.category_key, i.rarity_key,
            i.cost AS srd_cost, i.weight, i.requires_attunement
       FROM public.npc_shop_inventory si
       JOIN public.srd_items i ON i.key = si.item_key AND i.document_source = si.document_source
      WHERE si.shop_id = $1 AND si.is_available = true
      ORDER BY i.name ASC`,
    [shopId],
  );

  // Compute effective price for each item
  for (const item of inventory) {
    const baseCost = item.price_override != null ? parseFloat(item.price_override) : parseFloat(item.srd_cost ?? '0');
    item.effective_price = Math.round(baseCost * parseFloat(shop.price_modifier) * 100) / 100;
  }

  return { ...shop, inventory };
}

/**
 * Update shop metadata.
 */
export async function updateShop(client, { shopId, updates }) {
  const allowed = ['name', 'description', 'npc_id', 'shop_type', 'price_modifier', 'is_active', 'location_text'];
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

  setClauses.push(`updated_at = NOW()`);
  values.push(shopId);

  const { rows } = await client.query(
    `UPDATE public.npc_shops SET ${setClauses.join(', ')} WHERE id = $${idx} RETURNING *`,
    values,
  );
  return rows[0] ?? null;
}

/**
 * Delete a shop.
 */
export async function deleteShop(client, { shopId }) {
  await client.query('DELETE FROM public.npc_shops WHERE id = $1', [shopId]);
}

/**
 * Add an item to a shop's inventory.
 */
export async function addShopItem(client, { shopId, itemKey, documentSource, stockQuantity, priceOverride, notes }) {
  const { rows } = await client.query(
    `INSERT INTO public.npc_shop_inventory (shop_id, item_key, document_source, stock_quantity, price_override, notes)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (shop_id, item_key, document_source) DO UPDATE SET
       stock_quantity = EXCLUDED.stock_quantity,
       price_override = EXCLUDED.price_override,
       notes = EXCLUDED.notes,
       is_available = true
     RETURNING *`,
    [shopId, itemKey, documentSource ?? 'srd-2024', stockQuantity ?? null, priceOverride ?? null, notes ?? null],
  );
  return rows[0];
}

/**
 * Update a shop inventory entry.
 */
export async function updateShopItem(client, { entryId, stockQuantity, priceOverride, isAvailable, notes }) {
  const setClauses = [];
  const values = [];
  let idx = 1;

  if (stockQuantity !== undefined) { setClauses.push(`stock_quantity = $${idx++}`); values.push(stockQuantity); }
  if (priceOverride !== undefined) { setClauses.push(`price_override = $${idx++}`); values.push(priceOverride); }
  if (isAvailable !== undefined) { setClauses.push(`is_available = $${idx++}`); values.push(isAvailable); }
  if (notes !== undefined) { setClauses.push(`notes = $${idx++}`); values.push(notes); }

  if (setClauses.length === 0) return null;

  values.push(entryId);
  const { rows } = await client.query(
    `UPDATE public.npc_shop_inventory SET ${setClauses.join(', ')} WHERE id = $${idx} RETURNING *`,
    values,
  );
  return rows[0] ?? null;
}

/**
 * Remove an item from a shop.
 */
export async function removeShopItem(client, { entryId }) {
  await client.query('DELETE FROM public.npc_shop_inventory WHERE id = $1', [entryId]);
}

/**
 * Process a player purchase from a shop.
 * Returns { item, quantity, totalCost, newGold } on success.
 */
export async function purchaseItem(client, { shopId, characterId, itemKey, quantity }) {
  quantity = quantity ?? 1;

  // Get shop
  const { rows: shopRows } = await client.query(
    'SELECT * FROM public.npc_shops WHERE id = $1',
    [shopId],
  );
  if (shopRows.length === 0) {
    const err = new Error('Shop not found');
    err.status = 404;
    err.code = 'shop_not_found';
    throw err;
  }
  const shop = shopRows[0];

  // Get inventory entry
  const { rows: invRows } = await client.query(
    `SELECT si.*, i.cost AS srd_cost, i.name AS item_name
       FROM public.npc_shop_inventory si
       JOIN public.srd_items i ON i.key = si.item_key AND i.document_source = si.document_source
      WHERE si.shop_id = $1 AND si.item_key = $2 AND si.is_available = true`,
    [shopId, itemKey],
  );
  if (invRows.length === 0) {
    const err = new Error('Item not available in this shop');
    err.status = 400;
    err.code = 'item_not_available';
    throw err;
  }
  const inv = invRows[0];

  // Check stock
  if (inv.stock_quantity != null && inv.stock_quantity < quantity) {
    const err = new Error('Insufficient stock');
    err.status = 400;
    err.code = 'insufficient_stock';
    throw err;
  }

  // Compute cost
  const baseCost = inv.price_override != null ? parseFloat(inv.price_override) : parseFloat(inv.srd_cost ?? '0');
  const unitCost = Math.round(baseCost * parseFloat(shop.price_modifier) * 100) / 100;
  const totalCost = Math.round(unitCost * quantity * 100) / 100;

  // Get character and check gold
  const { rows: charRows } = await client.query(
    'SELECT id, inventory, equipment FROM public.characters WHERE id = $1',
    [characterId],
  );
  if (charRows.length === 0) {
    const err = new Error('Character not found');
    err.status = 404;
    err.code = 'character_not_found';
    throw err;
  }
  const character = charRows[0];
  const inventory = Array.isArray(character.inventory) ? [...character.inventory] : [];

  // Find gold in inventory
  const goldIdx = inventory.findIndex(
    (item) => item.name?.toLowerCase() === 'gold' || item.name?.toLowerCase() === 'gold pieces',
  );
  const currentGold = goldIdx >= 0 ? (inventory[goldIdx].quantity ?? 0) : 0;

  if (currentGold < totalCost) {
    const err = new Error(`Not enough gold. Need ${totalCost} GP, have ${currentGold} GP`);
    err.status = 400;
    err.code = 'insufficient_gold';
    throw err;
  }

  // Deduct gold
  if (goldIdx >= 0) {
    inventory[goldIdx] = { ...inventory[goldIdx], quantity: currentGold - totalCost };
  }

  // Add item(s) to inventory
  const existingIdx = inventory.findIndex((item) => item.key === itemKey || item.name === inv.item_name);
  if (existingIdx >= 0) {
    inventory[existingIdx] = {
      ...inventory[existingIdx],
      quantity: (inventory[existingIdx].quantity ?? 1) + quantity,
    };
  } else {
    inventory.push({
      key: itemKey,
      name: inv.item_name,
      quantity,
    });
  }

  // Update character
  await client.query(
    'UPDATE public.characters SET inventory = $1, updated_at = NOW() WHERE id = $2',
    [JSON.stringify(inventory), characterId],
  );

  // Decrement stock
  if (inv.stock_quantity != null) {
    const newStock = inv.stock_quantity - quantity;
    if (newStock <= 0) {
      await client.query(
        'UPDATE public.npc_shop_inventory SET stock_quantity = 0, is_available = false WHERE id = $1',
        [inv.id],
      );
    } else {
      await client.query(
        'UPDATE public.npc_shop_inventory SET stock_quantity = $1 WHERE id = $2',
        [newStock, inv.id],
      );
    }
  }

  return {
    itemName: inv.item_name,
    itemKey,
    quantity,
    unitCost,
    totalCost,
    newGold: currentGold - totalCost,
  };
}
