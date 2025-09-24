import { useState, useEffect, useMemo, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Badge } from "./ui/badge";
import { Progress } from "./ui/progress";
import { Avatar, AvatarFallback } from "./ui/avatar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";
import { Textarea } from "./ui/textarea";
import { useWebSocket } from "../hooks/useWebSocket";
import { toast } from "sonner";
import { apiFetch, readErrorMessage, readJsonBody } from "../utils/api-client";
import {
  Sword,
  Shield,
  Heart,
  Plus,
  Minus,
  Play,
  Loader2,
  Users,
  Trash2,
} from "lucide-react";

interface InitiativeOrderEntry {
  participantId: string;
  initiative: number;
  hasActed: boolean;
}

interface Encounter {
  id: string;
  campaign_id: string;
  session_id?: string;
  location_id?: string;
  name: string;
  description: string;
  type: "combat" | "social" | "exploration" | "puzzle";
  difficulty: "easy" | "medium" | "hard" | "deadly";
  status: "planned" | "active" | "completed";
  current_round: number;
  initiative_order?: InitiativeOrderEntry[];
  participant_count: number;
  location_name?: string;
  session_title?: string;
}

interface EncounterParticipant {
  id: string;
  encounter_id: string;
  participant_id: string;
  participant_type: "character" | "npc";
  name: string;
  initiative?: number | null;
  hit_points: { max: number; current: number; temporary: number };
  armor_class: number;
  conditions: string[];
  has_acted: boolean;
}

interface Condition {
  name: string;
  description: string;
}

interface RawEncounter {
  id: string;
  campaign_id: string;
  session_id?: string | null;
  location_id?: string | null;
  name: string;
  description?: string | null;
  type: string;
  difficulty: string;
  status: string;
  current_round?: number | string | null;
  initiative_order?: InitiativeOrderEntry[] | string | null;
  participant_count?: number | string | null;
  location_name?: string | null;
  session_title?: string | null;
}

interface RawEncounterParticipant {
  id: string;
  encounter_id: string;
  participant_id: string;
  participant_type: "character" | "npc";
  name: string;
  initiative?: number | string | null;
  hit_points?: { max: number; current: number; temporary?: number } | string | null;
  armor_class?: number | string | null;
  conditions?: string[] | string | null;
  has_acted?: boolean | null;
}

interface CampaignCharacterSummary {
  id: string;
  name: string;
  class: string;
  level: number;
  hit_points?: { max: number; current: number; temporary?: number } | string | null;
  armor_class?: number | string | null;
}

const DND_CONDITIONS: Condition[] = [
  { name: "Blinded", description: "Cannot see, automatically fails any check that requires sight." },
  { name: "Charmed", description: "Cannot attack the charmer; charmer has advantage on social checks." },
  { name: "Deafened", description: "Cannot hear and automatically fails checks that require hearing." },
  { name: "Frightened", description: "Disadvantage on ability checks and attacks while source is in sight." },
  { name: "Grappled", description: "Speed becomes 0 and cannot benefit from speed bonuses." },
  { name: "Incapacitated", description: "Cannot take actions or reactions." },
  { name: "Invisible", description: "Cannot be seen without aid; advantage on attack rolls." },
  { name: "Paralyzed", description: "Incapacitated, cannot move or speak, fails Strength/Dex saves." },
  { name: "Petrified", description: "Transformed into stone; incapacitated and resistant to all damage." },
  { name: "Poisoned", description: "Disadvantage on attack rolls and ability checks." },
  { name: "Prone", description: "Crawling, disadvantage on attacks, attackers within 5 ft have advantage." },
  { name: "Restrained", description: "Speed 0, disadvantage on attacks and Dex saves." },
  { name: "Stunned", description: "Incapacitated, can’t move, fails Str/Dex saves." },
  { name: "Unconscious", description: "Incapacitated, drop prone, fail Str/Dex saves, attacks have advantage." },
  { name: "Exhaustion", description: "Suffers level-based penalties until rested." },
];

const parseNumber = (value: unknown, fallback = 0): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const parseJsonValue = <T,>(value: unknown, fallback: T): T => {
  if (value === null || value === undefined) {
    return fallback;
  }

  if (typeof value === "string") {
    try {
      return JSON.parse(value) as T;
    } catch (error) {
      console.warn("[CombatTracker] Failed to parse JSON value", { value, error });
      return fallback;
    }
  }

  return value as T;
};

