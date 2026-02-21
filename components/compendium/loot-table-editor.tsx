import { useState, useEffect, useCallback } from "react";
import { Input } from "../ui/input";
import { Button } from "../ui/button";
import { Label } from "../ui/label";
import { Badge } from "../ui/badge";
import { toast } from "sonner";
import {
  Loader2,
  Plus,
  Trash2,
  Dice5,
  ChevronLeft,
  Search,
} from "lucide-react";
import { fetchItemsPaginated } from "../../utils/api/srd";
import type { SrdItem } from "../../utils/srd/types";
import {
  fetchLootTables,
  fetchLootTable,
  createLootTable,
  deleteLootTable,
  addLootTableEntry,
  removeLootTableEntry,
  rollOnLootTable,
} from "../../utils/api/loot";
import type { LootTableSummary, LootTableDetail, RollResult } from "../../utils/api/loot";
import { useGameSession } from "../../contexts/GameSessionContext";

export function LootTableEditor() {
  const { activeCampaignId } = useGameSession();
  const [tables, setTables] = useState<LootTableSummary[]>([]);
  const [activeTable, setActiveTable] = useState<LootTableDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  // Create form
  const [newName, setNewName] = useState("");
  const [newType] = useState("custom");
  const [newCrMin, setNewCrMin] = useState("");
  const [newCrMax, setNewCrMax] = useState("");

  // Add item search
  const [itemSearch, setItemSearch] = useState("");
  const [searchResults, setSearchResults] = useState<SrdItem[]>([]);
  const [searching, setSearching] = useState(false);

  // Roll results
  const [rollResults, setRollResults] = useState<RollResult[]>([]);
  const [rolling, setRolling] = useState(false);

  const loadTables = useCallback(async () => {
    if (!activeCampaignId) return;
    setLoading(true);
    try {
      const data = await fetchLootTables(activeCampaignId);
      setTables(data);
    } catch (err) {
      console.error("Failed to load loot tables:", err);
    } finally {
      setLoading(false);
    }
  }, [activeCampaignId]);

  useEffect(() => { loadTables(); }, [loadTables]);

  const handleCreate = async () => {
    if (!activeCampaignId || !newName.trim()) return;
    setCreating(true);
    try {
      await createLootTable(activeCampaignId, {
        name: newName.trim(),
        tableType: newType,
        crMin: newCrMin ? parseInt(newCrMin) : undefined,
        crMax: newCrMax ? parseInt(newCrMax) : undefined,
      });
      toast.success("Loot table created");
      setNewName("");
      setNewCrMin("");
      setNewCrMax("");
      loadTables();
    } catch {
      toast.error("Failed to create loot table");
    } finally {
      setCreating(false);
    }
  };

  const openTableDetail = async (tableId: string) => {
    if (!activeCampaignId) return;
    setLoading(true);
    setRollResults([]);
    try {
      const data = await fetchLootTable(activeCampaignId, tableId);
      setActiveTable(data);
    } catch {
      toast.error("Failed to load loot table");
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (tableId: string) => {
    if (!activeCampaignId) return;
    try {
      await deleteLootTable(activeCampaignId, tableId);
      toast.success("Loot table deleted");
      setActiveTable(null);
      loadTables();
    } catch {
      toast.error("Failed to delete loot table");
    }
  };

  // Item search for adding entries
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

  const handleAddEntry = async (itemKey: string) => {
    if (!activeCampaignId || !activeTable) return;
    try {
      await addLootTableEntry(activeCampaignId, activeTable.id, { itemKey, weight: 1 });
      toast.success("Entry added");
      setItemSearch("");
      setSearchResults([]);
      openTableDetail(activeTable.id);
    } catch {
      toast.error("Failed to add entry");
    }
  };

  const handleAddCurrencyEntry = async () => {
    if (!activeCampaignId || !activeTable) return;
    try {
      await addLootTableEntry(activeCampaignId, activeTable.id, { currencyAmount: "2d6 gp", weight: 1 });
      toast.success("Currency entry added");
      openTableDetail(activeTable.id);
    } catch {
      toast.error("Failed to add entry");
    }
  };

  const handleRemoveEntry = async (entryId: string) => {
    if (!activeCampaignId || !activeTable) return;
    try {
      await removeLootTableEntry(activeCampaignId, activeTable.id, entryId);
      toast.success("Entry removed");
      openTableDetail(activeTable.id);
    } catch {
      toast.error("Failed to remove entry");
    }
  };

  const handleRoll = async (count: number = 1) => {
    if (!activeCampaignId || !activeTable) return;
    setRolling(true);
    try {
      const results = await rollOnLootTable(activeCampaignId, activeTable.id, count);
      setRollResults(results);
    } catch {
      toast.error("Failed to roll");
    } finally {
      setRolling(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="w-6 h-6 animate-spin" />
      </div>
    );
  }

  // Table detail editor
  if (activeTable) {
    const totalWeight = activeTable.entries.reduce((sum, e) => sum + e.weight, 0);

    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <Button variant="ghost" size="sm" onClick={() => { setActiveTable(null); setRollResults([]); }}>
            <ChevronLeft className="w-4 h-4 mr-1" /> Back
          </Button>
          <Button size="sm" variant="destructive" onClick={() => handleDelete(activeTable.id)}>
            <Trash2 className="w-3 h-3" />
          </Button>
        </div>

        <div>
          <h3 className="font-semibold">{activeTable.name}</h3>
          <div className="flex gap-2 text-xs text-muted-foreground">
            <Badge variant="outline">{activeTable.table_type}</Badge>
            {activeTable.cr_min != null && activeTable.cr_max != null && (
              <span>CR {activeTable.cr_min}-{activeTable.cr_max}</span>
            )}
          </div>
        </div>

        {/* Roll section */}
        <div className="flex gap-2">
          <Button size="sm" onClick={() => handleRoll(1)} disabled={rolling || activeTable.entries.length === 0}>
            {rolling ? <Loader2 className="w-4 h-4 animate-spin" /> : <Dice5 className="w-4 h-4 mr-1" />}
            Roll 1
          </Button>
          <Button size="sm" variant="outline" onClick={() => handleRoll(3)} disabled={rolling || activeTable.entries.length === 0}>
            Roll 3
          </Button>
          <Button size="sm" variant="outline" onClick={() => handleRoll(5)} disabled={rolling || activeTable.entries.length === 0}>
            Roll 5
          </Button>
        </div>

        {/* Roll results */}
        {rollResults.length > 0 && (
          <div className="border rounded p-3 bg-muted/50 space-y-1">
            <Label className="text-sm font-medium">Roll Results</Label>
            {rollResults.map((r, i) => (
              <div key={i} className="text-sm">
                {r.itemName && <span className="font-medium">{r.itemName}</span>}
                {r.quantity > 1 && <span className="text-muted-foreground"> x{r.quantity}</span>}
                {r.currencyAmount && <span className="text-muted-foreground"> ({r.currencyAmount})</span>}
              </div>
            ))}
          </div>
        )}

        {/* Add item entry */}
        <div className="space-y-2 border rounded p-3">
          <Label className="text-sm font-medium">Add Entry</Label>
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
                  onClick={() => handleAddEntry(item.key)}
                >
                  <span>{item.name}</span>
                  <span className="text-muted-foreground">{item.cost} GP</span>
                </button>
              ))}
            </div>
          )}
          <Button size="sm" variant="outline" onClick={handleAddCurrencyEntry}>
            <Plus className="w-3 h-3 mr-1" /> Add Currency Entry
          </Button>
        </div>

        {/* Entries list */}
        <div className="space-y-1">
          <Label className="text-sm font-medium">
            Entries ({activeTable.entries.length}) — Total weight: {totalWeight}
          </Label>
          {activeTable.entries.map((entry) => {
            const pct = totalWeight > 0 ? Math.round((entry.weight / totalWeight) * 100) : 0;
            return (
              <div key={entry.id} className="flex items-center justify-between border rounded px-3 py-2">
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">
                    {entry.item_name ?? entry.currency_amount ?? "Unknown"}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Weight: {entry.weight} ({pct}%)
                    {entry.quantity_min !== entry.quantity_max
                      ? ` · Qty: ${entry.quantity_min}-${entry.quantity_max}`
                      : entry.quantity_min > 1
                        ? ` · Qty: ${entry.quantity_min}`
                        : ""}
                  </div>
                </div>
                <Button size="sm" variant="ghost" onClick={() => handleRemoveEntry(entry.id)}>
                  <Trash2 className="w-3 h-3" />
                </Button>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  // Table list + create
  return (
    <div className="space-y-4">
      {/* Create form */}
      <div className="border rounded p-3 space-y-3">
        <Label className="text-sm font-medium">Create Loot Table</Label>
        <Input
          placeholder="Table name"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
        />
        <div className="flex gap-2">
          <Input
            placeholder="CR Min"
            value={newCrMin}
            onChange={(e) => setNewCrMin(e.target.value)}
            className="w-20"
          />
          <Input
            placeholder="CR Max"
            value={newCrMax}
            onChange={(e) => setNewCrMax(e.target.value)}
            className="w-20"
          />
        </div>
        <Button size="sm" disabled={!newName.trim() || creating} onClick={handleCreate}>
          <Plus className="w-4 h-4 mr-1" /> Create Table
        </Button>
      </div>

      {/* Existing tables */}
      {tables.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-2">No loot tables yet.</p>
      ) : (
        <div className="space-y-2">
          {tables.map((table) => (
            <div key={table.id} className="border rounded p-3 space-y-1">
              <div className="flex items-center gap-2">
                <Dice5 className="w-4 h-4 shrink-0" />
                <span className="font-medium">{table.name}</span>
                <Badge variant="secondary" className="text-xs">{table.entry_count} entries</Badge>
              </div>
              {table.cr_min != null && table.cr_max != null && (
                <p className="text-xs text-muted-foreground">CR {table.cr_min}-{table.cr_max}</p>
              )}
              <Button size="sm" variant="outline" onClick={() => openTableDetail(table.id)}>
                Edit
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
