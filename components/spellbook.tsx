import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Button } from "./ui/button";
import { Progress } from "./ui/progress";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Separator } from "./ui/separator";
import { toast } from "sonner";
import {
  Search,
  RefreshCw,
  Loader2,
  Sparkles,
  Plus,
  Trash2,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import type { SpellcastingInfo } from "../utils/database/data-structures";
import type { SrdSpell } from "../utils/srd/types";
import { getCharacter, updateCharacter } from "../utils/api/characters";
import { fetchSpellByKey } from "../utils/api/srd";
import { SpellDetailCard } from "./compendium/spell-detail-card";

interface SpellbookProps {
  characterId: string;
  onSpellcastingChange?: () => void;
}

export function Spellbook({ characterId, onSpellcastingChange }: SpellbookProps) {
  const [spellcasting, setSpellcasting] = useState<SpellcastingInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [newSpellId, setNewSpellId] = useState("");
  const [spellDetails, setSpellDetails] = useState<Record<string, SrdSpell>>({});
  const [expandedSpell, setExpandedSpell] = useState<string | null>(null);

  const loadCharacterSpellcasting = async () => {
    try {
      setLoading(true);
      const char = await getCharacter(characterId);
      if (char) {
        setSpellcasting(char.spellcasting || null);
      }
    } catch (error) {
      console.error("Failed to load character spellcasting:", error);
      toast.error("Failed to load spellcasting data");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (characterId) {
      loadCharacterSpellcasting();
    }
  }, [characterId]);

  // Resolve spell details from SRD API
  useEffect(() => {
    if (!spellcasting?.spellsKnown?.length) return;

    const controller = new AbortController();
    const missing = spellcasting.spellsKnown.filter((id) => !spellDetails[id]);

    if (missing.length === 0) return;

    Promise.allSettled(
      missing.map((key) =>
        fetchSpellByKey(key, { signal: controller.signal }).then((spell) => {
          if (spell) {
            setSpellDetails((prev) => ({ ...prev, [key]: spell }));
          }
        }),
      ),
    );

    return () => controller.abort();
  }, [spellcasting?.spellsKnown]);

  const updateCharacterSpellcasting = async (
    updates: Partial<SpellcastingInfo>,
  ) => {
    if (!spellcasting) {
      toast.error("This character has no spellcasting data to update");
      return;
    }

    try {
      setUpdating(true);
      const merged = { ...spellcasting, ...updates } as SpellcastingInfo;
      await updateCharacter(characterId, {
        spellcasting: merged,
      });
      setSpellcasting(merged);
      onSpellcastingChange?.();
    } catch (error) {
      console.error("Failed to update spellcasting:", error);
      toast.error("Failed to save spellcasting changes");
    } finally {
      setUpdating(false);
    }
  };

  const castSpell = async (spellLevel: number) => {
    if (!spellcasting?.spellSlots?.[spellLevel]) {
      toast.error("No spell slots configured for this level");
      return;
    }

    const slot = spellcasting.spellSlots[spellLevel];
    if (slot.used >= slot.max) {
      toast.error("All spell slots for this level are already expended");
      return;
    }

    const updatedSpellSlots = {
      ...spellcasting.spellSlots,
      [spellLevel]: {
        ...slot,
        used: slot.used + 1,
      },
    };

    await updateCharacterSpellcasting({ spellSlots: updatedSpellSlots });
    toast.success(`Marked one level ${spellLevel} slot as used`);
  };

  const restoreSingleSlot = async (spellLevel: number) => {
    if (!spellcasting?.spellSlots?.[spellLevel]) {
      return;
    }

    const slot = spellcasting.spellSlots[spellLevel];
    if (slot.used === 0) {
      toast.info("All spell slots at this level are already available");
      return;
    }

    const updatedSpellSlots = {
      ...spellcasting.spellSlots,
      [spellLevel]: {
        ...slot,
        used: Math.max(0, slot.used - 1),
      },
    };

    await updateCharacterSpellcasting({ spellSlots: updatedSpellSlots });
    toast.success(`Restored one level ${spellLevel} spell slot`);
  };

  const restoreSpellSlots = async () => {
    if (!spellcasting?.spellSlots) {
      toast.error("No spell slots configured for this character");
      return;
    }

    const restoredSlots = Object.fromEntries(
      Object.entries(spellcasting.spellSlots).map(([level, slot]) => [
        level,
        { ...slot, used: 0 },
      ]),
    );

    await updateCharacterSpellcasting({ spellSlots: restoredSlots });
    toast.success("All spell slots restored after a long rest");
  };

  const learnSpell = async () => {
    if (!spellcasting) {
      toast.error("This character has no spellcasting ability configured");
      return;
    }

    const normalized = newSpellId.trim();
    if (!normalized) {
      toast.error("Enter a spell identifier to add");
      return;
    }

    const existing = spellcasting.spellsKnown || [];
    if (existing.some((spell) => spell.toLowerCase() === normalized.toLowerCase())) {
      toast.error("Spell already tracked for this character");
      return;
    }

    const updatedSpellsKnown = [...existing, normalized];
    await updateCharacterSpellcasting({ spellsKnown: updatedSpellsKnown });
    setNewSpellId("");
    toast.success("Spell added to known list");
  };

  const forgetSpell = async (spellId: string) => {
    if (!spellcasting?.spellsKnown?.includes(spellId)) {
      toast.error("Spell is not currently tracked");
      return;
    }

    const updatedSpellsKnown = spellcasting.spellsKnown.filter(
      (id) => id !== spellId,
    );

    await updateCharacterSpellcasting({ spellsKnown: updatedSpellsKnown });
    toast.success("Removed spell from known list");
  };

  const knownSpells = spellcasting?.spellsKnown ?? [];
  const filteredSpells = knownSpells.filter((spellId) =>
    spellId.toLowerCase().includes(searchTerm.toLowerCase()),
  );

  if (loading) {
    return (
      <div className="text-center py-8">
        <Loader2 className="w-8 h-8 animate-spin mx-auto mb-4" />
        <p>Loading spellbook...</p>
      </div>
    );
  }

  if (!spellcasting) {
    return (
      <div className="space-y-4 text-center py-8">
        <Sparkles className="w-12 h-12 mx-auto mb-4 opacity-50" />
        <p className="text-muted-foreground">
          This character has no spellcasting information stored.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex justify-between items-center">
            <CardTitle>Spell Slots</CardTitle>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => restoreSpellSlots()}
                disabled={updating}
              >
                <RefreshCw className="w-4 h-4 mr-2" />
                Long Rest
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {Object.entries(spellcasting.spellSlots || {}).length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No spell slots configured for this character.
            </p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {Object.entries(spellcasting.spellSlots).map(([level, slots]) => (
                <div key={level} className="border rounded p-3 space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="font-medium">Level {level}</div>
                      <div className="text-sm text-muted-foreground">
                        {slots.max - slots.used} of {slots.max} slots available
                      </div>
                    </div>
                    <Sparkles className="w-5 h-5 text-muted-foreground" />
                  </div>
                  <Progress
                    value={((slots.max - slots.used) / slots.max) * 100}
                    className="h-2"
                  />
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      onClick={() => castSpell(Number(level))}
                      disabled={updating}
                    >
                      Use Slot
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => restoreSingleSlot(Number(level))}
                      disabled={updating}
                    >
                      Restore 1
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Known Spells ({knownSpells.length})</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 md:grid-cols-[2fr_1fr]">
            <div className="relative">
              <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Filter by spell name or identifier..."
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                className="pl-9"
              />
            </div>
            <div className="flex gap-2">
              <Label htmlFor="newSpell" className="sr-only">
                New spell identifier
              </Label>
              <Input
                id="newSpell"
                placeholder="Spell identifier (e.g. fireball)"
                value={newSpellId}
                onChange={(event) => setNewSpellId(event.target.value)}
              />
              <Button onClick={learnSpell} disabled={updating}>
                <Plus className="w-4 h-4 mr-2" />
                Add
              </Button>
            </div>
          </div>

          <Separator />

          {filteredSpells.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {knownSpells.length === 0
                ? "No spells recorded for this character yet."
                : "No spells match your filter."}
            </p>
          ) : (
            <div className="grid gap-2">
              {filteredSpells.map((spellId) => {
                const detail = spellDetails[spellId];
                const displayName = detail?.name ?? spellId;
                const isExpanded = expandedSpell === spellId;
                return (
                  <div key={spellId} className="border rounded">
                    <div className="flex items-center justify-between px-3 py-2">
                      <button
                        className="flex items-center gap-2 text-left flex-1 min-w-0"
                        onClick={() => setExpandedSpell(isExpanded ? null : spellId)}
                      >
                        {detail ? (
                          isExpanded ? <ChevronDown className="w-4 h-4 shrink-0" /> : <ChevronRight className="w-4 h-4 shrink-0" />
                        ) : null}
                        <div className="min-w-0">
                          <div className="font-medium truncate">{displayName}</div>
                          {detail && (
                            <div className="text-xs text-muted-foreground">
                              {detail.level === 0 ? "Cantrip" : `Level ${detail.level}`} {detail.school_key}
                              {detail.concentration && " · Conc."}
                            </div>
                          )}
                        </div>
                      </button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => forgetSpell(spellId)}
                        disabled={updating}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                    {isExpanded && detail && <SpellDetailCard spell={detail} />}
                  </div>
                );
              })}
            </div>
          )}

          {updating && (
            <div className="text-sm text-muted-foreground flex items-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" />
              Saving changes...
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