const normalizeEncounter = (raw: RawEncounter): Encounter => {
  const initiativeOrderRaw = raw.initiative_order ?? [];
  const initiativeOrder = Array.isArray(initiativeOrderRaw)
    ? initiativeOrderRaw
    : parseJsonValue<InitiativeOrderEntry[]>(initiativeOrderRaw, []);

  return {
    id: raw.id,
    campaign_id: raw.campaign_id,
    session_id: raw.session_id ?? undefined,
    location_id: raw.location_id ?? undefined,
    name: raw.name,
    description: raw.description ?? "",
    type: (raw.type ?? "combat") as Encounter["type"],
    difficulty: (raw.difficulty ?? "medium") as Encounter["difficulty"],
    status: (raw.status ?? "planned") as Encounter["status"],
    current_round: parseNumber(raw.current_round, 0),
    initiative_order: initiativeOrder,
    participant_count: parseNumber(raw.participant_count, 0),
    location_name: raw.location_name ?? undefined,
    session_title: raw.session_title ?? undefined,
  };
};

const normalizeParticipant = (raw: RawEncounterParticipant): EncounterParticipant => {
  const hitPointsRaw = raw.hit_points ?? { max: 0, current: 0, temporary: 0 };
  const hitPoints = parseJsonValue(hitPointsRaw, { max: 0, current: 0, temporary: 0 });
  const conditionsRaw = raw.conditions ?? [];
  const conditions = parseJsonValue<string[]>(conditionsRaw, []);

  return {
    id: raw.id,
    encounter_id: raw.encounter_id,
    participant_id: raw.participant_id,
    participant_type: raw.participant_type,
    name: raw.name,
    initiative: raw.initiative === null || raw.initiative === undefined ? null : parseNumber(raw.initiative),
    hit_points: {
      max: parseNumber(hitPoints.max, 0),
      current: parseNumber(hitPoints.current, 0),
      temporary: parseNumber(hitPoints.temporary, 0),
    },
    armor_class: parseNumber(raw.armor_class, 10),
    conditions,
    has_acted: Boolean(raw.has_acted),
  };
};

const normalizeCampaignCharacter = (raw: Record<string, unknown>): CampaignCharacterSummary => {
  const hitPointsRaw = raw.hit_points ?? raw.hitPoints ?? null;
  const hitPoints = parseJsonValue(hitPointsRaw, { max: 0, current: 0, temporary: 0 });

  return {
    id: String(raw.id),
    name: typeof raw.name === "string" ? raw.name : "Unknown Character",
    class: typeof raw.class === "string" ? raw.class : typeof raw.character_class === "string" ? raw.character_class : "Adventurer",
    level: parseNumber(raw.level, 1),
    hit_points: hitPoints,
    armor_class: parseNumber(raw.armor_class ?? raw.armorClass, 10),
  };
};

