import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Loader2, MapPin, Sparkles, Compass, Target, Users, FileText } from "lucide-react";
import { useGameSession } from "../contexts/GameSessionContext";
import { useUser } from "../contexts/UserContext";
import {
  fetchJson,
  listCampaignSpawns,
  updateSessionFocus,
  updateSessionContext,
  createUnplannedEncounter,
  adjustNpcSentiment,
  teleportPlayer,
  teleportNpc,
  HttpError,
  type SpawnPoint,
  type EncounterRecord,
  type NpcMemoryRecord,
  type TeleportPlayerResponse,
  type TeleportNpcResponse,
  type UnplannedEncounterType,
  type EncounterDifficulty,
  type NpcSentiment,
} from "../utils/api-client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "./ui/card";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";
import { Label } from "./ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { ScrollArea } from "./ui/scroll-area";
import { Alert, AlertDescription, AlertTitle } from "./ui/alert";
import { Badge } from "./ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";
import { RadioGroup, RadioGroupItem } from "./ui/radio-group";

interface SessionSidebarRecord {
  id: string;
  sessionNumber: number | null;
  title: string;
  status: string;
  dmFocus: string | null;
  dmContextMd: string | null;
}

interface NpcOption {
  id: string;
  name: string;
  role?: string | null;
  locationName?: string | null;
}

interface PlayerOption {
  id: string; // campaign_player_id
  characterId: string;
  name: string;
  role: string | null;
  visibilityState: string | null;
}

interface LocationOption {
  id: string;
  name: string;
  type: string | null;
}

type SessionFetchRow = Record<string, unknown>;
type LocationFetchRow = Record<string, unknown>;
type NpcFetchRow = Record<string, unknown>;
type PlayerFetchRow = Record<string, unknown>;

const ENCOUNTER_TYPES: { value: UnplannedEncounterType; label: string }[] = [
  { value: "combat", label: "Combat" },
  { value: "social", label: "Social" },
  { value: "exploration", label: "Exploration" },
  { value: "puzzle", label: "Puzzle" },
  { value: "rumour", label: "Rumour" },
];

const ENCOUNTER_DIFFICULTIES: { value: EncounterDifficulty; label: string }[] = [
  { value: "easy", label: "Easy" },
  { value: "medium", label: "Medium" },
  { value: "hard", label: "Hard" },
  { value: "deadly", label: "Deadly" },
];

const SENTIMENT_OPTIONS: { value: "auto" | NpcSentiment; label: string }[] = [
  { value: "auto", label: "Auto-detect from delta" },
  { value: "positive", label: "Positive" },
  { value: "neutral", label: "Neutral" },
  { value: "mixed", label: "Mixed" },
  { value: "negative", label: "Negative" },
];

const NONE_VALUE = "__none__";
const NO_SESSION_VALUE = "__no_session__";

const parseString = (value: unknown): string | null =>
  typeof value === "string" && value.trim().length > 0 ? value : null;

