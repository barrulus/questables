import { useState, useEffect, useCallback } from "react";
import { Input } from "../ui/input";
import { Button } from "../ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import { Loader2, Search, ChevronDown, ChevronRight, ChevronLeft } from "lucide-react";
import type { SrdItem } from "../../utils/srd/types";
import { fetchItemsPaginated } from "../../utils/api/srd";
import { ItemDetailCard } from "./item-detail-card";

const CATEGORIES = [
  { value: "", label: "All Categories" },
  { value: "weapon", label: "Weapons" },
  { value: "armor", label: "Armor" },
  { value: "adventuring-gear", label: "Adventuring Gear" },
  { value: "tools", label: "Tools" },
  { value: "ammunition", label: "Ammunition" },
  { value: "equipment-packs", label: "Equipment Packs" },
  { value: "arcane-focuses", label: "Arcane Focuses" },
  { value: "druidic-focuses", label: "Druidic Focuses" },
  { value: "holy-symbols", label: "Holy Symbols" },
];

const RARITIES = [
  { value: "", label: "All Rarities" },
  { value: "common", label: "Common" },
  { value: "uncommon", label: "Uncommon" },
  { value: "rare", label: "Rare" },
  { value: "very-rare", label: "Very Rare" },
  { value: "legendary", label: "Legendary" },
];

const PAGE_SIZE = 20;

export function ItemBrowser() {
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [rarity, setRarity] = useState("");
  const [items, setItems] = useState<SrdItem[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(false);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  const loadItems = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    try {
      const result = await fetchItemsPaginated(
        {
          q: search || undefined,
          category: category || undefined,
          rarity: rarity || undefined,
          limit: PAGE_SIZE,
          offset,
        },
        { signal },
      );
      setItems(result.items);
      setTotal(result.total);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      console.error("Failed to load items:", err);
    } finally {
      setLoading(false);
    }
  }, [search, category, rarity, offset]);

  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => loadItems(controller.signal), 300);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [loadItems]);

  // Reset offset when filters change
  useEffect(() => {
    setOffset(0);
  }, [search, category, rarity]);

  const totalPages = Math.ceil(total / PAGE_SIZE);
  const currentPage = Math.floor(offset / PAGE_SIZE) + 1;

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search items..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      <div className="flex gap-2">
        <Select value={category || "all"} onValueChange={(v) => setCategory(v === "all" ? "" : v)}>
          <SelectTrigger className="flex-1">
            <SelectValue placeholder="Category" />
          </SelectTrigger>
          <SelectContent>
            {CATEGORIES.map((c) => (
              <SelectItem key={c.value || "all"} value={c.value || "all"}>
                {c.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={rarity || "all"} onValueChange={(v) => setRarity(v === "all" ? "" : v)}>
          <SelectTrigger className="flex-1">
            <SelectValue placeholder="Rarity" />
          </SelectTrigger>
          <SelectContent>
            {RARITIES.map((r) => (
              <SelectItem key={r.value || "all"} value={r.value || "all"}>
                {r.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="w-6 h-6 animate-spin" />
        </div>
      ) : items.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-4">No items found.</p>
      ) : (
        <div className="space-y-1">
          {items.map((item) => (
            <div key={item.key} className="border rounded">
              <button
                className="w-full flex items-center justify-between px-3 py-2 text-left hover:bg-muted/50 transition-colors"
                onClick={() => setExpandedKey(expandedKey === item.key ? null : item.key)}
              >
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate">{item.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {item.category_key?.replace(/-/g, " ")}
                    {item.cost && ` · ${item.cost} GP`}
                    {item.weight != null && ` · ${item.weight} lb`}
                  </div>
                </div>
                {expandedKey === item.key ? (
                  <ChevronDown className="w-4 h-4 shrink-0 ml-2" />
                ) : (
                  <ChevronRight className="w-4 h-4 shrink-0 ml-2" />
                )}
              </button>
              {expandedKey === item.key && <ItemDetailCard item={item} />}
            </div>
          ))}
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm">
          <Button
            variant="outline"
            size="sm"
            disabled={offset === 0}
            onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
          >
            <ChevronLeft className="w-4 h-4 mr-1" /> Prev
          </Button>
          <span className="text-muted-foreground">
            Page {currentPage} of {totalPages} ({total} items)
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={offset + PAGE_SIZE >= total}
            onClick={() => setOffset(offset + PAGE_SIZE)}
          >
            Next <ChevronRight className="w-4 h-4 ml-1" />
          </Button>
        </div>
      )}
    </div>
  );
}