const generateUuid = () => {
  if (typeof crypto !== "undefined") {
    if (typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
    if (typeof crypto.getRandomValues === "function") {
      const buffer = new Uint8Array(16);
      crypto.getRandomValues(buffer);
      buffer[6] = (buffer[6] & 0x0f) | 0x40;
      buffer[8] = (buffer[8] & 0x3f) | 0x80;
      const byteToHex: string[] = [];
      for (let i = 0; i < 256; ++i) {
        byteToHex.push((i + 0x100).toString(16).substring(1));
      }
      return (
        byteToHex[buffer[0]] + byteToHex[buffer[1]] + byteToHex[buffer[2]] + byteToHex[buffer[3]] + "-" +
        byteToHex[buffer[4]] + byteToHex[buffer[5]] + "-" +
        byteToHex[buffer[6]] + byteToHex[buffer[7]] + "-" +
        byteToHex[buffer[8]] + byteToHex[buffer[9]] + "-" +
        byteToHex[buffer[10]] + byteToHex[buffer[11]] + byteToHex[buffer[12]] + byteToHex[buffer[13]] + byteToHex[buffer[14]] + byteToHex[buffer[15]]
      );
    }
  }
  throw new Error("Secure random UUID generation is unavailable in this environment.");
};

const NO_CHARACTER_SELECT_VALUE = "__no_character__";

export default function CombatTracker({
  campaignId,
  sessionId,
  isDM,
}: {
  campaignId: string;
  sessionId?: string;
  isDM: boolean;
}) {
  const [encounters, setEncounters] = useState<Encounter[]>([]);
  const [activeEncounter, setActiveEncounter] = useState<Encounter | null>(null);
  const [participants, setParticipants] = useState<EncounterParticipant[]>([]);
  const [availableCharacters, setAvailableCharacters] = useState<CampaignCharacterSummary[]>([]);
  const [loadingCharacters, setLoadingCharacters] = useState(false);
  const [loading, setLoading] = useState(true);
  const [initiativeRolling, setInitiativeRolling] = useState(false);
  const [createEncounterPending, setCreateEncounterPending] = useState(false);
  const [participantSubmitting, setParticipantSubmitting] = useState(false);
  const [removingParticipantId, setRemovingParticipantId] = useState<string | null>(null);

  const { connected, updateCombat, getMessagesByType } = useWebSocket(campaignId);

  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newEncounterName, setNewEncounterName] = useState("");
  const [newEncounterDescription, setNewEncounterDescription] = useState("");
  const [newEncounterType, setNewEncounterType] = useState<"combat" | "social" | "exploration" | "puzzle">("combat");
  const [newEncounterDifficulty, setNewEncounterDifficulty] = useState<"easy" | "medium" | "hard" | "deadly">("medium");

  const [showAddParticipant, setShowAddParticipant] = useState(false);
  const [newParticipantName, setNewParticipantName] = useState("");
  const [newParticipantType, setNewParticipantType] = useState<"character" | "npc">("npc");
  const [newParticipantCharacterId, setNewParticipantCharacterId] = useState<string | null>(null);
  const [newParticipantHP, setNewParticipantHP] = useState<{ max: number; current: number; temporary: number }>({ max: 10, current: 10, temporary: 0 });
  const [newParticipantAC, setNewParticipantAC] = useState(10);

  const conditions = DND_CONDITIONS;

  const apiRequest = useCallback(async <T,>(path: string, init: RequestInit | undefined, fallback: string): Promise<T> => {
    const response = await apiFetch(path, init);
    if (!response.ok) {
      throw new Error(await readErrorMessage(response, fallback));
    }
    return readJsonBody<T>(response);
  }, []);

  const loadEncounters = useCallback(
    async (showSpinner = false, preferredEncounterId?: string) => {
      if (showSpinner) {
        setLoading(true);
      }
      try {
        const data = await apiRequest<RawEncounter[]>(`/api/campaigns/${campaignId}/encounters`, undefined, "Failed to load encounters");
        const normalized = data.map(normalizeEncounter);
        setEncounters(normalized);
        setActiveEncounter((current) => {
          if (preferredEncounterId) {
            const preferred = normalized.find((encounter) => encounter.id === preferredEncounterId);
            if (preferred) {
              return preferred;
            }
          }
          if (current) {
            const existing = normalized.find((encounter) => encounter.id === current.id);
            if (existing) {
              return existing;
            }
          }
          const activeFromList = normalized.find((encounter) => encounter.status === "active");
          return activeFromList ?? normalized[0] ?? null;
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to load encounters";
        toast.error(message);
      } finally {
        if (showSpinner) {
          setLoading(false);
        }
      }
    },
    [campaignId, apiRequest]
  );

  const loadParticipants = useCallback(
    async (encounterId: string) => {
      try {
        const data = await apiRequest<RawEncounterParticipant[]>(`/api/encounters/${encounterId}/participants`, undefined, "Failed to load participants");
        setParticipants(data.map(normalizeParticipant));
        return data;
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to load participants";
        toast.error(message);
        return [];
      }
    },
    [apiRequest]
  );

  const loadCampaignCharacters = useCallback(async () => {
    setLoadingCharacters(true);
    try {
      const data = await apiRequest<Record<string, unknown>[]>(`/api/campaigns/${campaignId}/characters`, undefined, "Failed to load campaign characters");
      setAvailableCharacters(data.map(normalizeCampaignCharacter));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to load campaign characters";
      toast.error(message);
    } finally {
      setLoadingCharacters(false);
    }
  }, [campaignId, apiRequest]);

  useEffect(() => {
    loadEncounters(true);
  }, [loadEncounters]);

  useEffect(() => {
    if (!activeEncounter) {
      setParticipants([]);
      return;
    }
    loadParticipants(activeEncounter.id);
  }, [activeEncounter?.id, loadParticipants]);

  useEffect(() => {
    if (showAddParticipant && newParticipantType === "character") {
      loadCampaignCharacters();
    }
  }, [showAddParticipant, newParticipantType, loadCampaignCharacters]);

  useEffect(() => {
    if (newParticipantType !== "character") {
      setNewParticipantCharacterId(null);
      return;
    }
    const selection = availableCharacters.find((character) => character.id === newParticipantCharacterId);
    if (selection) {
      setNewParticipantName(selection.name);
      const hitPoints = parseJsonValue(selection.hit_points, { max: 0, current: 0, temporary: 0 });
      setNewParticipantHP({
        max: parseNumber(hitPoints.max, 0),
        current: parseNumber(hitPoints.current, 0),
        temporary: parseNumber(hitPoints.temporary, 0),
      });
      setNewParticipantAC(parseNumber(selection.armor_class, 10));
    }
  }, [newParticipantType, newParticipantCharacterId, availableCharacters]);

  useEffect(() => {
    if (!activeEncounter) {
      return;
    }
    const updates = getMessagesByType("combat-update");
    if (!updates.length) {
      return;
    }
    const latest = updates[updates.length - 1];
    const payload = latest.data as {
      encounterId?: string;
      update?: {
        encounter?: RawEncounter;
        participants?: RawEncounterParticipant[];
        mode?: "merge" | "replace";
      };
    };
    if (!payload?.encounterId || payload.encounterId !== activeEncounter.id || !payload.update) {
      return;
    }
    const { update } = payload;
    if (update.encounter) {
      const normalized = normalizeEncounter(update.encounter as RawEncounter);
      setEncounters((prev) => prev.map((encounter) => (encounter.id === normalized.id ? normalized : encounter)));
      setActiveEncounter((current) => (current && current.id === normalized.id ? normalized : current));
    }
    if (Array.isArray(update.participants)) {
      const normalizedParticipants = (update.participants as RawEncounterParticipant[]).map(normalizeParticipant);
      if (update.mode === "merge") {
        setParticipants((prev) => {
          const map = new Map(prev.map((participant) => [participant.id, participant]));
          normalizedParticipants.forEach((participant) => {
            map.set(participant.id, participant);
          });
          return Array.from(map.values());
        });
      } else {
        setParticipants(normalizedParticipants);
      }
    }
  }, [activeEncounter?.id, getMessagesByType]);

  const sortedParticipants = useMemo(() => {
    if (!activeEncounter) {
      return participants;
    }
    const order = activeEncounter.initiative_order ?? [];
    if (!order.length) {
      return [...participants].sort((a, b) => (b.initiative ?? 0) - (a.initiative ?? 0));
    }
    const participantMap = new Map(participants.map((participant) => [participant.id, participant]));
    return order
      .map((entry) => {
        const participant = participantMap.get(entry.participantId);
        if (!participant) {
          return null;
        }
        return {
          ...participant,
          initiative: entry.initiative,
          has_acted: entry.hasActed,
        };
      })
      .filter(Boolean) as EncounterParticipant[];
  }, [participants, activeEncounter?.initiative_order]);

  const refreshEncounterInList = useCallback((updated: Encounter) => {
    setEncounters((prev) => prev.map((encounter) => (encounter.id === updated.id ? updated : encounter)));
  }, []);

  const handleEncounterSelection = useCallback(
    (encounterId: string) => {
      const found = encounters.find((encounter) => encounter.id === encounterId);
      if (found) {
        setActiveEncounter(found);
      }
    },
    [encounters]
  );

  const handleCreateEncounter = async () => {
    if (!newEncounterName.trim()) {
      toast.error("Encounter name is required");
      return;
    }
    setCreateEncounterPending(true);
    try {
      const payload = {
        name: newEncounterName.trim(),
        description: newEncounterDescription.trim(),
        type: newEncounterType,
        difficulty: newEncounterDifficulty,
        session_id: sessionId,
      };
      const created = await apiRequest<RawEncounter>(`/api/campaigns/${campaignId}/encounters`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }, "Failed to create encounter");
      setShowCreateForm(false);
      setNewEncounterName("");
      setNewEncounterDescription("");
      toast.success("Encounter created");
      await loadEncounters(false, created.id);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to create encounter";
      toast.error(message);
    } finally {
      setCreateEncounterPending(false);
    }
  };

  const handleOpenAddParticipant = () => {
    setShowAddParticipant(true);
    setNewParticipantName("");
    setNewParticipantType("npc");
    setNewParticipantCharacterId(null);
    setNewParticipantHP({ max: 10, current: 10, temporary: 0 });
    setNewParticipantAC(10);
  };

  const handleCancelAddParticipant = () => {
    setShowAddParticipant(false);
    setParticipantSubmitting(false);
  };

  const handleAddParticipant = async () => {
    if (!activeEncounter) {
      toast.error("Select an encounter before adding participants");
      return;
    }
    setParticipantSubmitting(true);
    try {
      let payload: {
        participant_id: string;
        participant_type: "character" | "npc";
        name: string;
        hit_points: { max: number; current: number; temporary: number };
        armor_class: number;
      };

      if (newParticipantType === "character") {
        if (!newParticipantCharacterId) {
          throw new Error("Select a character to add");
        }
        const selection = availableCharacters.find((character) => character.id === newParticipantCharacterId);
        if (!selection) {
          throw new Error("Selected character is no longer available");
        }
        const hitPoints = parseJsonValue(selection.hit_points, { max: 0, current: 0, temporary: 0 });
        payload = {
          participant_id: selection.id,
          participant_type: "character",
          name: selection.name,
          hit_points: {
            max: parseNumber(hitPoints.max, 0),
            current: parseNumber(hitPoints.current, 0),
            temporary: parseNumber(hitPoints.temporary, 0),
          },
          armor_class: parseNumber(selection.armor_class, 10),
        };
      } else {
        if (!newParticipantName.trim()) {
          throw new Error("Participant name is required");
        }
        payload = {
          participant_id: generateUuid(),
          participant_type: "npc",
          name: newParticipantName.trim(),
          hit_points: {
            max: parseNumber(newParticipantHP.max, 0),
            current: Math.max(0, Math.min(parseNumber(newParticipantHP.max, 0), parseNumber(newParticipantHP.current, 0))),
            temporary: parseNumber(newParticipantHP.temporary, 0),
          },
          armor_class: parseNumber(newParticipantAC, 10),
        };
      }

      await apiRequest<RawEncounterParticipant>(`/api/encounters/${activeEncounter.id}/participants`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }, "Failed to add participant");

      const updatedList = await loadParticipants(activeEncounter.id);
      const refreshedEncounter = await apiRequest<RawEncounter>(`/api/encounters/${activeEncounter.id}`, undefined, "Failed to refresh encounter");
      const normalizedEncounter = normalizeEncounter(refreshedEncounter);
      refreshEncounterInList(normalizedEncounter);
      setActiveEncounter(normalizedEncounter);

      setShowAddParticipant(false);
      setNewParticipantName("");
      setNewParticipantType("npc");
      setNewParticipantCharacterId(null);
      setNewParticipantHP({ max: 10, current: 10, temporary: 0 });
      setNewParticipantAC(10);

      toast.success("Participant added");

      if (connected) {
        updateCombat(activeEncounter.id, {
          encounter: refreshedEncounter,
          participants: updatedList,
          mode: "replace",
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to add participant";
      toast.error(message);
    } finally {
      setParticipantSubmitting(false);
    }
  };

  const updateParticipantRemote = useCallback(
    async (participantId: string, updates: Record<string, unknown>, fallback: string) => {
      try {
        const updated = await apiRequest<RawEncounterParticipant>(`/api/encounter-participants/${participantId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(updates),
        }, fallback);
        const normalized = normalizeParticipant(updated);
        setParticipants((prev) => prev.map((participant) => (participant.id === normalized.id ? normalized : participant)));
        if (activeEncounter && connected) {
          updateCombat(activeEncounter.id, {
            participants: [updated],
            mode: "merge",
          });
        }
        return normalized;
      } catch (error) {
        const message = error instanceof Error ? error.message : fallback;
        toast.error(message);
        return null;
      }
    },
    [apiRequest, activeEncounter, connected, updateCombat]
  );

  const handleHpDelta = async (participantId: string, delta: number) => {
    const target = participants.find((participant) => participant.id === participantId);
    if (!target) {
      return;
    }
    const updatedHp = {
      max: target.hit_points.max,
      current: Math.max(0, Math.min(target.hit_points.max, target.hit_points.current + delta)),
      temporary: target.hit_points.temporary,
    };
    await updateParticipantRemote(participantId, { hit_points: updatedHp }, "Failed to update hit points");
  };

  const handleConditionAdd = async (participantId: string, condition: string) => {
    const target = participants.find((participant) => participant.id === participantId);
    if (!target || target.conditions.includes(condition)) {
      return;
    }
    const updatedConditions = [...target.conditions, condition];
    await updateParticipantRemote(participantId, { conditions: updatedConditions }, "Failed to add condition");
  };

  const handleConditionRemove = async (participantId: string, condition: string) => {
    const target = participants.find((participant) => participant.id === participantId);
    if (!target) {
      return;
    }
    const updatedConditions = target.conditions.filter((item) => item !== condition);
    await updateParticipantRemote(participantId, { conditions: updatedConditions }, "Failed to remove condition");
  };

  const handleRemoveParticipant = async (participantId: string) => {
    if (!activeEncounter) {
      return;
    }
    setRemovingParticipantId(participantId);
    try {
      await apiRequest<{ message: string }>(`/api/encounter-participants/${participantId}`, { method: "DELETE" }, "Failed to remove participant");
      const updatedList = await loadParticipants(activeEncounter.id);
      const refreshedEncounter = await apiRequest<RawEncounter>(`/api/encounters/${activeEncounter.id}`, undefined, "Failed to refresh encounter");
      const normalizedEncounter = normalizeEncounter(refreshedEncounter);
      refreshEncounterInList(normalizedEncounter);
      setActiveEncounter(normalizedEncounter);
      toast.success("Participant removed");
      if (connected) {
        updateCombat(activeEncounter.id, {
          encounter: refreshedEncounter,
          participants: updatedList,
          mode: "replace",
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to remove participant";
      toast.error(message);
    } finally {
      setRemovingParticipantId(null);
    }
  };

  const handleRollInitiative = async () => {
    if (!activeEncounter) {
      toast.error("Select an encounter before rolling initiative");
      return;
    }
    setInitiativeRolling(true);
    try {
      const response = await apiRequest<{ encounter: RawEncounter; participants: RawEncounterParticipant[] }>(`/api/encounters/${activeEncounter.id}/initiative`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      }, "Failed to roll initiative");
      const normalizedEncounter = normalizeEncounter(response.encounter);
      const normalizedParticipants = response.participants.map(normalizeParticipant);
      refreshEncounterInList(normalizedEncounter);
      setActiveEncounter(normalizedEncounter);
      setParticipants(normalizedParticipants);
      toast.success("Initiative rolled");
      if (connected) {
        updateCombat(normalizedEncounter.id, {
          encounter: response.encounter,
          participants: response.participants,
          mode: "replace",
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to roll initiative";
      toast.error(message);
    } finally {
      setInitiativeRolling(false);
    }
  };

  const handleNextTurn = async () => {
    if (!activeEncounter || !activeEncounter.initiative_order || !activeEncounter.initiative_order.length) {
      toast.error("Roll initiative before advancing turns");
      return;
    }
    const order = activeEncounter.initiative_order.map((entry) => ({ ...entry }));
    const nextIndex = order.findIndex((entry) => !entry.hasActed);
    let payload: Record<string, unknown>;
    if (nextIndex === -1) {
      order.forEach((entry) => {
        entry.hasActed = false;
      });
      payload = {
        current_round: activeEncounter.current_round + 1,
        initiative_order: order,
      };
    } else {
      order[nextIndex].hasActed = true;
      payload = { initiative_order: order };
    }
    try {
      const updated = await apiRequest<RawEncounter>(`/api/encounters/${activeEncounter.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }, "Failed to advance turn");
      const normalizedEncounter = normalizeEncounter(updated);
      refreshEncounterInList(normalizedEncounter);
      setActiveEncounter(normalizedEncounter);
      if (connected) {
        updateCombat(normalizedEncounter.id, {
          encounter: updated,
          mode: "replace",
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to advance turn";
      toast.error(message);
    }
  };

  if (loading) {
    return (
      <div className="flex h-48 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Tabs defaultValue="encounters" className="w-full">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="encounters">Encounters</TabsTrigger>
          <TabsTrigger value="combat" className="flex items-center gap-2">
            Active Combat
            {connected && activeEncounter && (
              <span className="h-2 w-2 animate-pulse rounded-full bg-green-500" title="Live sync active" />
            )}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="encounters">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-2">
                  <Sword className="h-5 w-5" />
                  Encounters
                </CardTitle>
                {isDM && (
                  <Button onClick={() => setShowCreateForm(true)}>
                    <Plus className="mr-2 h-4 w-4" />
                    Create Encounter
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {encounters.length === 0 ? (
                  <p className="py-8 text-center text-muted-foreground">No encounters created yet.</p>
                ) : (
                  encounters.map((encounter) => {
                    const isActive = activeEncounter?.id === encounter.id;
                    return (
                      <Card
                        key={encounter.id}
                        className={`p-4 transition ${isActive ? "border-primary shadow-sm" : "border-muted"}`}
                      >
                        <div className="flex items-start justify-between">
                          <div className="space-y-1">
                            <div className="flex items-center gap-2">
                              <h3 className="font-medium">{encounter.name}</h3>
                              <Badge variant={encounter.status === "active" ? "default" : "secondary"}>
                                {encounter.status}
                              </Badge>
                              <Badge variant="outline">{encounter.difficulty}</Badge>
                            </div>
                            <p className="text-sm text-muted-foreground">
                              {encounter.description || "No description provided."}
                            </p>
                            <div className="text-xs text-muted-foreground">
                              {encounter.participant_count} participants • Round {encounter.current_round}
                            </div>
                          </div>
                          <div className="flex gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleEncounterSelection(encounter.id)}
                            >
                              <Users className="mr-1 h-4 w-4" />
                              View
                            </Button>
                            {encounter.status === "planned" && isDM && (
                              <Button size="sm" onClick={() => handleEncounterSelection(encounter.id)}>
                                <Play className="mr-1 h-4 w-4" />
                                Prepare
                              </Button>
                            )}
                          </div>
                        </div>
                      </Card>
                    );
                  })
                )}
              </div>
            </CardContent>
          </Card>

          {showCreateForm && (
            <Card className="mt-4">
              <CardHeader>
                <CardTitle>Create New Encounter</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <label className="text-sm font-medium">Name</label>
                  <Input
                    value={newEncounterName}
                    onChange={(event) => setNewEncounterName(event.target.value)}
                    placeholder="Encounter name"
                    disabled={createEncounterPending}
                  />
                </div>
                <div>
                  <label className="text-sm font-medium">Description</label>
                  <Textarea
                    value={newEncounterDescription}
                    onChange={(event) => setNewEncounterDescription(event.target.value)}
                    placeholder="Encounter description"
                    disabled={createEncounterPending}
                  />
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  <div>
                    <label className="text-sm font-medium">Type</label>
                    <Select
                      value={newEncounterType}
                      onValueChange={(value) => setNewEncounterType(value as typeof newEncounterType)}
                      disabled={createEncounterPending}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="combat">Combat</SelectItem>
                        <SelectItem value="social">Social</SelectItem>
                        <SelectItem value="exploration">Exploration</SelectItem>
                        <SelectItem value="puzzle">Puzzle</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <label className="text-sm font-medium">Difficulty</label>
                    <Select
                      value={newEncounterDifficulty}
                      onValueChange={(value) => setNewEncounterDifficulty(value as typeof newEncounterDifficulty)}
                      disabled={createEncounterPending}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="easy">Easy</SelectItem>
                        <SelectItem value="medium">Medium</SelectItem>
                        <SelectItem value="hard">Hard</SelectItem>
                        <SelectItem value="deadly">Deadly</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button onClick={handleCreateEncounter} disabled={!newEncounterName.trim() || createEncounterPending}>
                    {createEncounterPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Create
                  </Button>
                  <Button variant="outline" onClick={() => setShowCreateForm(false)} disabled={createEncounterPending}>
                    Cancel
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="combat">
          {!activeEncounter ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12">
                <Sword className="mb-4 h-12 w-12 text-muted-foreground" />
                <p className="text-center text-muted-foreground">Select an encounter to manage combat.</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-6">
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle className="flex items-center gap-2">
                        <Sword className="h-5 w-5" />
                        {activeEncounter.name}
                      </CardTitle>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {activeEncounter.description || "No description provided."}
                      </p>
                    </div>
                    <div className="flex items-center gap-4">
                      <Badge variant="outline" className="px-3 py-1 text-lg">
                        Round {activeEncounter.current_round}
                      </Badge>
                      {isDM && (
                        <div className="flex gap-2">
                          <Button onClick={handleOpenAddParticipant}>
                            <Plus className="mr-2 h-4 w-4" />
                            Add Combatant
                          </Button>
                          <Button onClick={handleRollInitiative} disabled={initiativeRolling || participants.length === 0}>
                            {initiativeRolling && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            Roll Initiative
                          </Button>
                          <Button
                            onClick={handleNextTurn}
                            variant="outline"
                            disabled={!activeEncounter.initiative_order?.length}
                          >
                            Next Turn
                          </Button>
                        </div>
                      )}
                    </div>
                  </div>
                </CardHeader>
              </Card>

              {!!activeEncounter.initiative_order?.length && (
                <Card>
                  <CardHeader>
                    <CardTitle>Initiative Order</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {sortedParticipants.map((participant, index) => (
                      <div
                        key={participant.id}
                        className={`rounded-lg border p-4 ${!participant.has_acted ? "bg-accent ring-2 ring-primary" : ""}`}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <div className="text-2xl font-bold text-muted-foreground">{index + 1}</div>
                            <Avatar>
                              <AvatarFallback className={participant.participant_type === "character" ? "bg-blue-100" : "bg-red-100"}>
                                {participant.name.slice(0, 2)}
                              </AvatarFallback>
                            </Avatar>
                            <div>
                              <div className="flex items-center gap-2">
                                <span className="font-medium">{participant.name}</span>
                                {participant.participant_type === "character" && <Badge variant="secondary">Player</Badge>}
                              </div>
                              <div className="flex items-center gap-3 text-sm text-muted-foreground">
                                <span>Initiative: {participant.initiative ?? "—"}</span>
                                <span className="flex items-center gap-1">
                                  <Shield className="h-3 w-3" />
                                  {participant.armor_class}
                                </span>
                              </div>
                            </div>
                          </div>
                          <div className="flex items-center gap-3">
                            <div className="flex items-center gap-2">
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleHpDelta(participant.id, -1)}
                                disabled={!isDM}
                              >
                                <Minus className="h-4 w-4" />
                              </Button>
                              <div className="min-w-16 text-center">
                                <div className="flex items-center justify-center gap-1">
                                  <Heart className="h-4 w-4" />
                                  <span className="font-medium">
                                    {participant.hit_points.current}/{participant.hit_points.max}
                                  </span>
                                </div>
                                <Progress
                                  value={
                                    participant.hit_points.max === 0
                                      ? 0
                                      : (participant.hit_points.current / participant.hit_points.max) * 100
                                  }
                                  className="h-2 w-16"
                                />
                              </div>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleHpDelta(participant.id, 1)}
                                disabled={!isDM}
                              >
                                <Plus className="h-4 w-4" />
                              </Button>
                            </div>
                            {isDM && (
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => handleRemoveParticipant(participant.id)}
                                disabled={removingParticipantId === participant.id}
                              >
                                {removingParticipantId === participant.id ? (
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                  <Trash2 className="h-4 w-4" />
                                )}
                              </Button>
                            )}
                          </div>
                        </div>

                        {participant.conditions.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-1">
                            {participant.conditions.map((condition) => (
                              <Badge
                                key={`${participant.id}-${condition}`}
                                variant="secondary"
                                className="cursor-pointer text-xs"
                                onClick={() => isDM && handleConditionRemove(participant.id, condition)}
                              >
                                {condition}
                              </Badge>
                            ))}
                          </div>
                        )}

                        {isDM && (
                          <div className="mt-2 flex flex-wrap gap-1">
                            {conditions.map((condition) => (
                              <Button
                                key={condition.name}
                                variant="ghost"
                                size="sm"
                                className="h-6 px-2 text-xs"
                                onClick={() => handleConditionAdd(participant.id, condition.name)}
                              >
                                +{condition.name}
                              </Button>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </CardContent>
                </Card>
              )}

              {showAddParticipant && (
                <Card>
                  <CardHeader>
                    <CardTitle>Add Combatant</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid gap-4 md:grid-cols-2">
                      <div>
                        <label className="text-sm font-medium">Type</label>
                        <Select
                          value={newParticipantType}
                          onValueChange={(value) => setNewParticipantType(value as typeof newParticipantType)}
                          disabled={participantSubmitting}
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="character">Character</SelectItem>
                            <SelectItem value="npc">NPC</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <label className="text-sm font-medium">Name</label>
                        <Input
                          value={newParticipantName}
                          onChange={(event) => setNewParticipantName(event.target.value)}
                          placeholder="Combatant name"
                          readOnly={newParticipantType === "character"}
                          disabled={participantSubmitting}
                        />
                      </div>
                    </div>
                    {newParticipantType === "character" && (
                      <div className="space-y-2">
                        <label className="text-sm font-medium">Campaign Character</label>
                        <Select
                          value={newParticipantCharacterId ?? NO_CHARACTER_SELECT_VALUE}
                          onValueChange={(value) =>
                            setNewParticipantCharacterId(
                              value === NO_CHARACTER_SELECT_VALUE ? null : value,
                            )
                          }
                          disabled={participantSubmitting || loadingCharacters}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder={loadingCharacters ? "Loading characters..." : "Select character"} />
                          </SelectTrigger>
                          <SelectContent>
                            {availableCharacters.length === 0 && !loadingCharacters ? (
                              <SelectItem value={NO_CHARACTER_SELECT_VALUE} disabled>
                                No characters available
                              </SelectItem>
                            ) : (
                              availableCharacters.map((character) => (
                                <SelectItem key={character.id} value={character.id}>
                                  {character.name} — Level {character.level} {character.class}
                                </SelectItem>
                              ))
                            )}
                          </SelectContent>
                        </Select>
                      </div>
                    )}
                    <div className="grid gap-4 md:grid-cols-3">
                      <div>
                        <label className="text-sm font-medium">Max HP</label>
                        <Input
                          type="number"
                          value={newParticipantHP.max}
                          onChange={(event) =>
                            setNewParticipantHP((prev) => ({
                              ...prev,
                              max: parseNumber(event.target.value, 0),
                              current: parseNumber(event.target.value, 0),
                            }))
                          }
                          disabled={newParticipantType === "character" || participantSubmitting}
                        />
                      </div>
                      <div>
                        <label className="text-sm font-medium">Current HP</label>
                        <Input
                          type="number"
                          value={newParticipantHP.current}
                          onChange={(event) =>
                            setNewParticipantHP((prev) => ({
                              ...prev,
                              current: parseNumber(event.target.value, 0),
                            }))
                          }
                          disabled={newParticipantType === "character" || participantSubmitting}
                        />
                      </div>
                      <div>
                        <label className="text-sm font-medium">Armor Class</label>
                        <Input
                          type="number"
                          value={newParticipantAC}
                          onChange={(event) => setNewParticipantAC(parseNumber(event.target.value, 10))}
                          disabled={newParticipantType === "character" || participantSubmitting}
                        />
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        onClick={handleAddParticipant}
                        disabled={
                          participantSubmitting ||
                          (newParticipantType === "npc" && !newParticipantName.trim()) ||
                          (newParticipantType === "character" && !newParticipantCharacterId)
                        }
                      >
                        {participantSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        Add
                      </Button>
                      <Button variant="outline" onClick={handleCancelAddParticipant} disabled={participantSubmitting}>
                        Cancel
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
