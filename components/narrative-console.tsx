import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, Sparkles, FileText, Users, Sword, Map, RefreshCw, AlertCircle, History } from "lucide-react";

import { useGameSession } from "../contexts/GameSessionContext";
import { useUser } from "../contexts/UserContext";
import { apiFetch, readErrorMessage, readJsonBody } from "../utils/api-client";
import { handleAsyncError } from "../utils/error-handling";
import { FeatureUnavailable } from "./feature-unavailable";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";
import { Button } from "./ui/button";
import { Textarea } from "./ui/textarea";
import { Input } from "./ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { Alert, AlertDescription, AlertTitle } from "./ui/alert";
import { ScrollArea } from "./ui/scroll-area";
import { Badge } from "./ui/badge";
import { Skeleton } from "./ui/skeleton";

const NO_SELECTION = 'none';
const NO_SENTIMENT = 'none';

const NARRATIVE_TYPE_LABEL: Record<NarrativeType, string> = {
  dm: "DM Narration",
  scene: "Scene Description",
  npc: "NPC Dialogue",
  action: "Action Outcome",
  quest: "Quest Generation",
};

type NarrativeType = "dm" | "scene" | "npc" | "action" | "quest";

type SessionOption = {
  id: string;
  number: number;
  title: string;
  status: string;
};

type NpcOption = {
  id: string;
  name: string;
  description?: string | null;
  role?: string | null;
};

type NarrativeHistoryEntry = {
  id: string;
  type: NarrativeType;
  content: string;
  recordedAt: string;
  providerName?: string | null;
  providerModel?: string | null;
  cacheHit?: boolean;
  request?: Record<string, unknown> | null;
  prompt?: { system?: string | null; user?: string | null } | null;
  metadata?: Record<string, unknown> | null;
};

type NarrativeApiResponse = {
  narrativeId: string;
  content: string;
  provider?: { name?: string | null; model?: string | null } | null;
  metrics?: Record<string, unknown> | null;
  cache?: { hit?: boolean; key?: string | null } | null;
  request?: Record<string, unknown> | null;
  prompt?: { system?: string | null; user?: string | null } | null;
  contextGeneratedAt?: string | null;
  recordedAt?: string | null;
};

const SENTIMENT_OPTIONS = [
  { value: NO_SENTIMENT, label: "No sentiment" },
  { value: "positive", label: "Positive" },
  { value: "neutral", label: "Neutral" },
  { value: "mixed", label: "Mixed" },
  { value: "negative", label: "Negative" },
];

const normalizeNarrativeErrorMessage = (rawMessage: string): string => {
  const message = rawMessage.trim();
  if (!message) {
    return "Narrative request failed due to an unexpected error.";
  }

  const lower = message.toLowerCase();

  if (lower.includes("narrative_provider_error")) {
    return "The narrative provider is currently unavailable. Verify the Ollama service is running and reachable, then try again.";
  }

  if (lower.includes("narrative_service_error")) {
    return "The narrative service failed to generate a response. Check provider status and retry.";
  }

  return message;
};

const stripThinkingAnnotations = (content: string | undefined | null): string => {
  if (!content) return "";
  return content.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
};

