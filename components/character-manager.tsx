import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Plus,
  Edit,
  Trash2,
  Loader2,
  Download,
  RefreshCw,
  Users,
  AlertTriangle,
} from "lucide-react";

import { useUser } from "../contexts/UserContext";
import {
  listUserCharacters,
  createCharacter as createCharacterRecord,
  updateCharacter as updateCharacterRecord,
  deleteCharacter as deleteCharacterRecord,
  type CharacterCreateRequest,
  type CharacterUpdateRequest,
} from "../utils/api/characters";
import type {
  Character,
  InventoryItem,
  Equipment,
  SpellcastingInfo,
} from "../utils/database/data-structures";

import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { ScrollArea } from "./ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "./ui/dialog";
import { Textarea } from "./ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "./ui/alert-dialog";
import { Badge } from "./ui/badge";
import { cn } from "./ui/utils";

export interface CharacterManagerCommand {
  type: "create" | "edit";
  token: number;
  characterId?: string;
}

interface CharacterManagerProps {
  command?: CharacterManagerCommand | null;
  onCharactersChanged?: () => void;
}

const abilityKeys = [
  "strength",
  "dexterity",
  "constitution",
  "intelligence",
  "wisdom",
  "charisma",
] as const;

const abilityLabels: Record<typeof abilityKeys[number], string> = {
  strength: "Strength",
  dexterity: "Dexterity",
  constitution: "Constitution",
  intelligence: "Intelligence",
  wisdom: "Wisdom",
  charisma: "Charisma",
};

const abilityAbbreviations: Record<typeof abilityKeys[number], string> = {
  strength: "STR",
  dexterity: "DEX",
  constitution: "CON",
  intelligence: "INT",
  wisdom: "WIS",
  charisma: "CHA",
};

const defaultAbilities: Record<typeof abilityKeys[number], number> = {
  strength: 10,
  dexterity: 10,
  constitution: 10,
  intelligence: 10,
  wisdom: 10,
  charisma: 10,
};

const defaultHitPoints = { current: 0, max: 0, temporary: 0 };

type NumericLike = number | string | null | undefined;

type RawHitPoints = {
  current?: NumericLike;
  max?: NumericLike;
  maximum?: NumericLike;
  temp?: NumericLike;
  temporary?: NumericLike;
};

type CharacterMutationPayload = {
  userId: string;
  name: string;
  class: string;
  level: number;
  race: string;
  background: string;
  armorClass: number;
  speed: number;
  proficiencyBonus: number;
  hitPoints: {
    current: number;
    max: number;
    temporary: number;
  };
  abilities: Record<typeof abilityKeys[number], number>;
  savingThrows: Record<string, number>;
  skills: Record<string, number>;
  inventory: InventoryItem[];
  equipment: Equipment;
  backstory?: string;
  personality?: string;
  ideals?: string;
  bonds?: string;
  flaws?: string;
  spellcasting?: SpellcastingInfo;
};

const toNumber = (value: NumericLike, fallback = 0) => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  return fallback;
};

const createEmptyEquipment = (): Equipment => ({
  weapons: {},
  accessories: {},
});

interface CharacterFormState {
  id?: string;
  name: string;
  className: string;
  level: number;
  race: string;
  background: string;
  armorClass: number;
  speed: number;
  proficiencyBonus: number;
  hitPointsCurrent: number;
  hitPointsMax: number;
  hitPointsTemporary: number;
  abilities: Record<typeof abilityKeys[number], number>;
  backstory: string;
  personality: string;
  ideals: string;
  bonds: string;
  flaws: string;
}

const emptyFormState: CharacterFormState = {
  name: "",
  className: "",
  level: 1,
  race: "",
  background: "",
  armorClass: 10,
  speed: 30,
  proficiencyBonus: 2,
  hitPointsCurrent: 0,
  hitPointsMax: 0,
  hitPointsTemporary: 0,
  abilities: { ...defaultAbilities },
  backstory: "",
  personality: "",
  ideals: "",
  bonds: "",
  flaws: "",
};

const getHitPoints = (character: Character) => {
  const raw =
    (character.hit_points as RawHitPoints | undefined) ??
    (character.hitPoints as RawHitPoints | undefined) ??
    {};

  return {
    current: toNumber(raw.current, defaultHitPoints.current),
    max: toNumber(raw.max ?? raw.maximum, defaultHitPoints.max),
    temporary: toNumber(raw.temporary ?? raw.temp, defaultHitPoints.temporary),
  };
};