const parseNumber = (value: unknown): number | null => {
  if (value === null || value === undefined) return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

const normalizeSessionRow = (row: SessionFetchRow): SessionSidebarRecord | null => {
  const id = parseString(row.id);
  if (!id) return null;

  const sessionNumber = parseNumber(row.session_number ?? row.sessionNumber);
  const title = parseString(row.title) ?? "Untitled session";
  const status = parseString(row.status)?.toLowerCase() ?? "unknown";
  const dmFocus = Object.prototype.hasOwnProperty.call(row, "dm_focus")
    ? (row.dm_focus as string | null)
    : (row.dmFocus as string | null | undefined) ?? null;
  const dmContextMd = Object.prototype.hasOwnProperty.call(row, "dm_context_md")
    ? (row.dm_context_md as string | null)
    : (row.dmContextMd as string | null | undefined) ?? null;

  return {
    id,
    sessionNumber: sessionNumber,
    title,
    status,
    dmFocus: typeof dmFocus === "string" ? dmFocus : null,
    dmContextMd: typeof dmContextMd === "string" ? dmContextMd : null,
  };
};

const normalizeNpcRow = (row: NpcFetchRow): NpcOption | null => {
  const id = parseString(row.id);
  if (!id) return null;

  const name = parseString(row.name) ?? "Unnamed NPC";
  const role = parseString(row.role ?? row.title ?? row.occupation) ?? null;
  const locationName = parseString(row.location_name ?? row.current_location_name ?? row.locationName) ?? null;

  return { id, name, role, locationName };
};

const normalizeLocationRow = (row: LocationFetchRow): LocationOption | null => {
  const id = parseString(row.id);
  if (!id) return null;

  const name = parseString(row.name) ?? "Unnamed location";
  const type = parseString(row.type) ?? null;
  return { id, name, type };
};

const normalizePlayerRow = (row: PlayerFetchRow): PlayerOption | null => {
  const playerId = parseString(row.campaign_player_id ?? row.campaignPlayerId ?? row.player_id);
  if (!playerId) return null;

  const name = parseString(row.name) ?? "Unnamed character";
  const characterId = parseString(row.id ?? row.character_id ?? row.characterId) ?? playerId;
  const role = parseString(row.role) ?? null;
  const visibilityState = parseString(row.visibility_state ?? row.visibilityState) ?? null;

  return {
    id: playerId,
    characterId,
    name,
    role,
    visibilityState,
  };
};

const formatSessionLabel = (session: SessionSidebarRecord): string => {
  const parts = [] as string[];
  if (session.sessionNumber !== null) {
    parts.push(`Session ${session.sessionNumber}`);
  }
  if (session.title) {
    parts.push(session.title);
  }
  if (session.status && session.status !== "unknown") {
    parts.push(`(${session.status})`);
  }
  return parts.join(" · ") || session.id;
};

const describeError = (error: unknown, fallback: string): string => {
  if (error instanceof HttpError) {
    return error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return fallback;
};

export function DMSidebar() {
  const { activeCampaignId, latestSession } = useGameSession();
  const { user } = useUser();

  const [sessions, setSessions] = useState<SessionSidebarRecord[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [sessionsError, setSessionsError] = useState<string | null>(null);

  const [selectedSessionId, setSelectedSessionId] = useState<string>(latestSession?.id ?? NO_SESSION_VALUE);

  const [focusDraft, setFocusDraft] = useState("");
  const [focusPending, setFocusPending] = useState(false);
  const [focusFeedback, setFocusFeedback] = useState<{ focus: string | null; updatedAt: string } | null>(null);
  const [focusError, setFocusError] = useState<string | null>(null);

  const [contextMode, setContextMode] = useState<"replace" | "append">("replace");
  const [contextDraft, setContextDraft] = useState("");
  const [contextPending, setContextPending] = useState(false);
  const [contextFeedback, setContextFeedback] = useState<{ mode: "replace" | "append"; updatedAt: string; length: number } | null>(null);
  const [contextError, setContextError] = useState<string | null>(null);

  const [locations, setLocations] = useState<LocationOption[]>([]);
  const [locationsLoading, setLocationsLoading] = useState(false);
  const [locationsError, setLocationsError] = useState<string | null>(null);
  const [encounterLocationId, setEncounterLocationId] = useState<string>(NONE_VALUE);

  const [npcs, setNpcs] = useState<NpcOption[]>([]);
  const [npcsLoading, setNpcsLoading] = useState(false);
  const [npcsError, setNpcsError] = useState<string | null>(null);

  const [spawns, setSpawns] = useState<SpawnPoint[]>([]);
  const [spawnsLoading, setSpawnsLoading] = useState(false);
  const [spawnsError, setSpawnsError] = useState<string | null>(null);

  const [players, setPlayers] = useState<PlayerOption[]>([]);
  const [playersLoading, setPlayersLoading] = useState(false);
  const [playersError, setPlayersError] = useState<string | null>(null);

  const [encounterType, setEncounterType] = useState<UnplannedEncounterType>("combat");
  const [encounterDifficulty, setEncounterDifficulty] = useState<EncounterDifficulty>("medium");
  const [encounterSeed, setEncounterSeed] = useState("");
  const [encounterPending, setEncounterPending] = useState(false);
  const [encounterFeedback, setEncounterFeedback] = useState<EncounterRecord | null>(null);
  const [encounterError, setEncounterError] = useState<string | null>(null);

  const [sentimentNpcId, setSentimentNpcId] = useState<string>(NONE_VALUE);
  const sentimentSessionTouchedRef = useRef(false);
  const [sentimentSessionId, setSentimentSessionId] = useState<string>(latestSession?.id ?? NONE_VALUE);
  const [sentimentDelta, setSentimentDelta] = useState("0");
  const [sentimentSummary, setSentimentSummary] = useState("");
  const [sentimentChoice, setSentimentChoice] = useState<"auto" | NpcSentiment>("auto");
  const [sentimentTags, setSentimentTags] = useState("");
  const [sentimentPending, setSentimentPending] = useState(false);
  const [sentimentFeedback, setSentimentFeedback] = useState<NpcMemoryRecord | null>(null);
  const [sentimentError, setSentimentError] = useState<string | null>(null);

  const [teleportPlayerMode, setTeleportPlayerMode] = useState<"spawn" | "coordinates">("spawn");
  const teleportSpawnTouchedRef = useRef(false);
  const [teleportSpawnId, setTeleportSpawnId] = useState<string>("");
  const [teleportPlayerId, setTeleportPlayerId] = useState<string>(NONE_VALUE);
  const [teleportPlayerX, setTeleportPlayerX] = useState("");
  const [teleportPlayerY, setTeleportPlayerY] = useState("");
  const [teleportPlayerReason, setTeleportPlayerReason] = useState("");
  const [teleportPlayerPending, setTeleportPlayerPending] = useState(false);
  const [teleportPlayerFeedback, setTeleportPlayerFeedback] = useState<TeleportPlayerResponse | null>(null);
  const [teleportPlayerError, setTeleportPlayerError] = useState<string | null>(null);

  const [teleportNpcMode, setTeleportNpcMode] = useState<"location" | "coordinates">("location");
  const [teleportNpcId, setTeleportNpcId] = useState<string>(NONE_VALUE);
  const [teleportNpcLocationId, setTeleportNpcLocationId] = useState<string>(NONE_VALUE);
  const [teleportNpcX, setTeleportNpcX] = useState("");
  const [teleportNpcY, setTeleportNpcY] = useState("");
  const [teleportNpcReason, setTeleportNpcReason] = useState("");
  const [teleportNpcPending, setTeleportNpcPending] = useState(false);
  const [teleportNpcFeedback, setTeleportNpcFeedback] = useState<TeleportNpcResponse | null>(null);
  const [teleportNpcError, setTeleportNpcError] = useState<string | null>(null);

  const selectedSession = useMemo(
    () => sessions.find((session) => session.id === selectedSessionId) ?? null,
    [sessions, selectedSessionId],
  );

  useEffect(() => {
    if (selectedSession) {
      setFocusDraft(selectedSession.dmFocus ?? "");
      if (contextMode === "replace") {
        setContextDraft(selectedSession.dmContextMd ?? "");
      }
    } else {
      setFocusDraft("");
      if (contextMode === "replace") {
        setContextDraft("");
      }
    }
    setFocusFeedback(null);
    setFocusError(null);
    setContextFeedback(null);
    setContextError(null);
  }, [selectedSession, contextMode]);

  useEffect(() => {
    if (contextMode === "append") {
      setContextDraft("");
    } else if (selectedSession) {
      setContextDraft(selectedSession.dmContextMd ?? "");
    }
    setContextFeedback(null);
    setContextError(null);
  }, [contextMode, selectedSession]);

  useEffect(() => {
    if (!sentimentSessionTouchedRef.current) {
      setSentimentSessionId(selectedSession?.id ?? NONE_VALUE);
    }
  }, [selectedSession]);

  useEffect(() => {
    if (!activeCampaignId) {
      setSessions([]);
      setSelectedSessionId(NO_SESSION_VALUE);
      return;
    }

    const controller = new AbortController();
    setSessionsLoading(true);
    setSessionsError(null);

    fetchJson<SessionFetchRow[] | undefined>(
      `/api/campaigns/${activeCampaignId}/sessions`,
      { signal: controller.signal },
      "Failed to load sessions",
    )
      .then((rows) => {
        if (controller.signal.aborted) return;
        const normalized = (rows ?? [])
          .map((row) => normalizeSessionRow(row))
          .filter((item): item is SessionSidebarRecord => Boolean(item));

        setSessions(normalized);

        setSelectedSessionId((current) => {
          if (current !== NO_SESSION_VALUE && normalized.some((session) => session.id === current)) {
            return current;
          }
          if (latestSession?.id && normalized.some((session) => session.id === latestSession.id)) {
            return latestSession.id;
          }
          return normalized[0]?.id ?? NO_SESSION_VALUE;
        });
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        const message = describeError(error, "Failed to load sessions");
        setSessionsError(message);
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setSessionsLoading(false);
        }
      });

    return () => controller.abort();
  }, [activeCampaignId, latestSession?.id]);

  useEffect(() => {
    if (!activeCampaignId) {
      setLocations([]);
      setLocationsError(null);
      return;
    }

    const controller = new AbortController();
    setLocationsLoading(true);
    setLocationsError(null);

    fetchJson<LocationFetchRow[] | undefined>(
      `/api/campaigns/${activeCampaignId}/locations`,
      { signal: controller.signal },
      "Failed to load locations",
    )
      .then((rows) => {
        if (controller.signal.aborted) return;
        const normalized = (rows ?? [])
          .map((row) => normalizeLocationRow(row))
          .filter((item): item is LocationOption => Boolean(item));
        setLocations(normalized);
        setEncounterLocationId((current) => (current !== NONE_VALUE && normalized.some((loc) => loc.id === current) ? current : NONE_VALUE));
        setTeleportNpcLocationId((current) => (current !== NONE_VALUE && normalized.some((loc) => loc.id === current) ? current : NONE_VALUE));
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        const message = describeError(error, "Failed to load locations");
        setLocationsError(message);
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLocationsLoading(false);
        }
      });

    return () => controller.abort();
  }, [activeCampaignId]);

  useEffect(() => {
    if (!activeCampaignId) {
      setNpcs([]);
      setNpcsError(null);
      return;
    }

    const controller = new AbortController();
    setNpcsLoading(true);
    setNpcsError(null);

    fetchJson<NpcFetchRow[] | undefined>(
      `/api/campaigns/${activeCampaignId}/npcs`,
      { signal: controller.signal },
      "Failed to load NPCs",
    )
      .then((rows) => {
        if (controller.signal.aborted) return;
        const normalized = (rows ?? [])
          .map((row) => normalizeNpcRow(row))
          .filter((item): item is NpcOption => Boolean(item));
        setNpcs(normalized);
        setSentimentNpcId((current) => (current !== NONE_VALUE && normalized.some((npc) => npc.id === current) ? current : NONE_VALUE));
        setTeleportNpcId((current) => (current !== NONE_VALUE && normalized.some((npc) => npc.id === current) ? current : NONE_VALUE));
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        const message = describeError(error, "Failed to load NPCs");
        setNpcsError(message);
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setNpcsLoading(false);
        }
      });

    return () => controller.abort();
  }, [activeCampaignId]);

  useEffect(() => {
    if (!activeCampaignId) {
      setSpawns([]);
      setTeleportSpawnId("");
      return;
    }

    const controller = new AbortController();
    setSpawnsLoading(true);
    setSpawnsError(null);

    listCampaignSpawns(activeCampaignId, { signal: controller.signal })
      .then((list) => {
        if (controller.signal.aborted) return;
        setSpawns(list);
        setTeleportSpawnId((current) => {
          if (teleportSpawnTouchedRef.current && current) {
            return current;
          }
          const defaultSpawn = list.find((spawn) => spawn.isDefault) ?? list[0];
          return defaultSpawn?.id ?? "";
        });
        if (list.length === 0) {
          setTeleportPlayerMode("coordinates");
        }
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        const message = describeError(error, "Failed to load campaign spawns");
        setSpawnsError(message);
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setSpawnsLoading(false);
        }
      });

    return () => controller.abort();
  }, [activeCampaignId]);

  useEffect(() => {
    if (!activeCampaignId) {
      setPlayers([]);
      setPlayersError(null);
      setTeleportPlayerId(NONE_VALUE);
      return;
    }

    const controller = new AbortController();
    setPlayersLoading(true);
    setPlayersError(null);

    fetchJson<PlayerFetchRow[] | undefined>(
      `/api/campaigns/${activeCampaignId}/characters`,
      { signal: controller.signal },
      "Failed to load campaign roster",
    )
      .then((rows) => {
        if (controller.signal.aborted) return;
        const normalized = (rows ?? [])
          .map((row) => normalizePlayerRow(row))
          .filter((item): item is PlayerOption => Boolean(item));
        setPlayers(normalized);
        setTeleportPlayerId((current) => (current !== NONE_VALUE && normalized.some((player) => player.id === current) ? current : NONE_VALUE));
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        const message = describeError(error, "Failed to load campaign roster");
        setPlayersError(message);
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setPlayersLoading(false);
        }
      });

    return () => controller.abort();
  }, [activeCampaignId]);

  const sessionOptions = useMemo(() => sessions.map((session) => ({ value: session.id, label: formatSessionLabel(session) })), [sessions]);

  const locationOptions = useMemo(() => locations.map((location) => ({ value: location.id, label: location.type ? `${location.name} (${location.type})` : location.name })), [locations]);

  const npcOptions = useMemo(
    () =>
      npcs.map((npc) => ({
        value: npc.id,
        label: npc.role ? `${npc.name} (${npc.role})` : npc.name,
        hint: npc.locationName ?? null,
      })),
    [npcs],
  );

  const playerOptions = useMemo(
    () =>
      players.map((player) => ({
        value: player.id,
        label: player.role ? `${player.name} (${player.role})` : player.name,
        visibility: player.visibilityState ?? null,
      })),
    [players],
  );

  const spawnOptions = useMemo(
    () =>
      spawns.map((spawn) => ({
        value: spawn.id,
        label: spawn.isDefault ? `${spawn.name} (default)` : spawn.name,
      })),
    [spawns],
  );

  const requireSessionSelected = () => {
    if (!selectedSession) {
      toast.error("Select a session before performing this action.");
      return false;
    }
    return true;
  };

  const handleFocusSave = useCallback(async (overrideFocus?: string | null) => {
    if (!requireSessionSelected()) return;
    const sessionId = selectedSession!.id;
    let payloadFocus: string | null;
    if (overrideFocus !== undefined) {
      if (overrideFocus === null) {
        payloadFocus = null;
      } else {
        const trimmedOverride = overrideFocus.trim();
        payloadFocus = trimmedOverride.length > 0 ? trimmedOverride : null;
      }
    } else {
      const trimmedDraft = focusDraft.trim();
      payloadFocus = trimmedDraft.length > 0 ? trimmedDraft : null;
    }

    try {
      setFocusPending(true);
      setFocusError(null);
      const response = await updateSessionFocus(sessionId, { focus: payloadFocus });
      setSessions((previous) =>
        previous.map((session) =>
          session.id === sessionId
            ? {
                ...session,
                dmFocus: response.dmFocus ?? null,
              }
            : session,
        ),
      );
      setFocusDraft(response.dmFocus ?? "");
      setFocusFeedback({ focus: response.dmFocus ?? null, updatedAt: new Date().toISOString() });
      toast.success(response.dmFocus ? "Session focus updated." : "Session focus cleared.");
    } catch (error) {
      const message = describeError(error, "Failed to update session focus");
      setFocusError(message);
      toast.error(message);
    } finally {
      setFocusPending(false);
    }
  }, [focusDraft, requireSessionSelected, selectedSession, setSessions]);

  const handleFocusClear = useCallback(() => {
    setFocusDraft("");
    void handleFocusSave(null);
  }, [handleFocusSave]);

  const handleContextSubmit = useCallback(async () => {
    if (!requireSessionSelected()) return;
    const sessionId = selectedSession!.id;
    const normalized = contextDraft.replace(/\r\n/g, "\n");

    if (contextMode === "append" && normalized.trim().length === 0) {
      const message = "Provide markdown content before appending.";
      setContextError(message);
      toast.error(message);
      return;
    }

    const payload = {
      contextMd: contextMode === "replace" ? (normalized.trim().length > 0 ? normalized : null) : normalized,
      mode: contextMode,
    } as const;

    try {
      setContextPending(true);
      setContextError(null);
      const response = await updateSessionContext(sessionId, payload);
      setSessions((previous) =>
        previous.map((session) =>
          session.id === sessionId
            ? {
                ...session,
                dmContextMd: response.dmContextMd ?? null,
              }
            : session,
        ),
      );
      if (contextMode === "append") {
        setContextDraft("");
      } else {
        setContextDraft(response.dmContextMd ?? "");
      }
      setContextFeedback({ mode: response.mode, updatedAt: new Date().toISOString(), length: response.dmContextMd?.length ?? 0 });
      toast.success(response.mode === "append" ? "Session context appended." : "Session context updated.");
    } catch (error) {
      const message = describeError(error, "Failed to update session context");
      setContextError(message);
      toast.error(message);
    } finally {
      setContextPending(false);
    }
  }, [contextDraft, contextMode, requireSessionSelected, selectedSession, setSessions]);

  const handleEncounterCreate = useCallback(async () => {
    if (!requireSessionSelected()) return;
    const sessionId = selectedSession!.id;
    const seed = encounterSeed.trim();

    if (!seed) {
      const message = "Describe the unplanned encounter before submitting.";
      setEncounterError(message);
      toast.error(message);
      return;
    }

    try {
      setEncounterPending(true);
      setEncounterError(null);
      const payload = {
        type: encounterType,
        seed,
        difficulty: encounterDifficulty,
        locationId: encounterLocationId !== NONE_VALUE ? encounterLocationId : undefined,
      } as const;
      const created = await createUnplannedEncounter(sessionId, payload);
      setEncounterFeedback(created);
      setEncounterSeed("");
      toast.success("Unplanned encounter recorded.");
    } catch (error) {
      const message = describeError(error, "Failed to create unplanned encounter");
      setEncounterError(message);
      toast.error(message);
    } finally {
      setEncounterPending(false);
    }
  }, [encounterDifficulty, encounterLocationId, encounterSeed, encounterType, requireSessionSelected, selectedSession]);

  const handleSentimentSubmit = useCallback(async () => {
    if (sentimentNpcId === NONE_VALUE) {
      const message = "Select an NPC before logging sentiment.";
      setSentimentError(message);
      toast.error(message);
      return;
    }

    const summary = sentimentSummary.trim();
    if (!summary) {
      const message = "Provide a summary of the interaction.";
      setSentimentError(message);
      toast.error(message);
      return;
    }

    const parsedDelta = Number(sentimentDelta);
    if (!Number.isFinite(parsedDelta)) {
      const message = "Trust delta must be a number between -10 and 10.";
      setSentimentError(message);
      toast.error(message);
      return;
    }

    const clampedDelta = Math.max(-10, Math.min(10, Math.round(parsedDelta)));

    const tags = sentimentTags
      .split(",")
      .map((tag) => tag.trim())
      .filter((tag) => tag.length > 0);

    const sessionId = sentimentSessionId !== NONE_VALUE ? sentimentSessionId : undefined;

    try {
      setSentimentPending(true);
      setSentimentError(null);
      const payload = {
        delta: clampedDelta,
        summary,
        sentiment: sentimentChoice === "auto" ? undefined : sentimentChoice,
        sessionId,
        tags: tags.length > 0 ? tags : undefined,
      } as const;
      const memory = await adjustNpcSentiment(sentimentNpcId, payload);
      setSentimentFeedback(memory);
      setSentimentSummary("");
      setSentimentDelta("0");
      setSentimentTags("");
      toast.success("NPC sentiment recorded.");
    } catch (error) {
      const message = describeError(error, "Failed to adjust NPC sentiment");
      setSentimentError(message);
      toast.error(message);
    } finally {
      setSentimentPending(false);
    }
  }, [adjustNpcSentiment, sentimentChoice, sentimentDelta, sentimentNpcId, sentimentSessionId, sentimentSummary, sentimentTags]);

  const handleTeleportPlayer = useCallback(async () => {
    if (!activeCampaignId) {
      toast.error("Select an active campaign before teleporting players.");
      return;
    }

    if (teleportPlayerId === NONE_VALUE) {
      const message = "Choose a campaign player to teleport.";
      setTeleportPlayerError(message);
      toast.error(message);
      return;
    }

    const payload: Parameters<typeof teleportPlayer>[1] = {
      playerId: teleportPlayerId,
    };

    if (teleportPlayerMode === "spawn") {
      if (!teleportSpawnId) {
        const message = "Select a spawn point or switch to manual coordinates.";
        setTeleportPlayerError(message);
        toast.error(message);
        return;
      }
      payload.spawnId = teleportSpawnId;
    } else {
      const x = Number(teleportPlayerX);
      const y = Number(teleportPlayerY);
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        const message = "Provide numeric SRID-0 coordinates for X and Y.";
        setTeleportPlayerError(message);
        toast.error(message);
        return;
      }
      payload.target = { x, y };
    }

    const reason = teleportPlayerReason.trim();
    if (reason) {
      payload.reason = reason;
    }

    try {
      setTeleportPlayerPending(true);
      setTeleportPlayerError(null);
      const response = await teleportPlayer(activeCampaignId, payload);
      setTeleportPlayerFeedback(response);
      if (teleportPlayerMode === "coordinates") {
        setTeleportPlayerX("");
        setTeleportPlayerY("");
      }
      toast.success("Player teleported successfully.");
    } catch (error) {
      const message = describeError(error, "Failed to teleport player");
      setTeleportPlayerError(message);
      toast.error(message);
    } finally {
      setTeleportPlayerPending(false);
    }
  }, [activeCampaignId, teleportPlayerId, teleportPlayerMode, teleportPlayerReason, teleportPlayerX, teleportPlayerY, teleportSpawnId]);

  const handleTeleportNpc = useCallback(async () => {
    if (!activeCampaignId) {
      toast.error("Select an active campaign before teleporting NPCs.");
      return;
    }

    if (teleportNpcId === NONE_VALUE) {
      const message = "Choose an NPC to teleport.";
      setTeleportNpcError(message);
      toast.error(message);
      return;
    }

    const payload: Parameters<typeof teleportNpc>[1] = {
      npcId: teleportNpcId,
    };

    if (teleportNpcMode === "location") {
      if (teleportNpcLocationId === NONE_VALUE) {
        const message = "Select a destination location or switch to manual coordinates.";
        setTeleportNpcError(message);
        toast.error(message);
        return;
      }
      payload.locationId = teleportNpcLocationId;
    } else {
      const x = Number(teleportNpcX);
      const y = Number(teleportNpcY);
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        const message = "Provide numeric SRID-0 coordinates for X and Y.";
        setTeleportNpcError(message);
        toast.error(message);
        return;
      }
      payload.target = { x, y };
    }

    const reason = teleportNpcReason.trim();
    if (reason) {
      payload.reason = reason;
    }

    try {
      setTeleportNpcPending(true);
      setTeleportNpcError(null);
      const response = await teleportNpc(activeCampaignId, payload);
      setTeleportNpcFeedback(response);
      if (teleportNpcMode === "coordinates") {
        setTeleportNpcX("");
        setTeleportNpcY("");
      }
      toast.success("NPC teleported successfully.");
    } catch (error) {
      const message = describeError(error, "Failed to teleport NPC");
      setTeleportNpcError(message);
      toast.error(message);
    } finally {
      setTeleportNpcPending(false);
    }
  }, [activeCampaignId, teleportNpcId, teleportNpcLocationId, teleportNpcMode, teleportNpcReason, teleportNpcX, teleportNpcY]);

  if (!user || !activeCampaignId) {
    return (
      <div className="flex h-full flex-col">
        <div className="border-b px-4 py-3">
          <CardTitle className="text-base font-semibold">DM Sidebar</CardTitle>
          <CardDescription>Select a campaign with DM access to manage live session controls.</CardDescription>
        </div>
        <div className="flex flex-1 items-center justify-center p-6 text-sm text-muted-foreground">
          Join or activate a campaign where you are the DM to unlock these controls.
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="border-b px-4 py-3">
        <CardTitle className="text-base font-semibold">DM Sidebar</CardTitle>
        <CardDescription>
          Manage live session focus, notes, emergent encounters, and map state using the verified API endpoints.
        </CardDescription>
      </div>
      <ScrollArea className="flex-1">
        <div className="space-y-4 p-4 pb-8">
          <Card>
            <CardHeader>
              <CardTitle>Session Focus</CardTitle>
              <CardDescription>Persist the active narrative prompt shared with assistants and logs.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="dm-sidebar-session">Active session</Label>
                <Select
                  value={selectedSessionId}
                  onValueChange={setSelectedSessionId}
                  disabled={sessionsLoading || sessionOptions.length === 0}
                >
                  <SelectTrigger id="dm-sidebar-session" aria-label="Select active session">
                    <SelectValue placeholder={sessionsLoading ? "Loading sessions…" : "Select a session"} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_SESSION_VALUE}>Select a session</SelectItem>
                    {sessionOptions.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {sessionsError && (
                  <Alert variant="destructive">
                    <AlertTitle>Unable to load sessions</AlertTitle>
                    <AlertDescription>{sessionsError}</AlertDescription>
                  </Alert>
                )}
                {!sessionsLoading && sessionOptions.length === 0 && (
                  <p className="text-sm text-muted-foreground">
                    No sessions found for this campaign yet. Create one from the dashboard to enable sidebar controls.
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="dm-sidebar-focus">Current focus</Label>
                <Textarea
                  id="dm-sidebar-focus"
                  rows={3}
                  maxLength={500}
                  value={focusDraft}
                  onChange={(event) => setFocusDraft(event.target.value)}
                  placeholder="e.g. Track the envoy’s negotiations with the river court"
                  disabled={!selectedSession}
                />
              </div>

              <div className="flex flex-wrap gap-2">
                <Button onClick={() => void handleFocusSave()} disabled={focusPending || !selectedSession}>
                  {focusPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
                  Save focus
                </Button>
                <Button
                  variant="outline"
                  onClick={handleFocusClear}
                  disabled={focusPending || !selectedSession || !(selectedSession?.dmFocus ?? focusDraft)}
                >
                  Clear focus
                </Button>
              </div>

              {focusFeedback && (
                <Alert>
                  <AlertTitle>Focus updated</AlertTitle>
          <AlertDescription>
            {focusFeedback.focus ? `“${focusFeedback.focus}”` : "Focus cleared."} Saved at {new Date(focusFeedback.updatedAt).toLocaleTimeString()}.
          </AlertDescription>
                </Alert>
              )}

              {focusError && (
                <Alert variant="destructive">
                  <AlertTitle>Focus update failed</AlertTitle>
                  <AlertDescription>{focusError}</AlertDescription>
                </Alert>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Session Context</CardTitle>
              <CardDescription>Maintain extended scene notes for the active session.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Tabs value={contextMode} onValueChange={(value) => setContextMode(value as "replace" | "append")}> 
                <TabsList>
                  <TabsTrigger value="replace">Replace</TabsTrigger>
                  <TabsTrigger value="append">Append</TabsTrigger>
                </TabsList>
                <TabsContent value="replace">
                  <p className="text-sm text-muted-foreground">
                    Replace the stored markdown with the content below. Leave blank to clear the context.
                  </p>
                </TabsContent>
                <TabsContent value="append">
                  <p className="text-sm text-muted-foreground">
                    Append the content below to the stored markdown. Empty submissions are rejected by the API.
                  </p>
                </TabsContent>
              </Tabs>

              <div className="space-y-2">
                <Label htmlFor="dm-sidebar-context">Context markdown</Label>
                <Textarea
                  id="dm-sidebar-context"
                  rows={contextMode === "append" ? 6 : 8}
                  value={contextDraft}
                  onChange={(event) => setContextDraft(event.target.value)}
                  disabled={!selectedSession}
                  placeholder={contextMode === "append" ? "Add new paragraphs or bullet points to the stored context." : "Full markdown for the current scene."}
                />
              </div>

              <div className="flex flex-wrap gap-2">
                <Button onClick={handleContextSubmit} disabled={contextPending || !selectedSession}>
                  {contextPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileText className="mr-2 h-4 w-4" />}Save context
                </Button>
                {selectedSession?.dmContextMd && (
                  <Badge variant="outline" className="text-xs uppercase">
                    Stored length: {selectedSession.dmContextMd.length} chars
                  </Badge>
                )}
              </div>

              {selectedSession?.dmContextMd && (
                <div className="rounded-md border bg-muted/30 p-3">
                  <p className="mb-2 text-xs font-medium uppercase text-muted-foreground">Current stored context</p>
                  <ScrollArea className="h-40">
                    <pre className="whitespace-pre-wrap text-sm">{selectedSession.dmContextMd}</pre>
                  </ScrollArea>
                </div>
              )}

              {contextFeedback && (
                <Alert>
                  <AlertTitle>Context saved</AlertTitle>
                  <AlertDescription>
                    {contextFeedback.mode === "append" ? "Appended to stored markdown." : "Context replaced."} New length {contextFeedback.length} characters (saved {new Date(contextFeedback.updatedAt).toLocaleTimeString()}).
                  </AlertDescription>
                </Alert>
              )}

              {contextError && (
                <Alert variant="destructive">
                  <AlertTitle>Context update failed</AlertTitle>
                  <AlertDescription>{contextError}</AlertDescription>
                </Alert>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Unplanned Encounter</CardTitle>
              <CardDescription>Record emergent encounters without fabricating data or relying on placeholders.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="dm-sidebar-encounter-type">Encounter type</Label>
                  <Select value={encounterType} onValueChange={(value) => setEncounterType(value as UnplannedEncounterType)}>
                    <SelectTrigger id="dm-sidebar-encounter-type">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ENCOUNTER_TYPES.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="dm-sidebar-encounter-difficulty">Difficulty</Label>
                  <Select value={encounterDifficulty} onValueChange={(value) => setEncounterDifficulty(value as EncounterDifficulty)}>
                    <SelectTrigger id="dm-sidebar-encounter-difficulty">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ENCOUNTER_DIFFICULTIES.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="dm-sidebar-encounter-location">Linked location (optional)</Label>
                <Select
                  value={encounterLocationId}
                  onValueChange={setEncounterLocationId}
                  disabled={locationsLoading || locations.length === 0}
                >
                  <SelectTrigger id="dm-sidebar-encounter-location">
                    <SelectValue placeholder={locationsLoading ? "Loading locations…" : "No linked location"} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE_VALUE}>No linked location</SelectItem>
                    {locationOptions.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {locationsError && (
                  <p className="text-xs text-destructive">{locationsError}</p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="dm-sidebar-encounter-seed">Encounter description</Label>
                <Textarea
                  id="dm-sidebar-encounter-seed"
                  rows={4}
                  value={encounterSeed}
                  onChange={(event) => setEncounterSeed(event.target.value)}
                  placeholder="Spectral riders ambush the caravan at the mountain pass."
                />
              </div>

              <div className="flex flex-wrap gap-2">
                <Button onClick={handleEncounterCreate} disabled={encounterPending || !selectedSession}>
                  {encounterPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Compass className="mr-2 h-4 w-4" />}Record encounter
                </Button>
              </div>

              {encounterFeedback && (
                <Alert>
                  <AlertTitle>Encounter logged</AlertTitle>
                  <AlertDescription>
                    {encounterFeedback.name ?? "Encounter"} recorded as {encounterFeedback.type} ({encounterFeedback.difficulty}).
                  </AlertDescription>
                </Alert>
              )}

              {encounterError && (
                <Alert variant="destructive">
                  <AlertTitle>Encounter creation failed</AlertTitle>
                  <AlertDescription>{encounterError}</AlertDescription>
                </Alert>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>NPC Sentiment</CardTitle>
              <CardDescription>Log trust or sentiment shifts with canonical storage.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="dm-sidebar-sentiment-npc">NPC</Label>
                <Select value={sentimentNpcId} onValueChange={setSentimentNpcId}>
                  <SelectTrigger id="dm-sidebar-sentiment-npc">
                    <SelectValue placeholder={npcsLoading ? "Loading NPCs…" : "Select an NPC"} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE_VALUE}>Select an NPC</SelectItem>
                    {npcOptions.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {npcsError && <p className="text-xs text-destructive">{npcsError}</p>}
              </div>

              <div className="grid gap-4 md:grid-cols-3">
                <div className="space-y-2">
                  <Label htmlFor="dm-sidebar-sentiment-delta">Trust delta</Label>
                  <Input
                    id="dm-sidebar-sentiment-delta"
                    type="number"
                    min={-10}
                    max={10}
                    value={sentimentDelta}
                    onChange={(event) => setSentimentDelta(event.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="dm-sidebar-sentiment-choice">Sentiment</Label>
                  <Select value={sentimentChoice} onValueChange={(value) => setSentimentChoice(value as "auto" | NpcSentiment)}>
                    <SelectTrigger id="dm-sidebar-sentiment-choice">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {SENTIMENT_OPTIONS.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="dm-sidebar-sentiment-session">Session link</Label>
                  <Select
                    value={sentimentSessionId}
                    onValueChange={(value) => {
                      sentimentSessionTouchedRef.current = true;
                      setSentimentSessionId(value);
                    }}
                  >
                    <SelectTrigger id="dm-sidebar-sentiment-session">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE_VALUE}>No session link</SelectItem>
                      {sessionOptions.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="dm-sidebar-sentiment-summary">Summary</Label>
                <Textarea
                  id="dm-sidebar-sentiment-summary"
                  rows={3}
                  value={sentimentSummary}
                  onChange={(event) => setSentimentSummary(event.target.value)}
                  placeholder="The guardian now trusts the party after they safeguarded the village."
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="dm-sidebar-sentiment-tags">Tags (comma separated)</Label>
                <Input
                  id="dm-sidebar-sentiment-tags"
                  value={sentimentTags}
                  onChange={(event) => setSentimentTags(event.target.value)}
                  placeholder="reassurance, trust"
                />
              </div>

              <div className="flex flex-wrap gap-2">
                <Button onClick={handleSentimentSubmit} disabled={sentimentPending}>
                  {sentimentPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Users className="mr-2 h-4 w-4" />}Log sentiment
                </Button>
              </div>

              {sentimentFeedback && (
                <Alert>
                  <AlertTitle>Sentiment recorded</AlertTitle>
                  <AlertDescription>
                    Memory {sentimentFeedback.id} stored with delta {sentimentFeedback.trust_delta} ({sentimentFeedback.sentiment}).
                  </AlertDescription>
                </Alert>
              )}

              {sentimentError && (
                <Alert variant="destructive">
                  <AlertTitle>Sentiment logging failed</AlertTitle>
                  <AlertDescription>{sentimentError}</AlertDescription>
                </Alert>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Teleport Player</CardTitle>
              <CardDescription>Move player tokens using recorded spawn points or explicit SRID-0 coordinates.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="dm-sidebar-player-select">Campaign player</Label>
                <Select value={teleportPlayerId} onValueChange={setTeleportPlayerId}>
                  <SelectTrigger id="dm-sidebar-player-select">
                    <SelectValue placeholder={playersLoading ? "Loading roster…" : "Select a player"} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE_VALUE}>Select a player</SelectItem>
                    {playerOptions.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {playersError && <p className="text-xs text-destructive">{playersError}</p>}
              </div>

              <div className="space-y-2">
                <Label>Destination</Label>
                <RadioGroup
                  value={teleportPlayerMode}
                  onValueChange={(value) => setTeleportPlayerMode(value as "spawn" | "coordinates")}
                  className="flex flex-col gap-2 md:flex-row md:items-center"
                >
                  <label className="flex items-center gap-2 text-sm">
                    <RadioGroupItem value="spawn" id="dm-sidebar-player-spawn" disabled={spawns.length === 0} />
                    <span>Saved spawn point</span>
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <RadioGroupItem value="coordinates" id="dm-sidebar-player-coordinates" />
                    <span>Manual coordinates</span>
                  </label>
                </RadioGroup>
              </div>

              {teleportPlayerMode === "spawn" ? (
                <div className="space-y-2">
                  <Label htmlFor="dm-sidebar-player-spawn-select">Spawn point</Label>
                  <Select
                    value={teleportSpawnId}
                    onValueChange={(value) => {
                      teleportSpawnTouchedRef.current = true;
                      setTeleportSpawnId(value);
                    }}
                    disabled={spawns.length === 0}
                  >
                    <SelectTrigger id="dm-sidebar-player-spawn-select">
                      <SelectValue placeholder={spawnsLoading ? "Loading spawns…" : "Select a spawn"} />
                    </SelectTrigger>
                    <SelectContent>
                      {spawnOptions.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {spawnsError && <p className="text-xs text-destructive">{spawnsError}</p>}
                  {spawns.length === 0 && (
                    <p className="text-xs text-muted-foreground">
                      No spawn points defined. Switch to manual coordinates to teleport players.
                    </p>
                  )}
                </div>
              ) : (
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="dm-sidebar-player-x">X coordinate</Label>
                    <Input
                      id="dm-sidebar-player-x"
                      value={teleportPlayerX}
                      onChange={(event) => setTeleportPlayerX(event.target.value)}
                      placeholder="123.45"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="dm-sidebar-player-y">Y coordinate</Label>
                    <Input
                      id="dm-sidebar-player-y"
                      value={teleportPlayerY}
                      onChange={(event) => setTeleportPlayerY(event.target.value)}
                      placeholder="678.90"
                    />
                  </div>
                </div>
              )}

              <div className="space-y-2">
                <Label htmlFor="dm-sidebar-player-reason">Audit reason (optional)</Label>
                <Input
                  id="dm-sidebar-player-reason"
                  value={teleportPlayerReason}
                  onChange={(event) => setTeleportPlayerReason(event.target.value)}
                  placeholder="DM reposition during encounter"
                />
              </div>

              <div className="flex flex-wrap gap-2">
                <Button onClick={handleTeleportPlayer} disabled={teleportPlayerPending}>
                  {teleportPlayerPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Target className="mr-2 h-4 w-4" />}Teleport player
                </Button>
              </div>

              {teleportPlayerFeedback && (
                <Alert>
                  <AlertTitle>Player teleported</AlertTitle>
                  <AlertDescription>
                    Position {(teleportPlayerFeedback.geometry?.coordinates ?? []).join(", ")} · Reason: {teleportPlayerFeedback.reason ?? "unspecified"}
                  </AlertDescription>
                </Alert>
              )}

              {teleportPlayerError && (
                <Alert variant="destructive">
                  <AlertTitle>Player teleport failed</AlertTitle>
                  <AlertDescription>{teleportPlayerError}</AlertDescription>
                </Alert>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Teleport NPC</CardTitle>
              <CardDescription>Reposition NPCs to campaign locations or explicit map coordinates.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="dm-sidebar-npc-select">NPC</Label>
                <Select value={teleportNpcId} onValueChange={setTeleportNpcId}>
                  <SelectTrigger id="dm-sidebar-npc-select">
                    <SelectValue placeholder={npcsLoading ? "Loading NPCs…" : "Select an NPC"} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE_VALUE}>Select an NPC</SelectItem>
                    {npcOptions.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Destination</Label>
                <RadioGroup
                  value={teleportNpcMode}
                  onValueChange={(value) => setTeleportNpcMode(value as "location" | "coordinates")}
                  className="flex flex-col gap-2 md:flex-row md:items-center"
                >
                  <label className="flex items-center gap-2 text-sm">
                    <RadioGroupItem value="location" id="dm-sidebar-npc-location" />
                    <span>Campaign location</span>
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <RadioGroupItem value="coordinates" id="dm-sidebar-npc-coordinates" />
                    <span>Manual coordinates</span>
                  </label>
                </RadioGroup>
              </div>

              {teleportNpcMode === "location" ? (
                <div className="space-y-2">
                  <Label htmlFor="dm-sidebar-npc-location-select">Location</Label>
                  <Select value={teleportNpcLocationId} onValueChange={setTeleportNpcLocationId}>
                    <SelectTrigger id="dm-sidebar-npc-location-select">
                      <SelectValue placeholder={locationsLoading ? "Loading locations…" : "Select a location"} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE_VALUE}>Select a location</SelectItem>
                      {locationOptions.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ) : (
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="dm-sidebar-npc-x">X coordinate</Label>
                    <Input
                      id="dm-sidebar-npc-x"
                      value={teleportNpcX}
                      onChange={(event) => setTeleportNpcX(event.target.value)}
                      placeholder="42.5"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="dm-sidebar-npc-y">Y coordinate</Label>
                    <Input
                      id="dm-sidebar-npc-y"
                      value={teleportNpcY}
                      onChange={(event) => setTeleportNpcY(event.target.value)}
                      placeholder="99.1"
                    />
                  </div>
                </div>
              )}

              <div className="space-y-2">
                <Label htmlFor="dm-sidebar-npc-reason">Audit reason (optional)</Label>
                <Input
                  id="dm-sidebar-npc-reason"
                  value={teleportNpcReason}
                  onChange={(event) => setTeleportNpcReason(event.target.value)}
                  placeholder="Relocate closer to the party"
                />
              </div>

              <div className="flex flex-wrap gap-2">
                <Button onClick={handleTeleportNpc} disabled={teleportNpcPending}>
                  {teleportNpcPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <MapPin className="mr-2 h-4 w-4" />}Teleport NPC
                </Button>
              </div>

              {teleportNpcFeedback && (
                <Alert>
                  <AlertTitle>NPC teleported</AlertTitle>
                  <AlertDescription>
                    {teleportNpcFeedback.currentLocationId
                      ? `Now located at ${teleportNpcFeedback.currentLocationId}.`
                      : `World position ${(teleportNpcFeedback.worldPosition?.coordinates ?? []).join(", ")}.`}
                  </AlertDescription>
                </Alert>
              )}

              {teleportNpcError && (
                <Alert variant="destructive">
                  <AlertTitle>NPC teleport failed</AlertTitle>
                  <AlertDescription>{teleportNpcError}</AlertDescription>
                </Alert>
              )}
            </CardContent>
          </Card>
        </div>
      </ScrollArea>
    </div>
  );
}
