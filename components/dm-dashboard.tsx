import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { Input } from "./ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "./ui/avatar";
import { Progress } from "./ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { CampaignManager } from "./campaign-manager";
import { toast } from "sonner";
import {
  AlertCircle,
  Building,
  Calendar,
  Heart,
  Home,
  Loader2,
  MapIcon,
  MapPin,
  Play,
  Search,
  Settings,
  Shield,
  Sword,
  Star,
  LogOut,
  User,
  Users
} from "lucide-react";
import { apiFetch, readErrorMessage, readJsonBody } from "../utils/api-client";

interface LevelRange {
  min: number;
  max: number;
}

type CampaignStatus = "planning" | "recruiting" | "active" | "paused" | "completed";

interface DMCampaignSummary {
  id: string;
  name: string;
  description: string;
  status: CampaignStatus;
  system: string;
  maxPlayers: number;
  currentPlayers: number;
  levelRange: LevelRange;
  createdAt: string;
  tags: string[];
  nextSession: Date | null;
}

interface RouteSummary {
  id: string;
  name: string;
  from?: string;
  to?: string;
  distance?: string | null;
  difficulty?: string | null;
  description?: string;
}

interface LocationSummary {
  id: string;
  name: string;
  type: string;
  description: string;
  notes?: string;
  population?: number;
  government?: string;
  lng?: number;
  lat?: number;
}

interface NpcSummary {
  id: string;
  name: string;
  race?: string;
  role?: string;
  description?: string;
  locationName?: string;
}

interface CampaignDetail extends DMCampaignSummary {
  routes: RouteSummary[];
  locations: LocationSummary[];
  npcs: NpcSummary[];
}

interface CharacterProfile {
  id: string;
  name: string;
  className: string;
  level: number;
  race: string;
  hitPoints: { current: number; max: number };
  armorClass: number;
  background: string;
  campaigns: string[];
  lastPlayed: Date | null;
  avatar?: string;
}

interface PlayerCampaign {
  id: string;
  name: string;
  description: string;
  dmName: string;
  status: CampaignStatus | "full";
  playerCount: number;
  maxPlayers: number;
  system: string;
  levelRange: LevelRange;
  tags: string[];
  nextSession: Date | null;
  isJoined: boolean;
  characterName?: string;
}

interface DMDashboardProps {
  user: { id: string; username: string; email: string; roles: string[]; role?: string };
  onEnterGame: () => void;
  onLogout: () => void;
}

const statusColorMap: Record<CampaignStatus | "full", string> = {
  planning: "bg-yellow-500",
  recruiting: "bg-blue-500",
  active: "bg-green-500",
  paused: "bg-orange-500",
  completed: "bg-gray-500",
  full: "bg-purple-500"
};

function isValidDate(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function parseDate(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date) return isNaN(value.getTime()) ? null : value;
  if (isValidDate(value)) {
    const parsed = new Date(value);
    return isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
}

function toNumber(value: unknown, fallback = 0): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function parseJsonField<T>(value: unknown, fallback: T): T {
  if (value === null || value === undefined) return fallback;
  if (Array.isArray(value) || typeof value === "object") {
    return value as T;
  }
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return parsed as T;
    } catch {
      return fallback;
    }
  }
  return fallback;
}

function parseStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string");
  }
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) {
        return parsed.filter((item): item is string => typeof item === "string");
      }
    } catch {
      return value
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
    }
  }
  return [];
}

function parseLevelRange(value: unknown): LevelRange {
  const parsed = parseJsonField<Partial<LevelRange>>(value, { min: 1, max: 20 });
  const min = toNumber(parsed?.min, 1);
  const max = toNumber(parsed?.max, min);
  return { min, max };
}

function parseRoutes(value: unknown): RouteSummary[] {
  const routes = parseJsonField(value, [] as RouteSummary[]);
  if (!Array.isArray(routes)) return [];

  return routes
    .filter((route) => route && typeof route === "object")
    .map((route, index) => {
      const typed = route as Record<string, unknown>;
      return {
        id: String(typed.id ?? index),
        name: String(typed.name ?? `Route ${index + 1}`),
        from: typeof typed.from === "string" ? typed.from : undefined,
        to: typeof typed.to === "string" ? typed.to : undefined,
        distance: typeof typed.distance === "string" ? typed.distance : null,
        difficulty: typeof typed.difficulty === "string" ? typed.difficulty : null,
        description: typeof typed.description === "string" ? typed.description : undefined
      };
    });
}