const getAbilities = (character: Character) => {
  const abilities = character.abilities as Record<string, number> | undefined;
  if (!abilities) {
    return { ...defaultAbilities };
  }
  return abilityKeys.reduce((acc, ability) => {
    const value = abilities[ability];
    acc[ability] = typeof value === "number" ? value : Number(value) || 10;
    return acc;
  }, {} as Record<typeof abilityKeys[number], number>);
};

const getArmorClass = (character: Character) => {
  const value =
    (character.armor_class as number | undefined) ??
    (character.armorClass as number | undefined);
  return typeof value === "number" ? value : 10;
};

const getProficiencyBonus = (character: Character) => {
  const value =
    (character.proficiency_bonus as number | undefined) ??
    (character.proficiencyBonus as number | undefined);
  return typeof value === "number" ? value : 2;
};

const getSpeed = (character: Character) => {
  return typeof character.speed === "number" ? character.speed : 30;
};

const mapCharacterToForm = (character: Character): CharacterFormState => {
  const hitPoints = getHitPoints(character);
  return {
    id: character.id,
    name: character.name,
    className: character.class,
    level: character.level,
    race: character.race,
    background: character.background,
    armorClass: getArmorClass(character),
    speed: getSpeed(character),
    proficiencyBonus: getProficiencyBonus(character),
    hitPointsCurrent: hitPoints.current,
    hitPointsMax: hitPoints.max,
    hitPointsTemporary: hitPoints.temporary,
    abilities: getAbilities(character),
    backstory: character.backstory ?? "",
    personality: character.personality ?? "",
    ideals: character.ideals ?? "",
    bonds: character.bonds ?? "",
    flaws: character.flaws ?? "",
  };
};

const buildCreatePayload = (
  form: CharacterFormState,
  userId: string,
): CharacterMutationPayload => {
  return {
    userId,
    name: form.name.trim(),
    class: form.className.trim(),
    level: form.level,
    race: form.race.trim(),
    background: form.background.trim(),
    armorClass: form.armorClass,
    speed: form.speed,
    proficiencyBonus: form.proficiencyBonus,
    hitPoints: {
      current: form.hitPointsCurrent,
      max: form.hitPointsMax,
      temporary: form.hitPointsTemporary,
    },
    abilities: form.abilities,
    savingThrows: {},
    skills: {},
    inventory: [],
    equipment: createEmptyEquipment(),
    backstory: form.backstory.trim() || undefined,
    personality: form.personality.trim() || undefined,
    ideals: form.ideals.trim() || undefined,
    bonds: form.bonds.trim() || undefined,
    flaws: form.flaws.trim() || undefined,
    spellcasting: undefined,
  };
};

const buildUpdatePayload = (
  form: CharacterFormState,
  userId: string,
  character: Character,
): CharacterMutationPayload => {
  const inventory = Array.isArray(character.inventory)
    ? (character.inventory as InventoryItem[])
    : [];
  const equipment =
    (character.equipment as Equipment | undefined) ?? createEmptyEquipment();
  return {
    userId,
    name: form.name.trim(),
    class: form.className.trim(),
    level: form.level,
    race: form.race.trim(),
    background: form.background.trim(),
    armorClass: form.armorClass,
    speed: form.speed,
    proficiencyBonus: form.proficiencyBonus,
    hitPoints: {
      current: form.hitPointsCurrent,
      max: form.hitPointsMax,
      temporary: form.hitPointsTemporary,
    },
    abilities: form.abilities,
    savingThrows:
      (character.saving_throws as Record<string, number> | undefined) ??
      (character.savingThrows as Record<string, number> | undefined) ??
      {},
    skills: (character.skills as Record<string, number> | undefined) ?? {},
    inventory,
    equipment: {
      ...equipment,
      weapons: { ...(equipment.weapons ?? {}) },
      accessories: { ...(equipment.accessories ?? {}) },
    },
    backstory: form.backstory.trim() || undefined,
    personality: form.personality.trim() || undefined,
    ideals: form.ideals.trim() || undefined,
    bonds: form.bonds.trim() || undefined,
    flaws: form.flaws.trim() || undefined,
    spellcasting:
      (character.spellcasting as SpellcastingInfo | undefined) ?? undefined,
  };
};

