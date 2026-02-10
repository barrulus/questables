import { useState, useEffect, useMemo } from 'react';
import { fetchItems } from '../../../utils/api/srd';
import type { SrdItem } from '../../../utils/srd/types';
import { ScrollArea } from '../../ui/scroll-area';
import { Button } from '../../ui/button';
import { Badge } from '../../ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../ui/select';
import { Info, Minus, Plus, ShoppingCart, X } from 'lucide-react';

/** Categories available for purchase during character creation. */
const SHOP_CATEGORIES = [
  { key: 'weapon', label: 'Weapons' },
  { key: 'armor', label: 'Armor' },
  { key: 'adventuring-gear', label: 'Adventuring Gear' },
  { key: 'tools', label: 'Tools' },
  { key: 'ammunition', label: 'Ammunition' },
  { key: 'equipment-pack', label: 'Equipment Packs' },
  { key: 'spellcasting-focus', label: 'Spellcasting Focuses' },
] as const;

export function parseCostGP(cost: string | null): number {
  if (!cost) return 0;
  const n = parseFloat(cost);
  return isNaN(n) ? 0 : n;
}

function formatGP(gp: number): string {
  if (gp >= 1) return `${Math.round(gp * 100) / 100} GP`;
  if (gp >= 0.1) return `${Math.round(gp * 10)} SP`;
  return `${Math.round(gp * 100)} CP`;
}

export interface CartEntry {
  key: string;
  name: string;
  cost: number;
  qty: number;
}

interface EquipmentShopProps {
  budget: number;
  cartEntries: CartEntry[];
  onAdd: (item: SrdItem) => void;
  onRemove: (key: string) => void;
  onClear: (key: string) => void;
  totalSpent: number;
  onInfoClick?: (item: SrdItem) => void;
}

export function EquipmentShop({
  budget,
  cartEntries,
  onAdd,
  onRemove,
  onClear,
  totalSpent,
  onInfoClick,
}: EquipmentShopProps) {
  const [items, setItems] = useState<SrdItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [category, setCategory] = useState<string>(SHOP_CATEGORIES[0].key);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    fetchItems({ category }, { signal: controller.signal })
      .then((data) => {
        if (!controller.signal.aborted) setItems(data);
      })
      .catch((err) => {
        if (!(err instanceof Error && err.name === 'AbortError')) console.error(err);
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [category]);

  // Only show items with a real cost > 0
  const purchasableItems = useMemo(
    () => items.filter((i) => parseCostGP(i.cost) > 0).sort((a, b) => a.name.localeCompare(b.name)),
    [items],
  );

  const remaining = Math.round((budget - totalSpent) * 100) / 100;

  const cartByKey = useMemo(() => {
    const map: Record<string, number> = {};
    for (const e of cartEntries) map[e.key] = e.qty;
    return map;
  }, [cartEntries]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Select value={category} onValueChange={setCategory}>
          <SelectTrigger className="w-52">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SHOP_CATEGORIES.map((c) => (
              <SelectItem key={c.key} value={c.key}>{c.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Badge variant={remaining >= 0 ? 'secondary' : 'destructive'} className="text-sm px-3 py-1">
          {formatGP(remaining)} remaining
        </Badge>
      </div>

      {loading ? (
        <div className="flex items-center justify-center p-8">
          <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary" />
        </div>
      ) : (
        <ScrollArea className="h-72">
          <div className="space-y-1 pr-4">
            {purchasableItems.map((item) => {
              const cost = parseCostGP(item.cost);
              const qty = cartByKey[item.key] ?? 0;
              const canAfford = cost <= remaining;

              return (
                <div
                  key={item.key}
                  className="flex items-center justify-between py-1.5 px-2 rounded hover:bg-muted text-sm"
                >
                  <div className="flex-1 min-w-0">
                    <span className="font-medium">{item.name}</span>
                    <span className="text-muted-foreground ml-2">{formatGP(cost)}</span>
                    {item.weight != null && item.weight > 0 && (
                      <span className="text-muted-foreground ml-2 text-xs">{item.weight} lb.</span>
                    )}
                  </div>
                  <div className="flex items-center gap-1 ml-2">
                    {onInfoClick && (
                      <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => onInfoClick(item)}>
                        <Info className="h-3 w-3" />
                      </Button>
                    )}
                    {qty > 0 && (
                      <>
                        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => onRemove(item.key)}>
                          <Minus className="h-3 w-3" />
                        </Button>
                        <span className="w-5 text-center text-sm font-medium">{qty}</span>
                      </>
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6"
                      onClick={() => onAdd(item)}
                      disabled={!canAfford}
                    >
                      <Plus className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
              );
            })}
            {purchasableItems.length === 0 && (
              <p className="text-sm text-muted-foreground italic p-4 text-center">
                No items available in this category.
              </p>
            )}
          </div>
        </ScrollArea>
      )}

      {cartEntries.length > 0 && (
        <div className="border-t pt-3">
          <h5 className="font-semibold text-sm mb-2 flex items-center gap-2">
            <ShoppingCart className="h-4 w-4" />
            Your Cart ({cartEntries.reduce((s, e) => s + e.qty, 0)} items)
          </h5>
          <div className="space-y-1">
            {cartEntries.map((entry) => (
              <div key={entry.key} className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-1 flex-1 min-w-0">
                  <Button variant="ghost" size="icon" className="h-5 w-5 shrink-0" onClick={() => onClear(entry.key)}>
                    <X className="h-3 w-3" />
                  </Button>
                  <span className="truncate">
                    {entry.name} {entry.qty > 1 && <span className="text-muted-foreground">x{entry.qty}</span>}
                  </span>
                </div>
                <span className="text-muted-foreground ml-2">{formatGP(entry.cost * entry.qty)}</span>
              </div>
            ))}
            <div className="flex items-center justify-between text-sm font-semibold border-t pt-1 mt-1">
              <span>Total</span>
              <span>{formatGP(totalSpent)}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