function normaliseCampaignStatus(value: unknown): CampaignStatus {
  const status = typeof value === "string" ? value.toLowerCase() : "planning";
  if (status === "active" || status === "recruiting" || status === "paused" || status === "completed" || status === "planning") {
    return status;
  }
  return "planning";
}

function mapCampaignSummary(record: Record<string, unknown>): DMCampaignSummary {
  const levelRange = parseLevelRange(record.level_range ?? record.levelRange);
  return {
    id: String(record.id),
    name: String(record.name ?? "Untitled Campaign"),
    description: String(record.description ?? ""),
    status: normaliseCampaignStatus(record.status),
    system: String(record.system ?? "Unknown"),
    maxPlayers: toNumber(record.max_players ?? record.maxPlayers, 0),
    currentPlayers: toNumber(record.current_players ?? record.playerCount, 0),
    levelRange,
    createdAt: String(record.created_at ?? new Date().toISOString()),
    tags: parseStringArray(record.tags ?? record.campaign_tags ?? record.campaignTags),
    nextSession: parseDate(record.next_session ?? record.nextSession)
  };
}

function mapLocation(record: Record<string, unknown>): LocationSummary {
  return {
    id: String(record.id),
    name: String(record.name ?? "Unnamed Location"),
    type: String(record.type ?? "location"),
    description: String(record.description ?? ""),
    notes: typeof record.notes === "string" ? record.notes : undefined,
    population: record.population ? toNumber(record.population) : undefined,
    government: typeof record.government === "string" ? record.government : undefined,
    lng: record.lng !== undefined ? toNumber(record.lng) : undefined,
    lat: record.lat !== undefined ? toNumber(record.lat) : undefined
  };
}

function mapNpc(record: Record<string, unknown>): NpcSummary {
  return {
    id: String(record.id),
    name: String(record.name ?? "Unnamed NPC"),
    race: typeof record.race === "string" ? record.race : undefined,
    role: typeof record.occupation === "string" ? record.occupation : typeof record.role === "string" ? record.role : undefined,
    description: typeof record.description === "string" ? record.description : undefined,
    locationName: typeof record.location_name === "string" ? record.location_name : undefined
  };
}

function mapCampaignDetail(
  campaignRecord: Record<string, unknown>,
  locations: Record<string, unknown>[],
  npcs: Record<string, unknown>[]
): CampaignDetail {
  const summary = mapCampaignSummary(campaignRecord);
  return {
    ...summary,
    routes: parseRoutes(campaignRecord.routes),
    locations: locations.map(mapLocation),
    npcs: npcs.map(mapNpc)
  };
}

function mapCharacter(record: Record<string, unknown>): CharacterProfile {
  const hitPoints = parseJsonField<{ current?: number; max?: number }>(record.hit_points, { current: 0, max: 0 });
  const currentHP = toNumber(hitPoints.current, 0);
  const maxHP = Math.max(toNumber(hitPoints.max, 0), 0);

  return {
    id: String(record.id),
    name: String(record.name ?? "Unnamed Character"),
    className: String(record.class ?? record.character_class ?? "Unknown"),
    level: toNumber(record.level, 1),
    race: String(record.race ?? "Unknown"),
    hitPoints: { current: currentHP, max: maxHP },
    armorClass: toNumber(record.armor_class, 10),
    background: String(record.background ?? "Unknown"),
    campaigns: parseStringArray(record.campaigns),
    lastPlayed: parseDate(record.last_played ?? record.updated_at ?? record.created_at),
    avatar: typeof record.avatar_url === "string" ? record.avatar_url : undefined
  };
}

