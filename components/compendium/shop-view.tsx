import { useState, useEffect, useCallback } from "react";
import { Button } from "../ui/button";
import { Badge } from "../ui/badge";
import { toast } from "sonner";
import {
  Loader2,
  Store,
  ChevronLeft,
  ShoppingCart,
} from "lucide-react";
import { fetchJson, buildJsonRequestInit } from "../../utils/api-client";
import { useGameSession } from "../../contexts/GameSessionContext";

interface ShopSummary {
  id: string;
  name: string;
  description: string | null;
  shop_type: string;
  price_modifier: number;
  location_text: string | null;
  npc_name: string | null;
  is_active: boolean;
}

interface ShopInventoryItem {
  id: string;
  item_key: string;
  item_name: string;
  category_key: string | null;
  rarity_key: string | null;
  srd_cost: string | null;
  weight: number | null;
  stock_quantity: number | null;
  price_override: number | null;
  effective_price: number;
  desc_text: string | null;
}

interface ShopDetail extends ShopSummary {
  inventory: ShopInventoryItem[];
}

interface ShopViewProps {
  characterId?: string;
}

export function ShopView({ characterId }: ShopViewProps) {
  const { activeCampaignId } = useGameSession();
  const [shops, setShops] = useState<ShopSummary[]>([]);
  const [activeShop, setActiveShop] = useState<ShopDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [purchasing, setPurchasing] = useState<string | null>(null);

  const loadShops = useCallback(async (signal?: AbortSignal) => {
    if (!activeCampaignId) return;
    setLoading(true);
    try {
      const data = await fetchJson<{ shops: ShopSummary[] }>(
        `/api/campaigns/${activeCampaignId}/shops`,
        { method: "GET", signal },
        "Failed to load shops",
      );
      setShops(data?.shops ?? []);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      console.error("Failed to load shops:", err);
    } finally {
      setLoading(false);
    }
  }, [activeCampaignId]);

  useEffect(() => {
    const controller = new AbortController();
    loadShops(controller.signal);
    return () => controller.abort();
  }, [loadShops]);

  const openShop = async (shopId: string) => {
    if (!activeCampaignId) return;
    setLoading(true);
    try {
      const data = await fetchJson<ShopDetail>(
        `/api/campaigns/${activeCampaignId}/shops/${shopId}`,
        { method: "GET" },
        "Failed to load shop",
      );
      setActiveShop(data ?? null);
    } catch (err) {
      console.error("Failed to load shop:", err);
      toast.error("Failed to load shop");
    } finally {
      setLoading(false);
    }
  };

  const buyItem = async (itemKey: string) => {
    if (!activeCampaignId || !activeShop || !characterId) {
      toast.error("No character selected for purchase");
      return;
    }
    setPurchasing(itemKey);
    try {
      const result = await fetchJson<{ itemName: string; totalCost: number; newGold: number }>(
        `/api/campaigns/${activeCampaignId}/shops/${activeShop.id}/purchase`,
        buildJsonRequestInit("POST", { characterId, itemKey, quantity: 1 }),
        "Purchase failed",
      );
      if (result) {
        toast.success(`Purchased ${result.itemName} for ${result.totalCost} GP`);
        // Refresh shop inventory
        openShop(activeShop.id);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Purchase failed";
      toast.error(msg);
    } finally {
      setPurchasing(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="w-6 h-6 animate-spin" />
      </div>
    );
  }

  // Shop detail view
  if (activeShop) {
    return (
      <div className="space-y-3">
        <Button variant="ghost" size="sm" onClick={() => setActiveShop(null)}>
          <ChevronLeft className="w-4 h-4 mr-1" /> Back to Shops
        </Button>

        <div>
          <h3 className="font-semibold text-lg">{activeShop.name}</h3>
          {activeShop.description && (
            <p className="text-sm text-muted-foreground italic">{activeShop.description}</p>
          )}
          <div className="flex gap-2 mt-1 text-xs text-muted-foreground">
            {activeShop.location_text && <span>{activeShop.location_text}</span>}
            {activeShop.price_modifier !== 1 && (
              <Badge variant="outline" className="text-xs">
                Price: x{activeShop.price_modifier}
              </Badge>
            )}
          </div>
        </div>

        {activeShop.inventory.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">This shop has no items for sale.</p>
        ) : (
          <div className="space-y-1">
            {activeShop.inventory.map((item) => (
              <div key={item.id} className="flex items-center justify-between border rounded px-3 py-2">
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-sm truncate">{item.item_name}</div>
                  <div className="text-xs text-muted-foreground">
                    {item.category_key?.replace(/-/g, " ")}
                    {item.stock_quantity != null && ` · ${item.stock_quantity} in stock`}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0 ml-2">
                  <span className="text-sm font-medium">{item.effective_price} GP</span>
                  {characterId && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={purchasing === item.item_key}
                      onClick={() => buyItem(item.item_key)}
                    >
                      {purchasing === item.item_key ? (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      ) : (
                        <ShoppingCart className="w-3 h-3" />
                      )}
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  // Shop list view
  if (shops.length === 0) {
    return (
      <p className="text-sm text-muted-foreground text-center py-4">
        No shops available in this campaign.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {shops.map((shop) => (
        <div key={shop.id} className="border rounded p-3 space-y-1">
          <div className="flex items-center gap-2">
            <Store className="w-4 h-4 shrink-0" />
            <span className="font-medium">{shop.name}</span>
            <Badge variant="secondary" className="text-xs">{shop.shop_type}</Badge>
          </div>
          {shop.description && (
            <p className="text-sm text-muted-foreground italic">{shop.description}</p>
          )}
          {shop.location_text && (
            <p className="text-xs text-muted-foreground">{shop.location_text}</p>
          )}
          <Button size="sm" variant="outline" onClick={() => openShop(shop.id)}>
            Browse Shop
          </Button>
        </div>
      ))}
    </div>
  );
}
