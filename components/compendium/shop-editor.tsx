import { useState, useEffect, useCallback } from "react";
import { Input } from "../ui/input";
import { Button } from "../ui/button";
import { Label } from "../ui/label";
import { Badge } from "../ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import { toast } from "sonner";
import {
  Loader2,
  Plus,
  Trash2,
  Store,
  ChevronLeft,
  Search,
  Sparkles,
} from "lucide-react";
import { fetchJson, buildJsonRequestInit } from "../../utils/api-client";
import { fetchItemsPaginated } from "../../utils/api/srd";
import type { SrdItem } from "../../utils/srd/types";
import { useGameSession } from "../../contexts/GameSessionContext";

interface ShopSummary {
  id: string;
  name: string;
  description: string | null;
  shop_type: string;
  price_modifier: number;
  is_active: boolean;
  location_text: string | null;
  npc_name: string | null;
}

interface ShopInventoryItem {
  id: string;
  item_key: string;
  item_name: string;
  category_key: string | null;
  stock_quantity: number | null;
  effective_price: number;
}

interface ShopDetail extends ShopSummary {
  inventory: ShopInventoryItem[];
}

const SHOP_TYPES = [
  { value: "general", label: "General" },
  { value: "weapons", label: "Weapons" },
  { value: "armor", label: "Armor" },
  { value: "magic", label: "Magic" },
  { value: "potions", label: "Potions" },
  { value: "scrolls", label: "Scrolls" },
];

