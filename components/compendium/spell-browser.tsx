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
import type { SrdSpell } from "../../utils/srd/types";
import { fetchSpellsPaginated } from "../../utils/api/srd";
import { SpellDetailCard } from "./spell-detail-card";

const LEVELS = [
  { value: "", label: "All Levels" },
  { value: "0", label: "Cantrip" },
  { value: "1", label: "1st Level" },
  { value: "2", label: "2nd Level" },
  { value: "3", label: "3rd Level" },
  { value: "4", label: "4th Level" },
  { value: "5", label: "5th Level" },
  { value: "6", label: "6th Level" },
  { value: "7", label: "7th Level" },
  { value: "8", label: "8th Level" },
  { value: "9", label: "9th Level" },
];

const SCHOOLS = [
  { value: "", label: "All Schools" },
  { value: "abjuration", label: "Abjuration" },
  { value: "conjuration", label: "Conjuration" },
  { value: "divination", label: "Divination" },
  { value: "enchantment", label: "Enchantment" },
  { value: "evocation", label: "Evocation" },
  { value: "illusion", label: "Illusion" },
  { value: "necromancy", label: "Necromancy" },
  { value: "transmutation", label: "Transmutation" },
];

const CLASSES = [
  { value: "", label: "All Classes" },
  { value: "bard", label: "Bard" },
  { value: "cleric", label: "Cleric" },
  { value: "druid", label: "Druid" },
  { value: "paladin", label: "Paladin" },
  { value: "ranger", label: "Ranger" },
  { value: "sorcerer", label: "Sorcerer" },
  { value: "warlock", label: "Warlock" },
  { value: "wizard", label: "Wizard" },
];

const PAGE_SIZE = 20;

export function SpellBrowser() {
  const [search, setSearch] = useState("");
  const [level, setLevel] = useState("");
  const [school, setSchool] = useState("");
  const [classFilter, setClassFilter] = useState("");
  const [spells, setSpells] = useState<SrdSpell[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(false);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  const loadSpells = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    try {
      const result = await fetchSpellsPaginated(
        {
          q: search || undefined,
          level: level ? parseInt(level) : undefined,
          school: school || undefined,
          class: classFilter || undefined,
          limit: PAGE_SIZE,
          offset,
        },
        { signal },
      );
      setSpells(result.spells);
      setTotal(result.total);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      console.error("Failed to load spells:", err);
    } finally {
      setLoading(false);
    }
  }, [search, level, school, classFilter, offset]);

  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => loadSpells(controller.signal), 300);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [loadSpells]);

  useEffect(() => {
    setOffset(0);
  }, [search, level, school, classFilter]);

  const totalPages = Math.ceil(total / PAGE_SIZE);
  const currentPage = Math.floor(offset / PAGE_SIZE) + 1;

  function levelLabel(l: number): string {
    if (l === 0) return "Cantrip";
    const suffix = l === 1 ? "st" : l === 2 ? "nd" : l === 3 ? "rd" : "th";
    return `${l}${suffix}`;
  }

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search spells..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      <div className="flex gap-2">
        <Select value={level || "all"} onValueChange={(v) => setLevel(v === "all" ? "" : v)}>
          <SelectTrigger className="flex-1">
            <SelectValue placeholder="Level" />
          </SelectTrigger>
          <SelectContent>
            {LEVELS.map((l) => (
              <SelectItem key={l.value || "all"} value={l.value || "all"}>
                {l.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={school || "all"} onValueChange={(v) => setSchool(v === "all" ? "" : v)}>
          <SelectTrigger className="flex-1">
            <SelectValue placeholder="School" />
          </SelectTrigger>
          <SelectContent>
            {SCHOOLS.map((s) => (
              <SelectItem key={s.value || "all"} value={s.value || "all"}>
                {s.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={classFilter || "all"} onValueChange={(v) => setClassFilter(v === "all" ? "" : v)}>
          <SelectTrigger className="flex-1">
            <SelectValue placeholder="Class" />
          </SelectTrigger>
          <SelectContent>
            {CLASSES.map((c) => (
              <SelectItem key={c.value || "all"} value={c.value || "all"}>
                {c.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="w-6 h-6 animate-spin" />
        </div>
      ) : spells.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-4">No spells found.</p>
      ) : (
        <div className="space-y-1">
          {spells.map((spell) => (
            <div key={spell.key} className="border rounded">
              <button
                className="w-full flex items-center justify-between px-3 py-2 text-left hover:bg-muted/50 transition-colors"
                onClick={() => setExpandedKey(expandedKey === spell.key ? null : spell.key)}
              >
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate">{spell.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {levelLabel(spell.level)} {spell.school_key}
                    {spell.concentration && " · Concentration"}
                    {spell.ritual && " · Ritual"}
                  </div>
                </div>
                {expandedKey === spell.key ? (
                  <ChevronDown className="w-4 h-4 shrink-0 ml-2" />
                ) : (
                  <ChevronRight className="w-4 h-4 shrink-0 ml-2" />
                )}
              </button>
              {expandedKey === spell.key && <SpellDetailCard spell={spell} />}
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
            Page {currentPage} of {totalPages} ({total} spells)
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