function mapPlayerCampaign(record: Record<string, unknown>, isJoined: boolean): PlayerCampaign {
  const summary = mapCampaignSummary(record);
  const status = summary.status;
  const statusWithCapacity =
    status === "recruiting" && summary.maxPlayers > 0 && summary.currentPlayers >= summary.maxPlayers ? "full" : status;

  return {
    id: summary.id,
    name: summary.name,
    description: summary.description,
    dmName: String(record.dm_username ?? record.dm ?? "Unknown DM"),
    status: statusWithCapacity,
    playerCount: summary.currentPlayers,
    maxPlayers: summary.maxPlayers,
    system: summary.system,
    levelRange: summary.levelRange,
    tags: summary.tags,
    nextSession: summary.nextSession,
    isJoined,
    characterName: isJoined && typeof record.character_name === "string" ? record.character_name : undefined
  };
}

function getLocationIcon(type: string) {
  switch (type) {
    case "city":
      return <Building className="w-4 h-4" />;
    case "town":
    case "village":
    case "burg":
      return <Home className="w-4 h-4" />;
    case "dungeon":
      return <Sword className="w-4 h-4" />;
    default:
      return <MapPin className="w-4 h-4" />;
  }
}

export function DMDashboard({ user, onEnterGame, onLogout }: DMDashboardProps) {
  const [activeTab, setActiveTab] = useState("campaigns");
  const [campaigns, setCampaigns] = useState<DMCampaignSummary[]>([]);
  const [characters, setCharacters] = useState<CharacterProfile[]>([]);
  const [playerCampaigns, setPlayerCampaigns] = useState<PlayerCampaign[]>([]);
  const [publicCampaigns, setPublicCampaigns] = useState<PlayerCampaign[]>([]);
  const [selectedCampaignId, setSelectedCampaignId] = useState<string | null>(null);
  const [selectedCampaign, setSelectedCampaign] = useState<CampaignDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  const selectedCampaignIdRef = useRef<string | null>(null);

  useEffect(() => {
    selectedCampaignIdRef.current = selectedCampaignId;
  }, [selectedCampaignId]);

  const loadCampaignDetail = useCallback(async (campaignId: string) => {
    setDetailLoading(true);
    try {
      const [campaignRes, locationsRes, npcsRes] = await Promise.all([
        apiFetch(`/api/campaigns/${campaignId}`),
        apiFetch(`/api/campaigns/${campaignId}/locations`),
        apiFetch(`/api/campaigns/${campaignId}/npcs`)
      ]);

      if (!campaignRes.ok) {
        throw new Error(await readErrorMessage(campaignRes, "Unable to load campaign details"));
      }

      const campaignPayload = await readJsonBody<Record<string, unknown> | { campaign: Record<string, unknown> }>(campaignRes);
      const campaignRecord = (campaignPayload.campaign ?? campaignPayload) as Record<string, unknown>;

      let locations: Record<string, unknown>[] = [];
      if (locationsRes.ok) {
        locations = await readJsonBody<Record<string, unknown>[]>(locationsRes);
      } else {
        const message = await readErrorMessage(locationsRes, "Failed to load campaign locations");
        toast.error(message);
      }

      let npcs: Record<string, unknown>[] = [];
      if (npcsRes.ok) {
        npcs = await readJsonBody<Record<string, unknown>[]>(npcsRes);
      } else {
        const message = await readErrorMessage(npcsRes, "Failed to load campaign NPCs");
        toast.error(message);
      }

      setSelectedCampaign(mapCampaignDetail(campaignRecord, locations, npcs));
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to load campaign details";
      toast.error(message);
      setSelectedCampaign(null);
    } finally {
      setDetailLoading(false);
    }
  }, []);

  const loadDashboardData = useCallback(async () => {
    if (!user?.id) return;

    setLoading(true);
    const collectedErrors: string[] = [];

    try {
      const response = await apiFetch(`/api/users/${user.id}/campaigns`);
      if (!response.ok) {
        throw new Error(await readErrorMessage(response, "Failed to load campaigns"));
      }

      const data = await readJsonBody<{ dmCampaigns?: Record<string, unknown>[]; playerCampaigns?: Record<string, unknown>[] }>(response);
      const dmCampaignRecords = (data.dmCampaigns ?? []) as Record<string, unknown>[];
      const playerCampaignRecords = (data.playerCampaigns ?? []) as Record<string, unknown>[];

      const mappedDmCampaigns = dmCampaignRecords.map(mapCampaignSummary);
      const mappedPlayerCampaigns = playerCampaignRecords.map((record) => mapPlayerCampaign(record, true));

      setCampaigns(mappedDmCampaigns);
      setPlayerCampaigns(mappedPlayerCampaigns);

      const currentSelectedId = selectedCampaignIdRef.current;
      const nextSelectedId = mappedDmCampaigns.length === 0
        ? null
        : currentSelectedId && mappedDmCampaigns.some((campaign) => campaign.id === currentSelectedId)
          ? currentSelectedId
          : mappedDmCampaigns[0].id;

      selectedCampaignIdRef.current = nextSelectedId;
      setSelectedCampaignId(nextSelectedId);

      if (nextSelectedId) {
        await loadCampaignDetail(nextSelectedId);
      } else {
        setSelectedCampaign(null);
      }
    } catch (err) {
      collectedErrors.push(err instanceof Error ? err.message : "Failed to load campaign data");
      setCampaigns([]);
      setPlayerCampaigns([]);
      setSelectedCampaign(null);
      selectedCampaignIdRef.current = null;
      setSelectedCampaignId(null);
    }

    try {
      const response = await apiFetch(`/api/users/${user.id}/characters`);
      if (!response.ok) {
        throw new Error(await readErrorMessage(response, "Failed to load characters"));
      }
      const payload = await readJsonBody<{ characters?: Record<string, unknown>[] }>(response);
      const rows = (payload.characters ?? []) as Record<string, unknown>[];
      setCharacters(rows.map(mapCharacter));
    } catch (err) {
      collectedErrors.push(err instanceof Error ? err.message : "Failed to load characters");
      setCharacters([]);
    }

    try {
      const response = await apiFetch(`/api/campaigns/public`);
      if (!response.ok) {
        throw new Error(await readErrorMessage(response, "Failed to load public campaigns"));
      }
      const rows = await readJsonBody<Record<string, unknown>[]>(response);
      setPublicCampaigns(rows.map((record) => mapPlayerCampaign(record, false)));
    } catch (err) {
      collectedErrors.push(err instanceof Error ? err.message : "Failed to load public campaigns");
      setPublicCampaigns([]);
    }

    setError(collectedErrors.length ? collectedErrors.join(". ") : null);
    setLoading(false);
  }, [loadCampaignDetail, user?.id]);

  useEffect(() => {
    loadDashboardData();
  }, [loadDashboardData]);

  const handleSelectCampaign = useCallback(async (campaignId: string) => {
    selectedCampaignIdRef.current = campaignId;
    setSelectedCampaignId(campaignId);
    await loadCampaignDetail(campaignId);
  }, [loadCampaignDetail]);

  const handleRefresh = useCallback(async () => {
    await loadDashboardData();
  }, [loadDashboardData]);

  const activeCampaigns = useMemo(
    () => campaigns.filter((campaign) => campaign.status === "active"),
    [campaigns]
  );

  const totalPlayers = useMemo(
    () => campaigns.reduce((sum, campaign) => sum + campaign.currentPlayers, 0),
    [campaigns]
  );

  const filteredPlayerCampaigns = useMemo(() => {
    if (!searchQuery) return publicCampaigns;
    const lowered = searchQuery.toLowerCase();
    return publicCampaigns.filter((campaign) =>
      campaign.name.toLowerCase().includes(lowered) ||
      campaign.description.toLowerCase().includes(lowered) ||
      campaign.tags.some((tag) => tag.toLowerCase().includes(lowered))
    );
  }, [publicCampaigns, searchQuery]);

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center gap-4">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
        <p className="text-muted-foreground">Loading Dungeon Master dashboard...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="border-b bg-card">
        <div className="flex items-center justify-between px-6 py-4">
          <div className="flex items-center gap-4">
            <Avatar className="w-10 h-10">
              <AvatarImage src={`https://avatar.vercel.sh/${user.username}`} />
              <AvatarFallback>{user.username.slice(0, 2).toUpperCase()}</AvatarFallback>
            </Avatar>
            <div>
              <h1 className="font-semibold">Welcome back, {user.username}!</h1>
              <p className="text-sm text-muted-foreground">Dungeon Master Dashboard</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={onEnterGame}
              disabled={activeCampaigns.length === 0}
            >
              <Play className="w-4 h-4 mr-1" />
              Enter Game
            </Button>
            <Button variant="ghost" size="sm" onClick={handleRefresh}>
              <Loader2 className="w-4 h-4 mr-1" />
              Refresh
            </Button>
            <Button variant="ghost" size="sm">
              <Settings className="w-4 h-4" />
            </Button>
            <Button variant="ghost" size="sm" onClick={onLogout}>
              <LogOut className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </div>

      {error && (
        <div className="px-6 py-3">
          <div className="flex items-center gap-2 rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            <AlertCircle className="w-4 h-4" />
            <span>{error}</span>
          </div>
        </div>
      )}

      <div className="px-6 py-4 border-b bg-muted/30">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="text-center">
            <div className="text-2xl font-bold">{campaigns.length}</div>
            <div className="text-sm text-muted-foreground">Total Campaigns</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold">{activeCampaigns.length}</div>
            <div className="text-sm text-muted-foreground">Active Campaigns</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold">{totalPlayers}</div>
            <div className="text-sm text-muted-foreground">Players Across Campaigns</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold">{selectedCampaign?.locations.length ?? 0}</div>
            <div className="text-sm text-muted-foreground">Locations in Selected Campaign</div>
          </div>
        </div>
      </div>

      <div className="p-6">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
          <TabsList>
            <TabsTrigger value="campaigns">Campaign Manager</TabsTrigger>
            <TabsTrigger value="player-tools">Player Tools</TabsTrigger>
          </TabsList>

          <TabsContent value="campaigns" className="space-y-6">
            <CampaignManager />

            <Card>
              <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <CardTitle>Campaign Overview</CardTitle>
                  <CardDescription>Live campaign, location, and NPC data pulled directly from the backend.</CardDescription>
                </div>
                <div className="flex items-center gap-2">
                  <Select
                    value={selectedCampaignId ?? ""}
                    onValueChange={(value) => handleSelectCampaign(value)}
                    disabled={campaigns.length === 0}
                  >
                    <SelectTrigger className="w-[240px]">
                      <SelectValue placeholder="Select campaign" />
                    </SelectTrigger>
                    <SelectContent>
                      {campaigns.map((campaign) => (
                        <SelectItem key={campaign.id} value={campaign.id}>
                          {campaign.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </CardHeader>
              <CardContent>
                {detailLoading && (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Refreshing campaign details…</span>
                  </div>
                )}

                {!detailLoading && !selectedCampaign && (
                  <p className="text-sm text-muted-foreground">Select a campaign to view the latest data.</p>
                )}

                {!detailLoading && selectedCampaign && (
                  <div className="space-y-6">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge className="capitalize">
                        {selectedCampaign.status}
                      </Badge>
                      <Badge variant="secondary">{selectedCampaign.system}</Badge>
                      <Badge variant="outline">
                        Levels {selectedCampaign.levelRange.min}-{selectedCampaign.levelRange.max}
                      </Badge>
                      {selectedCampaign.nextSession && (
                        <Badge variant="outline">
                          Next Session: {selectedCampaign.nextSession.toLocaleDateString()}
                        </Badge>
                      )}
                    </div>

                    {selectedCampaign.tags.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {selectedCampaign.tags.map((tag) => (
                          <Badge key={tag} variant="secondary" className="text-xs">
                            {tag}
                          </Badge>
                        ))}
                      </div>
                    )}

                    <p className="text-sm text-muted-foreground">{selectedCampaign.description || "No campaign summary provided."}</p>

                    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                      <Card>
                        <CardHeader className="pb-2">
                          <CardTitle className="text-base">Player Count</CardTitle>
                          <CardDescription>Active players in this campaign</CardDescription>
                        </CardHeader>
                        <CardContent>
                          <div className="text-2xl font-semibold">
                            {selectedCampaign.currentPlayers}/{selectedCampaign.maxPlayers}
                          </div>
                        </CardContent>
                      </Card>
                      <Card>
                        <CardHeader className="pb-2">
                          <CardTitle className="text-base">Locations</CardTitle>
                          <CardDescription>Tracked world locations</CardDescription>
                        </CardHeader>
                        <CardContent>
                          <div className="text-2xl font-semibold">{selectedCampaign.locations.length}</div>
                        </CardContent>
                      </Card>
                      <Card>
                        <CardHeader className="pb-2">
                          <CardTitle className="text-base">NPCs</CardTitle>
                          <CardDescription>Documented non-player characters</CardDescription>
                        </CardHeader>
                        <CardContent>
                          <div className="text-2xl font-semibold">{selectedCampaign.npcs.length}</div>
                        </CardContent>
                      </Card>
                    </div>

                    <div className="grid gap-4 lg:grid-cols-2">
                      <Card>
                        <CardHeader>
                          <CardTitle className="text-lg">Locations</CardTitle>
                          <CardDescription>Campaign locations and notes</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-3">
                          {selectedCampaign.locations.length === 0 && (
                            <p className="text-sm text-muted-foreground">No locations recorded for this campaign yet.</p>
                          )}
                          {selectedCampaign.locations.map((location) => (
                            <div key={location.id} className="rounded-md border p-3">
                              <div className="flex items-center gap-2 text-sm font-medium">
                                {getLocationIcon(location.type)}
                                <span>{location.name}</span>
                              </div>
                              {location.description && (
                                <p className="mt-2 text-sm text-muted-foreground">{location.description}</p>
                              )}
                              <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted-foreground">
                                <span className="capitalize">Type: {location.type}</span>
                                {location.population !== undefined && <span>Population: {location.population}</span>}
                                {location.government && <span>Government: {location.government}</span>}
                              </div>
                            </div>
                          ))}
                        </CardContent>
                      </Card>

                      <Card>
                        <CardHeader>
                          <CardTitle className="text-lg">NPCs</CardTitle>
                          <CardDescription>Key characters tied to this campaign</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-3">
                          {selectedCampaign.npcs.length === 0 && (
                            <p className="text-sm text-muted-foreground">No NPCs recorded for this campaign yet.</p>
                          )}
                          {selectedCampaign.npcs.map((npc) => (
                            <div key={npc.id} className="rounded-md border p-3">
                              <div className="flex items-center gap-2 text-sm font-medium">
                                <User className="w-4 h-4" />
                                <span>{npc.name}</span>
                              </div>
                              {(npc.role || npc.race) && (
                                <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted-foreground">
                                  {npc.role && <span>Role: {npc.role}</span>}
                                  {npc.race && <span>Race: {npc.race}</span>}
                                </div>
                              )}
                              {npc.description && (
                                <p className="mt-2 text-sm text-muted-foreground">{npc.description}</p>
                              )}
                              {npc.locationName && (
                                <p className="mt-2 text-xs text-muted-foreground">Last seen at {npc.locationName}</p>
                              )}
                            </div>
                          ))}
                        </CardContent>
                      </Card>
                    </div>

                    {selectedCampaign.routes.length > 0 && (
                      <Card>
                        <CardHeader>
                          <CardTitle className="text-lg">Routes</CardTitle>
                          <CardDescription>Travel paths stored with this campaign</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-3">
                          {selectedCampaign.routes.map((route) => (
                            <div key={route.id} className="rounded-md border p-3">
                              <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
                                <span>{route.name}</span>
                                {route.difficulty && (
                                  <Badge variant="outline" className="capitalize">{route.difficulty}</Badge>
                                )}
                              </div>
                              <div className="mt-2 text-xs text-muted-foreground flex flex-wrap gap-2">
                                {route.from && <span>From: {route.from}</span>}
                                {route.to && <span>To: {route.to}</span>}
                                {route.distance && <span>Distance: {route.distance}</span>}
                              </div>
                              {route.description && (
                                <p className="mt-2 text-sm text-muted-foreground">{route.description}</p>
                              )}
                            </div>
                          ))}
                        </CardContent>
                      </Card>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="player-tools" className="space-y-6">
            <div className="mb-6">
              <h2 className="text-xl font-semibold mb-2">Player Tools</h2>
              <p className="text-muted-foreground text-sm">
                Manage the characters and campaigns you participate in as a player. All data is synced directly from the live backend.
              </p>
            </div>

            <Tabs defaultValue="my-characters" className="space-y-6">
              <TabsList>
                <TabsTrigger value="my-characters">My Characters</TabsTrigger>
                <TabsTrigger value="my-player-campaigns">My Player Campaigns</TabsTrigger>
                <TabsTrigger value="browse-campaigns">Browse Campaigns</TabsTrigger>
              </TabsList>

              <TabsContent value="my-characters" className="space-y-6">
                {characters.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No characters found. Use the Character Manager to create one.</p>
                ) : (
                  <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {characters.map((character) => {
                      const healthPercent = character.hitPoints.max > 0
                        ? Math.min(100, Math.max(0, (character.hitPoints.current / character.hitPoints.max) * 100))
                        : 0;

                      return (
                        <Card key={character.id} className="hover:shadow-md transition-shadow">
                          <CardHeader className="pb-3">
                            <div className="flex items-center gap-3">
                              <Avatar className="w-12 h-12">
                                <AvatarImage src={character.avatar} />
                                <AvatarFallback>{character.name.slice(0, 2)}</AvatarFallback>
                              </Avatar>
                              <div className="flex-1">
                                <CardTitle className="text-lg">{character.name}</CardTitle>
                                <CardDescription>
                                  Level {character.level} {character.race} {character.className}
                                </CardDescription>
                              </div>
                            </div>
                          </CardHeader>
                          <CardContent className="space-y-4">
                            <div className="grid grid-cols-2 gap-4 text-sm">
                              <div className="flex items-center gap-2">
                                <Heart className="w-4 h-4 text-red-500" />
                                <span>{character.hitPoints.current}/{character.hitPoints.max} HP</span>
                              </div>
                              <div className="flex items-center gap-2">
                                <Shield className="w-4 h-4 text-blue-500" />
                                <span>AC {character.armorClass}</span>
                              </div>
                            </div>

                            <div>
                              <div className="flex justify-between text-sm mb-1">
                                <span>Health</span>
                                <span>{Math.round(healthPercent)}%</span>
                              </div>
                              <Progress value={healthPercent} />
                            </div>

                            <div className="flex justify-between text-xs text-muted-foreground">
                              <span>Background: {character.background}</span>
                              <span>
                                Last played: {character.lastPlayed ? character.lastPlayed.toLocaleDateString() : "N/A"}
                              </span>
                            </div>
                          </CardContent>
                        </Card>
                      );
                    })}
                  </div>
                )}
              </TabsContent>

              <TabsContent value="my-player-campaigns" className="space-y-6">
                {playerCampaigns.length === 0 ? (
                  <p className="text-sm text-muted-foreground">You're not currently active in any other DM's campaigns.</p>
                ) : (
                  <div className="space-y-4">
                    {playerCampaigns.map((campaign) => (
                      <Card key={campaign.id}>
                        <CardContent className="p-6">
                          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                            <div className="flex-1">
                              <div className="flex flex-wrap items-center gap-3 mb-2">
                                <div className={`w-3 h-3 rounded-full ${statusColorMap[campaign.status]}`} />
                                <h4 className="font-semibold text-lg">{campaign.name}</h4>
                                <Badge variant="outline" className="capitalize">{campaign.status}</Badge>
                              </div>

                              <p className="text-muted-foreground mb-3">{campaign.description}</p>

                              <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
                                <div className="flex items-center gap-1">
                                  <User className="w-4 h-4" />
                                  <span>DM: {campaign.dmName}</span>
                                </div>
                                <div className="flex items-center gap-1">
                                  <Users className="w-4 h-4" />
                                  <span>{campaign.playerCount}/{campaign.maxPlayers} players</span>
                                </div>
                                <div className="flex items-center gap-1">
                                  <MapIcon className="w-4 h-4" />
                                  <span>{campaign.system}</span>
                                </div>
                                <div className="flex items-center gap-1">
                                  <Star className="w-4 h-4" />
                                  <span>Levels {campaign.levelRange.min}-{campaign.levelRange.max}</span>
                                </div>
                                {campaign.nextSession && (
                                  <div className="flex items-center gap-1">
                                    <Calendar className="w-4 h-4" />
                                    <span>Next: {campaign.nextSession.toLocaleDateString()}</span>
                                  </div>
                                )}
                                {campaign.characterName && (
                                  <div className="flex items-center gap-1">
                                    <Badge variant="secondary">Character: {campaign.characterName}</Badge>
                                  </div>
                                )}
                              </div>

                              {campaign.tags.length > 0 && (
                                <div className="flex flex-wrap gap-1 mt-3">
                                  {campaign.tags.map((tag) => (
                                    <Badge key={tag} variant="secondary" className="text-xs">
                                      {tag}
                                    </Badge>
                                  ))}
                                </div>
                              )}
                            </div>

                            {campaign.status === "active" && (
                              <Button size="sm" onClick={onEnterGame} className="self-start">
                                <Play className="w-4 h-4 mr-1" />
                                Join Session
                              </Button>
                            )}
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                )}
              </TabsContent>

              <TabsContent value="browse-campaigns" className="space-y-6">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                  <div>
                    <h3 className="text-lg font-semibold">Browse Available Campaigns</h3>
                    <p className="text-sm text-muted-foreground">Public campaigns recruiting players. Reach out to the DM to request access.</p>
                  </div>
                  <div className="relative w-full lg:w-80">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground w-4 h-4" />
                    <Input
                      placeholder="Search campaigns..."
                      value={searchQuery}
                      onChange={(event) => setSearchQuery(event.target.value)}
                      className="pl-10"
                    />
                  </div>
                </div>

                <div className="space-y-4">
                  {filteredPlayerCampaigns.length === 0 && (
                    <p className="text-sm text-muted-foreground">No public campaigns found that match your search.</p>
                  )}
                  {filteredPlayerCampaigns.map((campaign) => (
                    <Card key={campaign.id}>
                      <CardContent className="p-6">
                        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                          <div className="flex-1">
                            <div className="flex flex-wrap items-center gap-3 mb-2">
                              <div className={`w-3 h-3 rounded-full ${statusColorMap[campaign.status]}`} />
                              <h4 className="font-semibold text-lg">{campaign.name}</h4>
                              <Badge variant="outline" className="capitalize">{campaign.status}</Badge>
                            </div>

                            <p className="text-muted-foreground mb-3">{campaign.description}</p>

                            <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
                              <div className="flex items-center gap-1">
                                <User className="w-4 h-4" />
                                <span>DM: {campaign.dmName}</span>
                              </div>
                              <div className="flex items-center gap-1">
                                <Users className="w-4 h-4" />
                                <span>{campaign.playerCount}/{campaign.maxPlayers} players</span>
                              </div>
                              <div className="flex items-center gap-1">
                                <MapIcon className="w-4 h-4" />
                                <span>{campaign.system}</span>
                              </div>
                              <div className="flex items-center gap-1">
                                <Star className="w-4 h-4" />
                                <span>Levels {campaign.levelRange.min}-{campaign.levelRange.max}</span>
                              </div>
                              {campaign.nextSession && (
                                <div className="flex items-center gap-1">
                                  <Calendar className="w-4 h-4" />
                                  <span>Next: {campaign.nextSession.toLocaleDateString()}</span>
                                </div>
                              )}
                            </div>

                            {campaign.tags.length > 0 && (
                              <div className="flex flex-wrap gap-1 mt-3">
                                {campaign.tags.map((tag) => (
                                  <Badge key={tag} variant="secondary" className="text-xs">
                                    {tag}
                                  </Badge>
                                ))}
                              </div>
                            )}
                          </div>

                          <div className="text-sm text-muted-foreground bg-muted/40 border rounded-md px-4 py-3 self-start">
                            Contact the DM to request access and confirm availability.
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </TabsContent>
            </Tabs>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