export function ShopEditor() {
  const { activeCampaignId } = useGameSession();
  const [shops, setShops] = useState<ShopSummary[]>([]);
  const [activeShop, setActiveShop] = useState<ShopDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  // Create form
  const [newName, setNewName] = useState("");
  const [newType, setNewType] = useState("general");
  const [newModifier, setNewModifier] = useState("1.00");
  const [newLocation, setNewLocation] = useState("");

  // Add item
  const [itemSearch, setItemSearch] = useState("");
  const [searchResults, setSearchResults] = useState<SrdItem[]>([]);
  const [searching, setSearching] = useState(false);
  const [autoStocking, setAutoStocking] = useState(false);

  const loadShops = useCallback(async () => {
    if (!activeCampaignId) return;
    setLoading(true);
    try {
      const data = await fetchJson<{ shops: ShopSummary[] }>(
        `/api/campaigns/${activeCampaignId}/shops`,
        { method: "GET" },
        "Failed to load shops",
      );
      setShops(data?.shops ?? []);
    } catch (err) {
      console.error("Failed to load shops:", err);
    } finally {
      setLoading(false);
    }
  }, [activeCampaignId]);

  useEffect(() => { loadShops(); }, [loadShops]);

  const createShop = async () => {
    if (!activeCampaignId || !newName.trim()) return;
    setCreating(true);
    try {
      await fetchJson(
        `/api/campaigns/${activeCampaignId}/shops`,
        buildJsonRequestInit("POST", {
          name: newName.trim(),
          shopType: newType,
          priceModifier: parseFloat(newModifier) || 1.0,
          locationText: newLocation.trim() || null,
        }),
        "Failed to create shop",
      );
      toast.success("Shop created");
      setNewName("");
      setNewLocation("");
      loadShops();
    } catch (err) {
      toast.error("Failed to create shop");
    } finally {
      setCreating(false);
    }
  };

  const openShopDetail = async (shopId: string) => {
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
      toast.error("Failed to load shop");
    } finally {
      setLoading(false);
    }
  };

  const deleteShop = async (shopId: string) => {
    if (!activeCampaignId) return;
    try {
      await fetchJson(
        `/api/campaigns/${activeCampaignId}/shops/${shopId}`,
        { method: "DELETE" },
        "Failed to delete shop",
      );
      toast.success("Shop deleted");
      setActiveShop(null);
      loadShops();
    } catch (err) {
      toast.error("Failed to delete shop");
    }
  };

  const toggleActive = async (shopId: string, isActive: boolean) => {
    if (!activeCampaignId) return;
    try {
      await fetchJson(
        `/api/campaigns/${activeCampaignId}/shops/${shopId}`,
        buildJsonRequestInit("PUT", { is_active: !isActive }),
        "Failed to update shop",
      );
      loadShops();
      if (activeShop?.id === shopId) openShopDetail(shopId);
    } catch (err) {
      toast.error("Failed to update shop");
    }
  };

  // Item search for adding to shop
  useEffect(() => {
    if (!itemSearch.trim()) { setSearchResults([]); return; }
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const result = await fetchItemsPaginated({ q: itemSearch, limit: 10 }, { signal: controller.signal });
        setSearchResults(result.items);
      } catch {
        // ignore
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [itemSearch]);

  const addItemToShop = async (itemKey: string) => {
    if (!activeCampaignId || !activeShop) return;
    try {
      await fetchJson(
        `/api/campaigns/${activeCampaignId}/shops/${activeShop.id}/inventory`,
        buildJsonRequestInit("POST", { itemKey }),
        "Failed to add item",
      );
      toast.success("Item added to shop");
      setItemSearch("");
      setSearchResults([]);
      openShopDetail(activeShop.id);
    } catch (err) {
      toast.error("Failed to add item");
    }
  };

  const removeItemFromShop = async (entryId: string) => {
    if (!activeCampaignId || !activeShop) return;
    try {
      await fetchJson(
        `/api/campaigns/${activeCampaignId}/shops/${activeShop.id}/inventory/${entryId}`,
        { method: "DELETE" },
        "Failed to remove item",
      );
      toast.success("Item removed");
      openShopDetail(activeShop.id);
    } catch (err) {
      toast.error("Failed to remove item");
    }
  };

  const autoStockShop = async () => {
    if (!activeCampaignId || !activeShop) return;
    setAutoStocking(true);
    try {
      const result = await fetchJson<{ addedCount: number; suggestedCount: number }>(
        `/api/campaigns/${activeCampaignId}/shops/${activeShop.id}/auto-stock`,
        buildJsonRequestInit("POST", {}),
        "Auto-stock failed",
      );
      if (result) {
        toast.success(`Added ${result.addedCount} of ${result.suggestedCount} suggested items`);
        openShopDetail(activeShop.id);
      }
    } catch (err) {
      toast.error("Auto-stock failed — is the LLM service running?");
    } finally {
      setAutoStocking(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="w-6 h-6 animate-spin" />
      </div>
    );
  }

  // Shop detail editor
  if (activeShop) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <Button variant="ghost" size="sm" onClick={() => setActiveShop(null)}>
            <ChevronLeft className="w-4 h-4 mr-1" /> Back
          </Button>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={autoStocking}
              onClick={autoStockShop}
            >
              {autoStocking ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Sparkles className="w-3 h-3 mr-1" />}
              Auto-Stock
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => toggleActive(activeShop.id, activeShop.is_active)}
            >
              {activeShop.is_active ? "Deactivate" : "Activate"}
            </Button>
            <Button
              size="sm"
              variant="destructive"
              onClick={() => deleteShop(activeShop.id)}
            >
              <Trash2 className="w-3 h-3" />
            </Button>
          </div>
        </div>

        <div>
          <h3 className="font-semibold">{activeShop.name}</h3>
          <Badge variant={activeShop.is_active ? "default" : "secondary"}>
            {activeShop.is_active ? "Active" : "Inactive"}
          </Badge>
        </div>

        {/* Add item */}
        <div className="space-y-2 border rounded p-3">
          <Label className="text-sm font-medium">Add Item</Label>
          <div className="relative">
            <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search SRD items..."
              value={itemSearch}
              onChange={(e) => setItemSearch(e.target.value)}
              className="pl-9"
            />
          </div>
          {searching && <Loader2 className="w-4 h-4 animate-spin" />}
          {searchResults.length > 0 && (
            <div className="space-y-1 max-h-40 overflow-y-auto">
              {searchResults.map((item) => (
                <button
                  key={item.key}
                  className="w-full text-left px-2 py-1 text-sm hover:bg-muted rounded flex justify-between"
                  onClick={() => addItemToShop(item.key)}
                >
                  <span>{item.name}</span>
                  <span className="text-muted-foreground">{item.cost} GP</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Current inventory */}
        <div className="space-y-1">
          <Label className="text-sm font-medium">Inventory ({activeShop.inventory.length})</Label>
          {activeShop.inventory.map((item) => (
            <div key={item.id} className="flex items-center justify-between border rounded px-3 py-2">
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">{item.item_name}</div>
                <div className="text-xs text-muted-foreground">
                  {item.effective_price} GP
                  {item.stock_quantity != null && ` · ${item.stock_quantity} stock`}
                </div>
              </div>
              <Button size="sm" variant="ghost" onClick={() => removeItemFromShop(item.id)}>
                <Trash2 className="w-3 h-3" />
              </Button>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // Shop list + create
  return (
    <div className="space-y-4">
      {/* Create shop form */}
      <div className="border rounded p-3 space-y-3">
        <Label className="text-sm font-medium">Create Shop</Label>
        <Input
          placeholder="Shop name"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
        />
        <div className="flex gap-2">
          <Select value={newType} onValueChange={setNewType}>
            <SelectTrigger className="flex-1">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SHOP_TYPES.map((t) => (
                <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            placeholder="Price modifier"
            value={newModifier}
            onChange={(e) => setNewModifier(e.target.value)}
            className="w-24"
          />
        </div>
        <Input
          placeholder="Location (optional)"
          value={newLocation}
          onChange={(e) => setNewLocation(e.target.value)}
        />
        <Button size="sm" disabled={!newName.trim() || creating} onClick={createShop}>
          <Plus className="w-4 h-4 mr-1" /> Create Shop
        </Button>
      </div>

      {/* Existing shops */}
      {shops.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-2">No shops yet.</p>
      ) : (
        <div className="space-y-2">
          {shops.map((shop) => (
            <div key={shop.id} className="border rounded p-3 space-y-1">
              <div className="flex items-center gap-2">
                <Store className="w-4 h-4 shrink-0" />
                <span className="font-medium">{shop.name}</span>
                <Badge variant={shop.is_active ? "default" : "secondary"} className="text-xs">
                  {shop.is_active ? "Active" : "Inactive"}
                </Badge>
              </div>
              <Button size="sm" variant="outline" onClick={() => openShopDetail(shop.id)}>
                Edit
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