const toCreateRequest = (payload: CharacterMutationPayload): CharacterCreateRequest => {
  const request: CharacterCreateRequest = {
    userId: payload.userId,
    name: payload.name,
    className: payload.class,
    level: payload.level,
    race: payload.race,
    background: payload.background,
    hitPoints: payload.hitPoints,
    armorClass: payload.armorClass,
    speed: payload.speed,
    proficiencyBonus: payload.proficiencyBonus,
    abilities: payload.abilities,
    savingThrows: payload.savingThrows,
    skills: payload.skills,
    inventory: payload.inventory,
    equipment: payload.equipment,
  };

  if (payload.backstory !== undefined) request.backstory = payload.backstory;
  if (payload.personality !== undefined) request.personality = payload.personality;
  if (payload.ideals !== undefined) request.ideals = payload.ideals;
  if (payload.bonds !== undefined) request.bonds = payload.bonds;
  if (payload.flaws !== undefined) request.flaws = payload.flaws;
  if (payload.spellcasting !== undefined) request.spellcasting = payload.spellcasting ?? null;

  return request;
};

const toUpdateRequest = (payload: CharacterMutationPayload): CharacterUpdateRequest => {
  const request = toCreateRequest(payload) as CharacterUpdateRequest;
  request.userId = payload.userId;
  return request;
};

const getAbilityModifier = (score: number) => Math.floor((score - 10) / 2);

const formatDate = (value?: string | Date | null) => {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString();
};

type SortOption = "updated" | "name" | "level";

type LoadMode = "initial" | "refresh";