export function NarrativeConsole() {
  const { activeCampaignId, activeCampaign, latestSession } = useGameSession();
  const { user } = useUser();

  const [sessionOptions, setSessionOptions] = useState<SessionOption[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [sessionsError, setSessionsError] = useState<string | null>(null);

  const [npcOptions, setNpcOptions] = useState<NpcOption[]>([]);
  const [npcsLoading, setNpcsLoading] = useState(false);
  const [npcsError, setNpcsError] = useState<string | null>(null);

  const [selectedSessionId, setSelectedSessionId] = useState<string>(NO_SELECTION);
  const [activeType, setActiveType] = useState<NarrativeType>("dm");
  const [loadingType, setLoadingType] = useState<NarrativeType | null>(null);
  const [requestError, setRequestError] = useState<{ type: NarrativeType; message: string } | null>(null);
  const [history, setHistory] = useState<NarrativeHistoryEntry[]>([]);

  // Form state per narrative type
  const [dmFocus, setDmFocus] = useState("");
  const [sceneFocus, setSceneFocus] = useState("");

  const [npcFocus, setNpcFocus] = useState("");
  const [npcId, setNpcId] = useState(NO_SELECTION);
  const [npcInteractionSummary, setNpcInteractionSummary] = useState("");
  const [npcInteractionSentiment, setNpcInteractionSentiment] = useState<string>(NO_SENTIMENT);
  const [npcInteractionTrustDelta, setNpcInteractionTrustDelta] = useState<string>("");
  const [npcInteractionTags, setNpcInteractionTags] = useState("");

  const [actionFocus, setActionFocus] = useState("");
  const [actionType, setActionType] = useState("");
  const [actionResult, setActionResult] = useState("");
  const [actionSummary, setActionSummary] = useState("");
  const [actionActor, setActionActor] = useState("");

  const [questFocus, setQuestFocus] = useState("");
  const [questSeeds, setQuestSeeds] = useState("");

  const canRequestNarratives = useMemo(() => {
    if (!user) return false;
    if (user.roles?.includes("admin")) return true;
    if (activeCampaign?.dmUserId === user.id) return true;
    if (user.roles?.includes("dm")) return true;
    return false;
  }, [user, activeCampaign?.dmUserId]);

  const narrativeRoutes: Record<NarrativeType, string> = useMemo(
    () => ({
      dm: "dm",
      scene: "scene",
      npc: "npc",
      action: "action",
      quest: "quest",
    }),
    []
  );

  const loadSessions = useCallback(
    async (signal?: AbortSignal) => {
      if (!activeCampaignId) {
        setSessionOptions([]);
        setSelectedSessionId(NO_SELECTION);
        setSessionsError(null);
        return;
      }

      try {
        setSessionsLoading(true);
        setSessionsError(null);

        const response = await apiFetch(`/api/campaigns/${activeCampaignId}/sessions`, {
          signal,
        });
        if (!response.ok) {
          throw new Error(await readErrorMessage(response, "Failed to load sessions"));
        }

        const payload = await readJsonBody<unknown>(response);
        if (!Array.isArray(payload)) {
          throw new Error("Sessions payload must be an array");
        }

        const normalized = payload
          .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
          .map((item) => ({
            id: String(item.id ?? ""),
            number: Number(item.session_number ?? item.sessionNumber ?? 0),
            title: typeof item.title === "string" ? item.title : "",
            status: typeof item.status === "string" ? item.status : "unknown",
          }))
          .filter((session) => session.id);

        setSessionOptions(normalized);
        setSelectedSessionId((current) => {
          if (current !== NO_SELECTION && normalized.some((session) => session.id === current)) {
            return current;
          }
          if (latestSession?.id && normalized.some((session) => session.id === latestSession.id)) {
            return latestSession.id;
          }
          return normalized[0]?.id ?? NO_SELECTION;
        });
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }
        const message = handleAsyncError(error);
        setSessionsError(message);
      } finally {
        setSessionsLoading(false);
      }
    },
    [activeCampaignId, latestSession?.id]
  );

  const loadNpcs = useCallback(
    async (signal?: AbortSignal) => {
      if (!activeCampaignId) {
        setNpcOptions([]);
        setNpcId(NO_SELECTION);
        setNpcsError(null);
        return;
      }

      try {
        setNpcsLoading(true);
        setNpcsError(null);

        const response = await apiFetch(`/api/campaigns/${activeCampaignId}/npcs`, {
          signal,
        });
        if (!response.ok) {
          throw new Error(await readErrorMessage(response, "Failed to load NPCs"));
        }

        const payload = await readJsonBody<unknown>(response);
        if (!Array.isArray(payload)) {
          throw new Error("NPC payload must be an array");
        }

        const normalized = payload
          .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
          .map((item) => ({
            id: String(item.id ?? ""),
            name: typeof item.name === "string" ? item.name : "Unnamed NPC",
            description: typeof item.description === "string" ? item.description : null,
            role: typeof item.role === "string" ? item.role : null,
          }))
          .filter((npc) => npc.id && npc.name);

        setNpcOptions(normalized);
        setNpcId((current) => {
          if (current !== NO_SELECTION && normalized.some((npc) => npc.id === current)) {
            return current;
          }
          return normalized[0]?.id ?? NO_SELECTION;
        });
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }
        const message = handleAsyncError(error);
        setNpcsError(message);
      } finally {
        setNpcsLoading(false);
      }
    },
    [activeCampaignId]
  );

  useEffect(() => {
    if (latestSession?.id) {
      setSelectedSessionId((current) => current || latestSession.id);
    }
  }, [latestSession?.id]);

  useEffect(() => {
    const controller = new AbortController();
    void loadSessions(controller.signal);
    return () => controller.abort();
  }, [loadSessions]);

  useEffect(() => {
    const controller = new AbortController();
    void loadNpcs(controller.signal);
    return () => controller.abort();
  }, [loadNpcs]);

  const selectedSession = useMemo(() => {
    if (selectedSessionId === NO_SELECTION) return null;
    return sessionOptions.find((session) => session.id === selectedSessionId) ?? null;
  }, [selectedSessionId, sessionOptions]);

  const ensureCampaignSelected = () => {
    if (!activeCampaignId) {
      setRequestError({ type: activeType, message: "Select an active campaign before requesting narratives." });
      return false;
    }
    return true;
  };

  const submitNarrative = useCallback(
    async (type: NarrativeType, basePayload: Record<string, unknown>) => {
      if (!activeCampaignId) {
        return;
      }

      setLoadingType(type);
      setRequestError(null);

      const payload: Record<string, unknown> = { ...basePayload };
      if (selectedSessionId !== NO_SELECTION) {
        payload.sessionId = selectedSessionId;
      }

      try {
        const response = await apiFetch(`/api/campaigns/${activeCampaignId}/narratives/${narrativeRoutes[type]}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
        });

        if (!response.ok) {
          throw new Error(await readErrorMessage(response, "Narrative request failed"));
        }

        const body = await readJsonBody<NarrativeApiResponse>(response);
        const entry: NarrativeHistoryEntry = {
          id: body.narrativeId || `${type}-${Date.now()}`,
          type,
          content: stripThinkingAnnotations(body.content),
          recordedAt: body.recordedAt ?? new Date().toISOString(),
          providerName: body.provider?.name ?? null,
          providerModel: body.provider?.model ?? null,
          cacheHit: body.cache?.hit ?? false,
          request: body.request ?? null,
          prompt: body.prompt ?? null,
          metadata: body.metrics ?? null,
        };

        setHistory((previous) => [entry, ...previous]);
      } catch (error) {
        const message = handleAsyncError(error);
        setRequestError({ type, message: normalizeNarrativeErrorMessage(message) });
      } finally {
        setLoadingType(null);
      }
    },
    [activeCampaignId, narrativeRoutes, selectedSessionId]
  );

  const handleGenerateDm = useCallback(() => {
    if (!ensureCampaignSelected()) {
      return;
    }
    const payload: Record<string, unknown> = {};
    if (dmFocus.trim()) {
      payload.focus = dmFocus.trim();
    }
    void submitNarrative("dm", payload);
  }, [dmFocus, ensureCampaignSelected, submitNarrative]);

  const handleGenerateScene = useCallback(() => {
    if (!ensureCampaignSelected()) {
      return;
    }
    const payload: Record<string, unknown> = {};
    if (sceneFocus.trim()) {
      payload.focus = sceneFocus.trim();
    }
    void submitNarrative("scene", payload);
  }, [ensureCampaignSelected, sceneFocus, submitNarrative]);

  const handleGenerateNpc = useCallback(() => {
    if (!ensureCampaignSelected()) {
      return;
    }
    if (npcId === NO_SELECTION) {
      setRequestError({ type: "npc", message: "Select an NPC before requesting dialogue." });
      return;
    }

    const payload: Record<string, unknown> = { npcId };
    if (npcFocus.trim()) {
      payload.focus = npcFocus.trim();
    }

    const interaction: Record<string, unknown> = {};
    if (npcInteractionSummary.trim()) {
      interaction.summary = npcInteractionSummary.trim();
    }
    if (npcInteractionSentiment !== NO_SENTIMENT) {
      interaction.sentiment = npcInteractionSentiment;
    }
    if (npcInteractionTrustDelta) {
      const parsed = Number(npcInteractionTrustDelta);
      if (Number.isFinite(parsed)) {
        interaction.trustDelta = parsed;
      }
    }
    if (npcInteractionTags.trim()) {
      const tags = npcInteractionTags
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean);
      if (tags.length > 0) {
        interaction.tags = tags;
      }
    }

    if (Object.keys(interaction).length > 0) {
      payload.interaction = interaction;
    }

    void submitNarrative("npc", payload);
  }, [ensureCampaignSelected, npcFocus, npcId, npcInteractionSentiment, npcInteractionSummary, npcInteractionTags, npcInteractionTrustDelta, submitNarrative]);

  const handleGenerateAction = useCallback(() => {
    if (!ensureCampaignSelected()) {
      return;
    }

    const action: Record<string, unknown> = {};
    if (actionType.trim()) {
      action.type = actionType.trim();
    }
    if (actionResult.trim()) {
      action.result = actionResult.trim();
    }
    if (actionSummary.trim()) {
      action.summary = actionSummary.trim();
    }
    if (actionActor.trim()) {
      action.actor = actionActor.trim();
    }

    if (Object.keys(action).length === 0) {
      setRequestError({ type: "action", message: "Provide at least one action detail (type or result)." });
      return;
    }

    const payload: Record<string, unknown> = { action };
    if (actionFocus.trim()) {
      payload.focus = actionFocus.trim();
    }

    void submitNarrative("action", payload);
  }, [actionActor, actionFocus, actionResult, actionSummary, actionType, ensureCampaignSelected, submitNarrative]);

  const handleGenerateQuest = useCallback(() => {
    if (!ensureCampaignSelected()) {
      return;
    }

    const payload: Record<string, unknown> = {};
    if (questFocus.trim()) {
      payload.focus = questFocus.trim();
    }

    const seeds = questSeeds
      .split(/\r?\n/)
      .map((seed) => seed.trim())
      .filter(Boolean);
    if (seeds.length > 0) {
      payload.questSeeds = seeds;
    }

    void submitNarrative("quest", payload);
  }, [ensureCampaignSelected, questFocus, questSeeds, submitNarrative]);

  if (!activeCampaignId) {
    return (
      <FeatureUnavailable
        feature="Narrative console"
        reason="Select an active campaign to scope narrative requests to real session data."
        remediation="Choose a campaign from the chat drawer or dashboard, then reopen the narrative panel."
      />
    );
  }

  if (!canRequestNarratives) {
    return (
      <FeatureUnavailable
        feature="Narrative console"
        reason="Narrative generation endpoints require DM or admin privileges."
        remediation="Sign in as the campaign DM/co-DM or request elevated access."
      />
    );
  }

  const activeHistory = history.filter((entry) => entry.type === activeType);
  const latestEntry = activeHistory[0] ?? null;
  const errorForActiveTab = requestError && requestError.type === activeType ? requestError.message : null;
  const isLoading = loadingType === activeType;

  return (
    <div className="flex h-full flex-col">
      <Card className="border-none shadow-none">
        <CardHeader className="space-y-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Sparkles className="h-4 w-4" />
            Live Narrative Console
          </CardTitle>
          <CardDescription>
            Request DM narration, scene descriptions, NPC dialogue, action outcomes, and quest hooks directly from the live backend.
          </CardDescription>
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            {selectedSession ? (
              <span>
                Session {selectedSession.number}
                {selectedSession.title ? ` · ${selectedSession.title}` : ""}
              </span>
            ) : (
              <span>No session linkage</span>
            )}
            {selectedSession?.status && <Badge variant="outline">{selectedSession.status}</Badge>}
            <Button
              variant="outline"
              size="xs"
              className="h-7"
              onClick={() => void loadSessions()}
              disabled={sessionsLoading}
            >
              <RefreshCw className="mr-1 h-3 w-3" /> Sessions
            </Button>
            <Button
              variant="outline"
              size="xs"
              className="h-7"
              onClick={() => void loadNpcs()}
              disabled={npcsLoading}
            >
              <RefreshCw className="mr-1 h-3 w-3" /> NPCs
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {sessionsError && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Session load failed</AlertTitle>
              <AlertDescription>{sessionsError}</AlertDescription>
            </Alert>
          )}

          {npcsError && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>NPC load failed</AlertTitle>
              <AlertDescription>{npcsError}</AlertDescription>
            </Alert>
          )}

          <div className="grid gap-2">
            <label className="text-xs font-medium text-muted-foreground">Linked session</label>
            <Select value={selectedSessionId} onValueChange={setSelectedSessionId} disabled={sessionsLoading}>
              <SelectTrigger>
                <SelectValue placeholder={sessionsLoading ? "Loading sessions…" : "Select session (optional)"} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_SELECTION}>No session context</SelectItem>
                {sessionOptions.map((session) => (
                  <SelectItem key={session.id} value={session.id}>
                    Session {session.number}: {session.title || "Untitled"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {sessionsLoading && <Skeleton className="h-2 w-1/2" />}
          </div>

          <Tabs value={activeType} onValueChange={(value) => setActiveType(value as NarrativeType)} className="space-y-4">
            <TabsList className="grid grid-cols-5">
              <TabsTrigger value="dm">DM</TabsTrigger>
              <TabsTrigger value="scene">Scene</TabsTrigger>
              <TabsTrigger value="npc">NPC</TabsTrigger>
              <TabsTrigger value="action">Action</TabsTrigger>
              <TabsTrigger value="quest">Quest</TabsTrigger>
            </TabsList>

            {errorForActiveTab && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>Request failed</AlertTitle>
                <AlertDescription>{errorForActiveTab}</AlertDescription>
              </Alert>
            )}

            <TabsContent value="dm" className="space-y-3">
              <div className="grid gap-2">
                <label className="flex items-center gap-2 text-sm font-medium">
                  <FileText className="h-4 w-4" /> Prompt focus (optional)
                </label>
                <Textarea
                  value={dmFocus}
                  onChange={(event) => setDmFocus(event.target.value)}
                  placeholder="Summarize what just happened to guide the narration"
                  rows={4}
                />
              </div>
              <Button onClick={handleGenerateDm} disabled={isLoading}>
                {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
                Generate DM narration
              </Button>
            </TabsContent>

            <TabsContent value="scene" className="space-y-3">
              <div className="grid gap-2">
                <label className="flex items-center gap-2 text-sm font-medium">
                  <Map className="h-4 w-4" /> Scene focus (optional)
                </label>
                <Textarea
                  value={sceneFocus}
                  onChange={(event) => setSceneFocus(event.target.value)}
                  placeholder="Describe the location, mood, or recent changes"
                  rows={4}
                />
              </div>
              <Button onClick={handleGenerateScene} disabled={isLoading}>
                {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
                Generate scene description
              </Button>
            </TabsContent>

            <TabsContent value="npc" className="space-y-3">
              <div className="grid gap-2">
                <label className="flex items-center gap-2 text-sm font-medium">
                  <Users className="h-4 w-4" /> NPC
                </label>
                <Select value={npcId} onValueChange={setNpcId} disabled={npcsLoading || npcOptions.length === 0}>
                  <SelectTrigger>
                    <SelectValue placeholder={npcsLoading ? "Loading NPCs…" : "Choose NPC"} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_SELECTION}>Choose an NPC</SelectItem>
                    {npcOptions.map((npc) => (
                      <SelectItem key={npc.id} value={npc.id}>
                        {npc.name}
                        {npc.role ? ` · ${npc.role}` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {npcsLoading && <Skeleton className="h-2 w-1/2" />}
              </div>

              <div className="grid gap-2">
                <label className="text-sm font-medium">Conversation focus (optional)</label>
                <Textarea
                  value={npcFocus}
                  onChange={(event) => setNpcFocus(event.target.value)}
                  placeholder="Provide context for the dialogue"
                  rows={3}
                />
              </div>

              <div className="grid gap-2">
                <label className="text-sm font-medium">Interaction summary (optional)</label>
                <Textarea
                  value={npcInteractionSummary}
                  onChange={(event) => setNpcInteractionSummary(event.target.value)}
                  placeholder="Note what the party is trying to achieve"
                  rows={3}
                />
              </div>

              <div className="grid gap-2 md:grid-cols-2">
                <div className="grid gap-2">
                  <label className="text-sm font-medium">Sentiment</label>
                  <Select value={npcInteractionSentiment} onValueChange={setNpcInteractionSentiment}>
                    <SelectTrigger>
                      <SelectValue placeholder="Optional sentiment" />
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
                <div className="grid gap-2">
                  <label className="text-sm font-medium">Trust delta (−10 to 10)</label>
                  <Input
                    value={npcInteractionTrustDelta}
                    onChange={(event) => setNpcInteractionTrustDelta(event.target.value)}
                    placeholder="0"
                    type="number"
                  />
                </div>
              </div>

              <div className="grid gap-2">
                <label className="text-sm font-medium">Interaction tags (comma separated)</label>
                <Input
                  value={npcInteractionTags}
                  onChange={(event) => setNpcInteractionTags(event.target.value)}
                  placeholder="bargaining, secrecy"
                />
              </div>

              <Button onClick={handleGenerateNpc} disabled={isLoading || npcOptions.length === 0}>
                {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Users className="mr-2 h-4 w-4" />}
                Generate NPC dialogue
              </Button>
            </TabsContent>

            <TabsContent value="action" className="space-y-3">
              <div className="grid gap-2">
                <label className="flex items-center gap-2 text-sm font-medium">
                  <Sword className="h-4 w-4" /> Action context
                </label>
                <Textarea
                  value={actionFocus}
                  onChange={(event) => setActionFocus(event.target.value)}
                  placeholder="Optional: describe the stakes or objective"
                  rows={3}
                />
              </div>

              <div className="grid gap-2 md:grid-cols-2">
                <div className="grid gap-2">
                  <label className="text-sm font-medium">Action type</label>
                  <Input
                    value={actionType}
                    onChange={(event) => setActionType(event.target.value)}
                    placeholder="Attack, persuade, investigate…"
                  />
                </div>
                <div className="grid gap-2">
                  <label className="text-sm font-medium">Result</label>
                  <Input
                    value={actionResult}
                    onChange={(event) => setActionResult(event.target.value)}
                    placeholder="Critical success, failure, partial…"
                  />
                </div>
              </div>

              <div className="grid gap-2 md:grid-cols-2">
                <div className="grid gap-2">
                  <label className="text-sm font-medium">Actor (optional)</label>
                  <Input
                    value={actionActor}
                    onChange={(event) => setActionActor(event.target.value)}
                    placeholder="Character or NPC name"
                  />
                </div>
                <div className="grid gap-2">
                  <label className="text-sm font-medium">Summary (optional)</label>
                  <Input
                    value={actionSummary}
                    onChange={(event) => setActionSummary(event.target.value)}
                    placeholder="One-line action summary"
                  />
                </div>
              </div>

              <Button onClick={handleGenerateAction} disabled={isLoading}>
                {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sword className="mr-2 h-4 w-4" />}
                Generate action outcome
              </Button>
            </TabsContent>

            <TabsContent value="quest" className="space-y-3">
              <div className="grid gap-2">
                <label className="flex items-center gap-2 text-sm font-medium">
                  <Map className="h-4 w-4" /> Quest focus (optional)
                </label>
                <Textarea
                  value={questFocus}
                  onChange={(event) => setQuestFocus(event.target.value)}
                  placeholder="Describe campaign goals or constraints"
                  rows={3}
                />
              </div>

              <div className="grid gap-2">
                <label className="text-sm font-medium">Quest seeds (one per line)</label>
                <Textarea
                  value={questSeeds}
                  onChange={(event) => setQuestSeeds(event.target.value)}
                  placeholder={"Rescue the missing scout\nSecure the ancient relic"}
                  rows={4}
                />
              </div>

              <Button onClick={handleGenerateQuest} disabled={isLoading}>
                {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
                Generate quest outline
              </Button>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      <div className="mt-4 flex-1 overflow-hidden">
        <Card className="h-full border-none shadow-none">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <History className="h-4 w-4" /> Recent {NARRATIVE_TYPE_LABEL[activeType]} Responses
            </CardTitle>
            <CardDescription>Responses are rendered verbatim from the backend. Cache hits and provider metadata are shown when available.</CardDescription>
          </CardHeader>
          <CardContent className="h-full p-0">
            {latestEntry ? (
              <div className="h-full">
                <div className="border-b p-4 text-sm">
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    {latestEntry.providerName && (
                      <Badge variant="outline">{latestEntry.providerName}</Badge>
                    )}
                    {latestEntry.providerModel && (
                      <Badge variant="secondary">{latestEntry.providerModel}</Badge>
                    )}
                    {latestEntry.cacheHit && <Badge variant="outline">Cache hit</Badge>}
                    <span className="text-xs text-muted-foreground">
                      Generated {new Date(latestEntry.recordedAt).toLocaleString()}
                    </span>
                  </div>
                  <ScrollArea className="max-h-72 rounded border p-4">
                    <pre className="whitespace-pre-wrap text-sm text-foreground">{latestEntry.content}</pre>
                  </ScrollArea>
                  {(latestEntry.prompt || latestEntry.request) && (
                    <details className="mt-3 text-xs text-muted-foreground">
                      <summary className="cursor-pointer select-none font-medium">Prompt & request metadata</summary>
                      <div className="mt-2 space-y-2">
                        {latestEntry.prompt && (
                          <div>
                            <div className="font-semibold">Prompt</div>
                            {latestEntry.prompt.system && (
                              <pre className="whitespace-pre-wrap rounded border bg-muted/40 p-2">{latestEntry.prompt.system}</pre>
                            )}
                            {latestEntry.prompt.user && (
                              <pre className="whitespace-pre-wrap rounded border bg-muted/40 p-2">{latestEntry.prompt.user}</pre>
                            )}
                          </div>
                        )}
                        {latestEntry.request && (
                          <div>
                            <div className="font-semibold">Request payload</div>
                            <pre className="whitespace-pre-wrap break-words rounded border bg-muted/40 p-2">
                              {JSON.stringify(latestEntry.request, null, 2)}
                            </pre>
                          </div>
                        )}
                        {latestEntry.metadata && (
                          <div>
                            <div className="font-semibold">Metrics</div>
                            <pre className="whitespace-pre-wrap break-words rounded border bg-muted/40 p-2">
                              {JSON.stringify(latestEntry.metadata, null, 2)}
                            </pre>
                          </div>
                        )}
                      </div>
                    </details>
                  )}
                </div>
                <ScrollArea className="h-[calc(100%-16rem)]">
                  <div className="space-y-2 p-4">
                    {activeHistory.slice(1).map((entry) => (
                      <div key={entry.id} className="rounded border bg-muted/20 p-3 text-xs">
                        <div className="mb-2 flex flex-wrap items-center gap-2">
                          <span className="font-medium">{new Date(entry.recordedAt).toLocaleString()}</span>
                          {entry.providerName && <Badge variant="outline">{entry.providerName}</Badge>}
                          {entry.providerModel && <Badge variant="secondary">{entry.providerModel}</Badge>}
                          {entry.cacheHit && <Badge variant="outline">Cache hit</Badge>}
                        </div>
                        <pre className="whitespace-pre-wrap text-foreground/80">{entry.content}</pre>
                      </div>
                    ))}
                    {activeHistory.length <= 1 && (
                      <p className="text-xs text-muted-foreground">No earlier responses for this narrative type yet.</p>
                    )}
                  </div>
                </ScrollArea>
              </div>
            ) : (
              <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-sm text-muted-foreground">
                <Sparkles className="h-8 w-8" />
                <p>Request a narrative to see live responses from the backend. Nothing is pre-filled or mocked.</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export default NarrativeConsole;
