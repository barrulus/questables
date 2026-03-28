import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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

import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { ScrollArea } from "./ui/scroll-area";
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
import { cn } from "./ui/utils";
import { CharacterDetailView } from "./character-detail-view";
import { CharacterEditDialog, type CharacterFormState } from "./character-edit-dialog";

export interface CharacterManagerCommand {
  type: "create" | "edit";
  token: number;
  characterId?: string;
}

interface CharacterManagerProps {
  command?: CharacterManagerCommand | null;
  onCharactersChanged?: () => void;
  /** Called when the create/edit form dialog is closed (cancelled or saved). */
  onFormClosed?: () => void;
}

const abilityKeys = [
  "strength",
  "dexterity",
  "constitution",
  "intelligence",
  "wisdom",
  "charisma",
] as const;


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

const formatDate = (value?: string | Date | null) => {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString();
};

type SortOption = "updated" | "name" | "level";

type LoadMode = "initial" | "refresh";

export function CharacterManager({ command, onCharactersChanged, onFormClosed }: CharacterManagerProps) {
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
  const formInitialStateRef = useRef<CharacterFormState>(emptyFormState);

  const isFormDirty = () =>
    JSON.stringify(formState) !== JSON.stringify(formInitialStateRef.current);

  const handleFormClose = (open: boolean) => {
    if (!open && isFormDirty()) {
      if (!window.confirm("You have unsaved changes. Discard them?")) return;
    }
    setFormOpen(open);
    if (!open) {
      onFormClosed?.();
    }
  };
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
    formInitialStateRef.current = emptyFormState;
    setSelectedCharacterId(null);
    setFormOpen(true);
  };

  const openEditDialog = (character: Character) => {
    setFormMode("edit");
    const initial = mapCharacterToForm(character);
    setFormState(initial);
    formInitialStateRef.current = initial;
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
      formInitialStateRef.current = emptyFormState;
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
      const initial = mapCharacterToForm(target);
      setFormState(initial);
      formInitialStateRef.current = initial;
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
      onFormClosed?.();
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

  // Detail view extracted to CharacterDetailView component

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
          <CharacterDetailView character={selectedCharacter} />
        </div>
      </div>

      <CharacterEditDialog
        open={formOpen}
        onOpenChange={handleFormClose}
        formState={formState}
        onFormStateChange={setFormState}
        mode={formMode}
        saving={operationPending}
        onSave={handleSave}
        onCancel={() => handleFormClose(false)}
      />

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