export function CharacterManager({ command, onCharactersChanged }: CharacterManagerProps) {
  const { user } = useUser();
  const [characters, setCharacters] = useState<Character[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedCharacterId, setSelectedCharacterId] = useState<string | null>(null);
  const [formState, setFormState] = useState<CharacterFormState>(emptyFormState);
  const [formOpen, setFormOpen] = useState(false);
  const [formMode, setFormMode] = useState<"create" | "edit">("create");
  const [operationPending, setOperationPending] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Character | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [sortBy, setSortBy] = useState<SortOption>("updated");
  const [processedCommandToken, setProcessedCommandToken] = useState<number | null>(null);

  const loadCharacters = useCallback(async (mode: LoadMode = "initial") => {
    if (!user) {
      setCharacters([]);
      setLoading(false);
      return;
    }

    setError(null);

    if (mode === "initial") {
      setLoading(true);
    } else {
      setRefreshing(true);
    }

    try {
      const data = await listUserCharacters(user.id);
      setCharacters(data ?? []);
    } catch (err) {
      console.error("Failed to load characters", err);
      const message =
        err instanceof Error
          ? err.message
          : "Unable to load characters from the database";
      setError(message);
      toast.error(message);
    } finally {
      if (mode === "initial") {
        setLoading(false);
      } else {
        setRefreshing(false);
      }
    }
  }, [user]);

  useEffect(() => {
    loadCharacters("initial");
  }, [user?.id, loadCharacters]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    if (characters.length === 0) {
      setSelectedCharacterId(null);
      return;
    }

    setSelectedCharacterId((current) => {
      if (current && characters.some((character) => character.id === current)) {
        return current;
      }

      const stored = localStorage.getItem("dnd-active-character");
      if (stored && characters.some((character) => character.id === stored)) {
        return stored;
      }

      return characters[0]?.id ?? null;
    });
  }, [characters]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    if (selectedCharacterId) {
      localStorage.setItem("dnd-active-character", selectedCharacterId);
    }
  }, [selectedCharacterId]);

  const filteredCharacters = useMemo(() => {
    const normalizedSearch = searchTerm.trim().toLowerCase();
    const filtered = characters.filter((character) => {
      if (!normalizedSearch) return true;
      const haystack = [
        character.name,
        character.class,
        character.race,
        character.background,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(normalizedSearch);
    });

    const getSortableTimestamp = (character: Character) => {
      const value =
        (character.updated_at as string | undefined) ??
        (character.updatedAt as string | undefined) ??
        (character.created_at as string | undefined) ??
        (character.createdAt as string | undefined) ??
        (character.last_played as string | undefined) ??
        (character.lastPlayed as string | undefined) ??
        null;
      return value ? new Date(value).getTime() : 0;
    };

    return filtered.sort((a, b) => {
      switch (sortBy) {
        case "name":
          return a.name.localeCompare(b.name);
        case "level":
          return b.level - a.level;
        case "updated":
        default:
          return getSortableTimestamp(b) - getSortableTimestamp(a);
      }
    });
  }, [characters, searchTerm, sortBy]);

  const selectedCharacter = useMemo(() => {
    if (!selectedCharacterId) return null;
    return characters.find((character) => character.id === selectedCharacterId) ?? null;
  }, [characters, selectedCharacterId]);

  const openCreateDialog = () => {
    setFormMode("create");
    setFormState(emptyFormState);
    setSelectedCharacterId(null);
    setFormOpen(true);
  };

  const openEditDialog = (character: Character) => {
    setFormMode("edit");
    setFormState(mapCharacterToForm(character));
    setSelectedCharacterId(character.id);
    setFormOpen(true);
  };

  useEffect(() => {
    if (!command) {
      return;
    }

    if (processedCommandToken === command.token) {
      return;
    }

    if (command.type === "create") {
      setFormMode("create");
      setFormState(emptyFormState);
      setSelectedCharacterId(null);
      setFormOpen(true);
      setProcessedCommandToken(command.token);
      return;
    }

    if (!command.characterId) {
      setProcessedCommandToken(command.token);
      return;
    }

    const target = characters.find((character) => character.id === command.characterId) ?? null;
    if (target) {
      setFormMode("edit");
      setFormState(mapCharacterToForm(target));
      setSelectedCharacterId(target.id);
      setFormOpen(true);
      setProcessedCommandToken(command.token);
    } else if (!loading && !refreshing) {
      toast.error("Unable to locate that character. Please refresh your roster and try again.");
      setProcessedCommandToken(command.token);
    }
  }, [command, characters, loading, processedCommandToken, refreshing]);

  const handleSave = async () => {
    if (!user) {
      toast.error("You must be signed in to manage characters");
      return;
    }

    if (!formState.name.trim() || !formState.className.trim() || !formState.race.trim()) {
      toast.error("Name, class, and race are required");
      return;
    }

    setOperationPending(true);
    try {
      if (formMode === "create") {
        const payload = buildCreatePayload(formState, user.id);
        const created = await createCharacterRecord(toCreateRequest(payload));
        if (!created) {
          throw new Error("Character was not created by the backend");
        }
        setCharacters((prev) => [created, ...prev.filter((char) => char.id !== created.id)]);
        setSelectedCharacterId(created.id);
        toast.success("Character created");
      } else {
        if (!selectedCharacter) {
          throw new Error("No character selected for editing");
        }
        const payload = buildUpdatePayload(formState, user.id, selectedCharacter);
        const updated = await updateCharacterRecord(
          selectedCharacter.id,
          toUpdateRequest(payload),
        );
        if (!updated) {
          throw new Error("Character changes were not persisted");
        }
        setCharacters((prev) =>
          prev.map((char) => (char.id === updated.id ? updated : char)),
        );
        setSelectedCharacterId(updated.id);
        toast.success("Character updated");
      }
      setFormOpen(false);
      setFormState(emptyFormState);
      await loadCharacters("refresh");
      onCharactersChanged?.();
    } catch (err) {
      console.error("Failed to save character", err);
      const message =
        err instanceof Error ? err.message : "Unable to save character";
      toast.error(message);
    } finally {
      setOperationPending(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setOperationPending(true);
    try {
      await deleteCharacterRecord(deleteTarget.id);
      toast.success("Character deleted");
      setDeleteTarget(null);
      await loadCharacters("refresh");
      onCharactersChanged?.();
    } catch (err) {
      console.error("Failed to delete character", err);
      const message = err instanceof Error ? err.message : "Delete failed";
      toast.error(message);
    } finally {
      setOperationPending(false);
    }
  };

  const handleExport = (character?: Character) => {
    const payload = character ? character : characters;
    if (!payload || (Array.isArray(payload) && payload.length === 0)) {
      toast.info("No character data to export");
      return;
    }

    const data = JSON.stringify(payload, null, 2);
    const blob = new Blob([data], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = character ? `${character.name}.json` : "characters.json";
    link.click();
    URL.revokeObjectURL(url);
    toast.success("Export complete");
  };

  const renderCharacterList = () => {
    if (loading) {
      return (
        <div className="flex flex-1 items-center justify-center py-12 text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          <span>Loading characters…</span>
        </div>
      );
    }

    if (error) {
      return (
        <div className="flex flex-col items-center justify-center gap-3 py-10 text-center">
          <AlertTriangle className="h-6 w-6 text-destructive" />
          <div>
            <p className="font-medium">Failed to load characters</p>
            <p className="text-sm text-muted-foreground">{error}</p>
          </div>
          <Button onClick={() => loadCharacters("refresh")} disabled={refreshing}>
            {refreshing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Retry
          </Button>
        </div>
      );
    }

    if (filteredCharacters.length === 0) {
      return (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 py-12 text-center text-muted-foreground">
          <Users className="h-10 w-10 opacity-50" />
          <p className="font-medium">No characters found</p>
          <p className="text-sm">Create a character to get started.</p>
        </div>
      );
    }

    return (
      <ScrollArea className="flex-1">
        <div className="space-y-3 p-1">
          {filteredCharacters.map((character) => {
            const isSelected = character.id === selectedCharacterId;
            return (
              <div key={character.id} className="space-y-2">
                <button
                  type="button"
                  onClick={() => setSelectedCharacterId(character.id)}
                  className={cn(
                    "w-full rounded-md border p-3 text-left transition",
                    isSelected
                      ? "border-primary bg-primary/10"
                      : "border-transparent bg-muted/30 hover:bg-muted/60",
                  )}
                >
                  <div className="flex items-center justify-between">
                    <div className="font-medium">{character.name}</div>
                    <span className="text-xs text-muted-foreground">
                      Level {character.level}
                    </span>
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {character.class} · {character.race}
                  </div>
                  <div className="mt-2 text-xs text-muted-foreground">
                    Updated {formatDate(
                      (character.updated_at as string | undefined) ??
                        (character.updatedAt as string | undefined),
                    ) || "unknown"}
                  </div>
                </button>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1"
                    onClick={() => openEditDialog(character)}
                  >
                    <Edit className="mr-1 h-4 w-4" /> Edit
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1"
                    onClick={() => handleExport(character)}
                  >
                    <Download className="mr-1 h-4 w-4" /> Export
                  </Button>
                  <Button
                    variant="outline"
                    size="icon"
                    aria-label="Delete character"
                    onClick={() => setDeleteTarget(character)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      </ScrollArea>
    );
  };

  const renderDetail = () => {
    if (!selectedCharacter) {
      return (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center text-muted-foreground">
          <Users className="h-10 w-10 opacity-40" />
          <p>Select a character to view details</p>
        </div>
      );
    }

    const hitPoints = getHitPoints(selectedCharacter);
    const abilities = getAbilities(selectedCharacter);
    const skills = (selectedCharacter.skills as Record<string, number> | undefined) ?? {};
    const inventory = Array.isArray(selectedCharacter.inventory)
      ? (selectedCharacter.inventory as InventoryItem[])
      : [];
    const equipment =
      (selectedCharacter.equipment as Equipment | undefined) ?? createEmptyEquipment();
    const spellcasting =
      (selectedCharacter.spellcasting as SpellcastingInfo | undefined) ?? undefined;

    return (
      <div className="flex h-full flex-col">
        <div className="border-b px-5 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-semibold">{selectedCharacter.name}</h3>
              <p className="text-sm text-muted-foreground">
                Level {selectedCharacter.level} {selectedCharacter.race} {selectedCharacter.class}
              </p>
            </div>
            <div className="text-right text-xs text-muted-foreground">
              <div>Created {formatDate((selectedCharacter.created_at as string | undefined) ?? (selectedCharacter.createdAt as string | undefined)) || "unknown"}</div>
              <div>Last updated {formatDate((selectedCharacter.updated_at as string | undefined) ?? (selectedCharacter.updatedAt as string | undefined)) || "unknown"}</div>
            </div>
          </div>
        </div>
        <ScrollArea className="flex-1">
          <div className="space-y-6 p-5">
            <Card>
              <CardHeader>
                <CardTitle>Overview</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-4 md:grid-cols-2">
                <div>
                  <Label className="text-xs uppercase text-muted-foreground">Hit Points</Label>
                  <div className="text-sm font-medium">
                    {hitPoints.current} / {hitPoints.max}
                    {hitPoints.temporary ? ` (+${hitPoints.temporary} temporary)` : ""}
                  </div>
                </div>
                <div>
                  <Label className="text-xs uppercase text-muted-foreground">Armor Class</Label>
                  <div className="text-sm font-medium">{getArmorClass(selectedCharacter)}</div>
                </div>
                <div>
                  <Label className="text-xs uppercase text-muted-foreground">Speed</Label>
                  <div className="text-sm font-medium">{getSpeed(selectedCharacter)} ft.</div>
                </div>
                <div>
                  <Label className="text-xs uppercase text-muted-foreground">Proficiency Bonus</Label>
                  <div className="text-sm font-medium">+{getProficiencyBonus(selectedCharacter)}</div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Ability Scores</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid gap-3 md:grid-cols-3">
                  {abilityKeys.map((ability) => (
                    <div key={ability} className="rounded border p-3 text-center">
                      <div className="text-xs font-semibold uppercase text-muted-foreground">
                        {abilityAbbreviations[ability]}
                      </div>
                      <div className="text-2xl font-bold">
                        {getAbilityModifier(abilities[ability]) >= 0 ? "+" : ""}
                        {getAbilityModifier(abilities[ability])}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        ({abilities[ability]})
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            {selectedCharacter.backstory && (
              <Card>
                <CardHeader>
                  <CardTitle>Backstory</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="whitespace-pre-wrap text-sm leading-relaxed">
                    {selectedCharacter.backstory}
                  </p>
                </CardContent>
              </Card>
            )}

            {Object.keys(skills).length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle>Skill Proficiencies</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex flex-wrap gap-2">
                    {Object.keys(skills).map((skill) => (
                      <Badge key={skill} variant="secondary">
                        {skill}
                      </Badge>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {inventory.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle>Inventory</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {inventory.map((item) => (
                    <div key={item.id} className="rounded border p-3 text-sm">
                      <div className="flex items-center justify-between">
                        <span className="font-medium">{item.name}</span>
                        <span className="text-xs text-muted-foreground">
                          Qty {item.quantity ?? 1}
                        </span>
                      </div>
                      {item.description && (
                        <p className="mt-1 text-xs text-muted-foreground">
                          {item.description}
                        </p>
                      )}
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}

            {equipment && Object.keys(equipment).length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle>Equipment</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 text-sm">
                  {equipment.armor && (
                    <div>
                      <div className="font-semibold">Armor</div>
                      <div className="text-muted-foreground">{equipment.armor.name}</div>
                    </div>
                  )}
                  {equipment.shield && (
                    <div>
                      <div className="font-semibold">Shield</div>
                      <div className="text-muted-foreground">{equipment.shield.name}</div>
                    </div>
                  )}
                  {equipment.weapons && Object.keys(equipment.weapons).length > 0 && (
                    <div>
                      <div className="font-semibold">Weapons</div>
                      <ul className="ml-4 list-disc space-y-1 text-muted-foreground">
                        {Object.values(equipment.weapons)
                          .filter(Boolean)
                          .map((weapon) =>
                            weapon ? (
                              <li key={weapon.id}>{weapon.name}</li>
                            ) : null,
                          )}
                      </ul>
                    </div>
                  )}
                  {equipment.accessories && Object.keys(equipment.accessories).length > 0 && (
                    <div>
                      <div className="font-semibold">Accessories</div>
                      <ul className="ml-4 list-disc space-y-1 text-muted-foreground">
                        {Object.values(equipment.accessories)
                          .filter(Boolean)
                          .map((item) =>
                            item ? (
                              <li key={item.id}>{item.name}</li>
                            ) : null,
                          )}
                      </ul>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {spellcasting && (
              <Card>
                <CardHeader>
                  <CardTitle>Spellcasting</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 text-sm">
                  <div className="grid gap-3 md:grid-cols-3">
                    <div>
                      <div className="text-xs uppercase text-muted-foreground">Ability</div>
                      <div className="font-medium">{spellcasting.spellcastingAbility}</div>
                    </div>
                    <div>
                      <div className="text-xs uppercase text-muted-foreground">Spell Attack Bonus</div>
                      <div className="font-medium">+{spellcasting.spellAttackBonus}</div>
                    </div>
                    <div>
                      <div className="text-xs uppercase text-muted-foreground">Spell Save DC</div>
                      <div className="font-medium">{spellcasting.spellSaveDC}</div>
                    </div>
                  </div>
                  {spellcasting.cantripsKnown?.length ? (
                    <div>
                      <div className="font-semibold">Cantrips</div>
                      <div className="text-muted-foreground">
                        {spellcasting.cantripsKnown.join(", ")}
                      </div>
                    </div>
                  ) : null}
                  {spellcasting.spellsKnown?.length ? (
                    <div>
                      <div className="font-semibold">Spells Known</div>
                      <div className="text-muted-foreground">
                        {spellcasting.spellsKnown.join(", ")}
                      </div>
                    </div>
                  ) : null}
                </CardContent>
              </Card>
            )}
          </div>
        </ScrollArea>
      </div>
    );
  };

  return (
    <div className="flex h-full flex-col">
      <div className="border-b px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-base font-semibold">Character Manager</h2>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => loadCharacters("refresh")}
              disabled={refreshing || loading}
            >
              {refreshing && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
              <RefreshCw className="mr-1 h-4 w-4" /> Refresh
            </Button>
            <Button variant="outline" size="sm" onClick={() => handleExport()}>
              <Download className="mr-1 h-4 w-4" /> Export All
            </Button>
            <Button size="sm" onClick={openCreateDialog}>
              <Plus className="mr-1 h-4 w-4" /> New Character
            </Button>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <Input
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
            placeholder="Search by name, class, or race"
            className="w-full max-w-xs"
          />
          <Select value={sortBy} onValueChange={(value) => setSortBy(value as SortOption)}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Sort by" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="updated">Recently updated</SelectItem>
              <SelectItem value="name">Name</SelectItem>
              <SelectItem value="level">Level</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="flex flex-1 min-h-0">
        <div className="flex w-full max-w-md flex-col border-r">
          {renderCharacterList()}
        </div>
        <div className="hidden flex-1 md:flex">
          {renderDetail()}
        </div>
      </div>

      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {formMode === "create" ? "Create Character" : "Edit Character"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-6">
            <Tabs defaultValue="core" className="w-full">
              <TabsList className="grid w-full grid-cols-3">
                <TabsTrigger value="core">Core</TabsTrigger>
                <TabsTrigger value="stats">Stats</TabsTrigger>
                <TabsTrigger value="story">Story</TabsTrigger>
              </TabsList>
              <TabsContent value="core" className="space-y-4">
                <div className="grid gap-4 md:grid-cols-2">
                  <div>
                    <Label htmlFor="name">Name *</Label>
                    <Input
                      id="name"
                      value={formState.name}
                      onChange={(event) =>
                        setFormState((prev) => ({ ...prev, name: event.target.value }))
                      }
                    />
                  </div>
                  <div>
                    <Label htmlFor="class">Class *</Label>
                    <Input
                      id="class"
                      value={formState.className}
                      onChange={(event) =>
                        setFormState((prev) => ({
                          ...prev,
                          className: event.target.value,
                        }))
                      }
                    />
                  </div>
                  <div>
                    <Label htmlFor="race">Race *</Label>
                    <Input
                      id="race"
                      value={formState.race}
                      onChange={(event) =>
                        setFormState((prev) => ({
                          ...prev,
                          race: event.target.value,
                        }))
                      }
                    />
                  </div>
                  <div>
                    <Label htmlFor="background">Background</Label>
                    <Input
                      id="background"
                      value={formState.background}
                      onChange={(event) =>
                        setFormState((prev) => ({
                          ...prev,
                          background: event.target.value,
                        }))
                      }
                    />
                  </div>
                  <div>
                    <Label htmlFor="level">Level</Label>
                    <Input
                      id="level"
                      type="number"
                      min={1}
                      max={20}
                      value={formState.level}
                      onChange={(event) =>
                        setFormState((prev) => ({
                          ...prev,
                          level: Number(event.target.value) || 1,
                        }))
                      }
                    />
                  </div>
                  <div>
                    <Label htmlFor="armorClass">Armor Class</Label>
                    <Input
                      id="armorClass"
                      type="number"
                      value={formState.armorClass}
                      onChange={(event) =>
                        setFormState((prev) => ({
                          ...prev,
                          armorClass: Number(event.target.value) || 10,
                        }))
                      }
                    />
                  </div>
                  <div>
                    <Label htmlFor="speed">Speed</Label>
                    <Input
                      id="speed"
                      type="number"
                      value={formState.speed}
                      onChange={(event) =>
                        setFormState((prev) => ({
                          ...prev,
                          speed: Number(event.target.value) || 30,
                        }))
                      }
                    />
                  </div>
                  <div>
                    <Label htmlFor="proficiency">Proficiency Bonus</Label>
                    <Input
                      id="proficiency"
                      type="number"
                      value={formState.proficiencyBonus}
                      onChange={(event) =>
                        setFormState((prev) => ({
                          ...prev,
                          proficiencyBonus: Number(event.target.value) || 2,
                        }))
                      }
                    />
                  </div>
                </div>
              </TabsContent>
              <TabsContent value="stats" className="space-y-4">
                <div className="grid gap-4 md:grid-cols-3">
                  <div>
                    <Label htmlFor="hpCurrent">Current HP</Label>
                    <Input
                      id="hpCurrent"
                      type="number"
                      value={formState.hitPointsCurrent}
                      onChange={(event) =>
                        setFormState((prev) => ({
                          ...prev,
                          hitPointsCurrent: Number(event.target.value) || 0,
                        }))
                      }
                    />
                  </div>
                  <div>
                    <Label htmlFor="hpMax">Maximum HP</Label>
                    <Input
                      id="hpMax"
                      type="number"
                      value={formState.hitPointsMax}
                      onChange={(event) =>
                        setFormState((prev) => ({
                          ...prev,
                          hitPointsMax: Number(event.target.value) || 0,
                        }))
                      }
                    />
                  </div>
                  <div>
                    <Label htmlFor="hpTemp">Temporary HP</Label>
                    <Input
                      id="hpTemp"
                      type="number"
                      value={formState.hitPointsTemporary}
                      onChange={(event) =>
                        setFormState((prev) => ({
                          ...prev,
                          hitPointsTemporary: Number(event.target.value) || 0,
                        }))
                      }
                    />
                  </div>
                </div>
                <div>
                  <Label>Ability Scores</Label>
                  <div className="mt-2 grid gap-4 md:grid-cols-3">
                    {abilityKeys.map((ability) => (
                      <div key={ability}>
                        <Label className="text-xs uppercase text-muted-foreground">
                          {abilityLabels[ability]}
                        </Label>
                        <Input
                          type="number"
                          min={1}
                          max={30}
                          value={formState.abilities[ability]}
                          onChange={(event) =>
                            setFormState((prev) => ({
                              ...prev,
                              abilities: {
                                ...prev.abilities,
                                [ability]: Number(event.target.value) || 10,
                              },
                            }))
                          }
                        />
                      </div>
                    ))}
                  </div>
                </div>
              </TabsContent>
              <TabsContent value="story" className="space-y-4">
                <div>
                  <Label htmlFor="backstory">Backstory</Label>
                  <Textarea
                    id="backstory"
                    rows={4}
                    value={formState.backstory}
                    onChange={(event) =>
                      setFormState((prev) => ({
                        ...prev,
                        backstory: event.target.value,
                      }))
                    }
                  />
                </div>
                <div>
                  <Label htmlFor="personality">Personality</Label>
                  <Textarea
                    id="personality"
                    rows={3}
                    value={formState.personality}
                    onChange={(event) =>
                      setFormState((prev) => ({
                        ...prev,
                        personality: event.target.value,
                      }))
                    }
                  />
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  <div>
                    <Label htmlFor="ideals">Ideals</Label>
                    <Textarea
                      id="ideals"
                      rows={3}
                      value={formState.ideals}
                      onChange={(event) =>
                        setFormState((prev) => ({
                          ...prev,
                          ideals: event.target.value,
                        }))
                      }
                    />
                  </div>
                  <div>
                    <Label htmlFor="bonds">Bonds</Label>
                    <Textarea
                      id="bonds"
                      rows={3}
                      value={formState.bonds}
                      onChange={(event) =>
                        setFormState((prev) => ({
                          ...prev,
                          bonds: event.target.value,
                        }))
                      }
                    />
                  </div>
                </div>
                <div>
                  <Label htmlFor="flaws">Flaws</Label>
                  <Textarea
                    id="flaws"
                    rows={3}
                    value={formState.flaws}
                    onChange={(event) =>
                      setFormState((prev) => ({
                        ...prev,
                        flaws: event.target.value,
                      }))
                    }
                  />
                </div>
              </TabsContent>
            </Tabs>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setFormOpen(false)} disabled={operationPending}>
                Cancel
              </Button>
              <Button onClick={handleSave} disabled={operationPending}>
                {operationPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {formMode === "create" ? "Create" : "Save"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={Boolean(deleteTarget)} onOpenChange={() => setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Character</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. The character "{deleteTarget?.name}" will be permanently removed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={operationPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={operationPending}
            >
              {operationPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
