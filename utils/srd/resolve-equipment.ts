import type { InventoryItem, Equipment } from '../database/data-structures';
import type { SrdItem } from './types';
import { fetchItems, fetchClassByKey } from '../api/srd';
import { parseEquipmentOptions } from '../../components/character-wizard/steps/step-equipment-spells';
import { parseCostGP } from '../../components/character-wizard/steps/equipment-shop';

function generateItemId(): string {
  return `item_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
}

/** Map SRD category_key to InventoryItem type. */
function categoryToType(categoryKey: string | null): InventoryItem['type'] {
  switch (categoryKey) {
    case 'weapon':
      return 'weapon';
    case 'armor':
      return 'armor';
    case 'tools':
      return 'tool';
    default:
      return 'other';
  }
}

/** Convert an SrdItem into an InventoryItem. */
function srdItemToInventory(item: SrdItem, quantity: number): InventoryItem {
  const costGP = parseCostGP(item.cost);
  return {
    id: generateItemId(),
    name: item.name,
    description: item.desc_text ?? '',
    quantity,
    type: categoryToType(item.category_key),
    weight: item.weight ?? 0,
    ...(costGP > 0 ? { value: { amount: costGP, currency: 'gp' } } : {}),
  };
}

/** Auto-equip items into weapon/armor/shield slots. */
function autoEquip(items: InventoryItem[]): Equipment {
  const equipment: Equipment = { weapons: {}, accessories: {} };

  for (const item of items) {
    if (item.type === 'weapon') {
      if (!equipment.weapons.mainHand) {
        equipment.weapons.mainHand = item;
      } else if (!equipment.weapons.offHand) {
        equipment.weapons.offHand = item;
      }
    } else if (item.type === 'armor') {
      const isShield =
        item.name.toLowerCase().includes('shield') ||
        (item.properties?.some((p) => p.toLowerCase() === 'shield') ?? false);
      if (isShield) {
        if (!equipment.shield) equipment.shield = item;
      } else {
        if (!equipment.armor) equipment.armor = item;
      }
    }
  }

  return equipment;
}

/**
 * Parse pack item text like "2 Daggers, Leather Armor, Longbow" into
 * individual entries with name and quantity.
 */
function parsePackItemText(text: string): { name: string; qty: number }[] {
  // Split by comma, " and ", or semicolon
  const parts = text.split(/,|(?:\band\b)/).map((s) => s.trim()).filter(Boolean);
  return parts.map((part) => {
    // Match optional leading number: "2 Daggers", "10 Darts"
    const m = part.match(/^(\d+)\s+(.+)$/);
    if (m) {
      return { name: m[2].trim(), qty: parseInt(m[1], 10) };
    }
    return { name: part, qty: 1 };
  });
}

/** Singularise simple English plurals for fuzzy matching. */
function singularise(s: string): string {
  if (s.endsWith('ies')) return s.slice(0, -3) + 'y';
  if (s.endsWith('ves')) return s.slice(0, -3) + 'f';
  if (s.endsWith('ses') || s.endsWith('xes') || s.endsWith('zes'))
    return s.slice(0, -2);
  if (s.endsWith('s') && !s.endsWith('ss')) return s.slice(0, -1);
  return s;
}

/** Case-insensitive match of a parsed name against an SRD item. */
function findSrdItem(name: string, allItems: SrdItem[]): SrdItem | undefined {
  const lower = name.toLowerCase();
  // Try exact match first
  const exact = allItems.find((i) => i.name.toLowerCase() === lower);
  if (exact) return exact;

  // Try singularised match (e.g. "Daggers" → "Dagger")
  const singular = singularise(lower);
  return allItems.find((i) => i.name.toLowerCase() === singular);
}

/**
 * Convert wizard chosenEquipment into InventoryItem[] and Equipment.
 *
 * @param chosenEquipment - The wizard's `state.chosenEquipment` array.
 *   Gold path: `['gold-B', 'itemkey:1', ...]`
 *   Pack path: `['pack-A']`
 * @param classKey - The chosen class key, needed for pack resolution
 */
export async function resolveEquipmentToInventory(
  chosenEquipment: string[],
  classKey: string | null,
): Promise<{ inventory: InventoryItem[]; equipment: Equipment }> {
  if (chosenEquipment.length === 0) {
    return { inventory: [], equipment: { weapons: {}, accessories: {} } };
  }

  const tag = chosenEquipment[0];

  // Gold path: user purchased items via the shop
  if (tag.startsWith('gold-')) {
    const cartEntries = chosenEquipment
      .filter((e) => e.includes(':'))
      .map((e) => {
        const [key, qtyStr] = e.split(':');
        return { key, qty: parseInt(qtyStr, 10) || 1 };
      });

    if (cartEntries.length === 0) {
      return { inventory: [], equipment: { weapons: {}, accessories: {} } };
    }

    const allItems = await fetchItems();
    const inventory: InventoryItem[] = [];

    for (const entry of cartEntries) {
      const srdItem = allItems.find((i) => i.key === entry.key);
      if (srdItem) {
        inventory.push(srdItemToInventory(srdItem, entry.qty));
      }
    }

    return { inventory, equipment: autoEquip(inventory) };
  }

  // Pack path: user chose an equipment pack option
  if (tag.startsWith('pack-') && classKey) {
    const optionLabel = tag.replace('pack-', '');
    const classData = await fetchClassByKey(classKey);
    if (!classData) {
      return { inventory: [], equipment: { weapons: {}, accessories: {} } };
    }

    // Find the feature with equipment options (usually "Core * Traits", but
    // some srd-2024 classes store it under a different feature name)
    const coreTraits = classData.features.find(
      (f) => f.name.startsWith('Core ') && f.name.endsWith(' Traits'),
    ) ?? classData.features.find((f) => f.desc.includes('Starting Equipment'));
    if (!coreTraits) {
      return { inventory: [], equipment: { weapons: {}, accessories: {} } };
    }

    const options = parseEquipmentOptions(coreTraits.desc);
    if (!options) {
      return { inventory: [], equipment: { weapons: {}, accessories: {} } };
    }

    const selected = options.find((o) => o.label === optionLabel);
    if (!selected) {
      return { inventory: [], equipment: { weapons: {}, accessories: {} } };
    }

    const parsed = parsePackItemText(selected.items);
    const allItems = await fetchItems();
    const inventory: InventoryItem[] = [];

    for (const entry of parsed) {
      const srdItem = findSrdItem(entry.name, allItems);
      if (srdItem) {
        inventory.push(srdItemToInventory(srdItem, entry.qty));
      } else {
        // Unmatched text becomes a generic "other" item
        inventory.push({
          id: generateItemId(),
          name: entry.name,
          description: '',
          quantity: entry.qty,
          type: 'other',
          weight: 0,
        });
      }
    }

    return { inventory, equipment: autoEquip(inventory) };
  }

  return { inventory: [], equipment: { weapons: {}, accessories: {} } };
}
