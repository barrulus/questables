import { useCallback, useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { Input } from "./ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "./ui/avatar";
import { Progress } from "./ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "./ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { toast } from "sonner";
import {
  AlertCircle,
  Calendar,
  Edit,
  Eye,
  Heart,
  Loader2,
  LogOut,
  MapIcon,
  Info,
  Play,
  Plus,
  Search,
  Settings,
  Shield,
  Star,
  User,
  UserPlus,
  Users,
} from "lucide-react";
import { apiFetch, readErrorMessage, readJsonBody } from "../utils/api-client";
import { CharacterManager } from "./character-manager";
import { useGameSession } from "../contexts/GameSessionContext";

interface PlayerDashboardProps {
  user: { id: string; username: string; email: string; roles: string[]; role?: string };
  onEnterGame: () => void;
  onLogout: () => void;
}

type HitPoints = {
  current: number;
  max: number;
  temporary?: number;
};

type PlayerCharacter = {
  id: string;
  name: string;
  class: string;
  level: number;
  race: string;
  background: string;
  hitPoints: HitPoints;
  armorClass: number;
  avatarUrl?: string;
  lastPlayed?: string | null;
};

type PlayerCampaign = {
  id: string;
  name: string;
  description?: string | null;
  dmUserId: string;
  dmUsername?: string | null;
  status: "recruiting" | "active" | "paused" | "completed" | "full";
  maxPlayers: number;
  currentPlayers?: number;
  system: string;
  setting?: string | null;
  levelRange?: { min: number; max: number } | null;
  nextSession?: string | null;
  isPublic?: boolean;
  characterId?: string | null;
  characterName?: string | null;
};

type CharacterCampaignMap = Record<string, Array<{ id: string; name: string }>>;

type JoinState = {
  campaign: PlayerCampaign | null;
  selectedCharacterId: string | null;
  submitting: boolean;
};

type RawCharacter = {
  id: string;
  name?: string;
  class?: string;
  character_class?: string;
  level?: number;
  race?: string;
  background?: string;
  hit_points?: HitPoints | string | null;
  hitPoints?: HitPoints | string | null;
  armor_class?: number;
  armorClass?: number;
  avatar_url?: string | null;
  avatar?: string | null;
  last_played?: string | null;
  lastPlayed?: string | null;
};

type RawCampaign = {
  id: string;
  name?: string | null;
  description?: string | null;
  dm_user_id?: string;
  dmUserId?: string;
  dm_username?: string | null;
  dmUsername?: string | null;
  status?: PlayerCampaign["status"];
  max_players?: number | string | null;
  maxPlayers?: number | null;
  current_players?: number | string | null;
  system?: string | null;
  setting?: string | null;
  level_range?: { min: number; max: number } | string | null;
  levelRange?: { min: number; max: number } | null;
  next_session?: string | null;
  nextSession?: string | null;
  is_public?: boolean | null;
  isPublic?: boolean | null;
  character_id?: string | null;
  characterId?: string | null;
  character_name?: string | null;
  characterName?: string | null;
};

const isRawCharacter = (value: unknown): value is RawCharacter => {
  return Boolean(value) && typeof value === "object" && "id" in (value as Record<string, unknown>);
};

const isRawCampaign = (value: unknown): value is RawCampaign => {
  return Boolean(value) && typeof value === "object" && "id" in (value as Record<string, unknown>);
};

const parseJsonField = <T,>(value: unknown, fallback: T): T => {
  if (value === null || value === undefined) {
    return fallback;
  }

  if (typeof value === "string") {
    try {
      return JSON.parse(value) as T;
    } catch (error) {
      console.warn("Failed to parse JSON field", { value, error });
      return fallback;
    }
  }

  return value as T;
};

const mapCharacter = (raw: RawCharacter): PlayerCharacter => {
  const defaultHitPoints: HitPoints = { current: 0, max: 0 };
  const rawHitPoints = raw.hit_points ?? raw.hitPoints ?? defaultHitPoints;
  const parsedHitPoints = parseJsonField<HitPoints>(rawHitPoints, defaultHitPoints);

  return {
    id: raw.id,
    name: raw.name ?? "Unnamed Adventurer",
    class: raw.class ?? raw.character_class ?? "Adventurer",
    level: raw.level !== undefined ? Number(raw.level) : 1,
    race: raw.race ?? "Unknown",
    background: raw.background ?? "",
    hitPoints: {
      current: Number(parsedHitPoints.current ?? 0),
      max: Number(parsedHitPoints.max ?? 0),
      temporary: parsedHitPoints.temporary !== undefined
        ? Number(parsedHitPoints.temporary)
        : undefined,
    },
    armorClass: raw.armor_class !== undefined
      ? Number(raw.armor_class)
      : raw.armorClass !== undefined
        ? Number(raw.armorClass)
        : 0,
    avatarUrl: raw.avatar_url ?? raw.avatar ?? undefined,
    lastPlayed: raw.last_played ?? raw.lastPlayed ?? null,
  };
};

const mapCampaign = (raw: RawCampaign): PlayerCampaign => {
  const levelRange = parseJsonField<{ min: number; max: number }>(
    raw.level_range ?? raw.levelRange ?? { min: 1, max: 20 },
    { min: 1, max: 20 }
  );

  const currentPlayers = raw.current_players !== undefined && raw.current_players !== null
    ? Number(raw.current_players)
    : undefined;

  const status = raw.status ?? "recruiting";

  return {
    id: raw.id,
    name: raw.name ?? "Untitled Campaign",
    description: raw.description ?? null,
    dmUserId: raw.dm_user_id ?? raw.dmUserId ?? "",
    dmUsername: raw.dm_username ?? raw.dmUsername ?? null,
    status,
    maxPlayers: raw.max_players !== undefined && raw.max_players !== null
      ? Number(raw.max_players)
      : raw.maxPlayers !== undefined && raw.maxPlayers !== null
        ? Number(raw.maxPlayers)
        : 0,
    currentPlayers,
    system: raw.system ?? "Unknown",
    setting: raw.setting ?? null,
    levelRange,
    nextSession: raw.next_session ?? raw.nextSession ?? null,
    isPublic: Boolean(
      raw.is_public !== undefined && raw.is_public !== null
        ? raw.is_public
        : raw.isPublic ?? false
    ),
    characterId: raw.character_id ?? raw.characterId ?? null,
    characterName: raw.character_name ?? raw.characterName ?? null,
  };
};

const formatDate = (value?: string | null) => {
  if (!value) return "Unknown";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return date.toLocaleDateString();
};

const formatPercentage = (current: number, max: number) => {
  if (!max || max <= 0) return 0;
  const pct = (current / max) * 100;
  return Math.min(100, Math.max(0, Math.round(pct)));
};

export function PlayerDashboard({ user, onEnterGame, onLogout }: PlayerDashboardProps) {
  const [characters, setCharacters] = useState<PlayerCharacter[]>([]);
  const [playerCampaigns, setPlayerCampaigns] = useState<PlayerCampaign[]>([]);
  const [publicCampaigns, setPublicCampaigns] = useState<PlayerCampaign[]>([]);
  const [activeTab, setActiveTab] = useState("characters");
  const [searchQuery, setSearchQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [joinState, setJoinState] = useState<JoinState>({ campaign: null, selectedCharacterId: null, submitting: false });
  const [characterManagerOpen, setCharacterManagerOpen] = useState(false);
  const { activeCampaignId, selectCampaign } = useGameSession();

  const userId = user.id;

  const loadDashboardData = useCallback(async () => {
    if (!userId) return;

    try {
      setLoading(true);
      setError(null);

      const [charactersResponse, campaignsResponse, publicResponse] = await Promise.all([
        apiFetch(`/api/users/${userId}/characters`),
        apiFetch(`/api/users/${userId}/campaigns`),
        apiFetch(`/api/campaigns/public`),
      ]);

      if (!charactersResponse.ok) {
        throw new Error(await readErrorMessage(charactersResponse, "Failed to load characters"));
      }

      if (!campaignsResponse.ok) {
        throw new Error(await readErrorMessage(campaignsResponse, "Failed to load campaigns"));
      }

      if (!publicResponse.ok) {
        throw new Error(await readErrorMessage(publicResponse, "Failed to load public campaigns"));
      }

      const charactersJson: unknown = await readJsonBody<unknown>(charactersResponse);
      const campaignsJson: unknown = await readJsonBody<unknown>(campaignsResponse);
      const publicJson: unknown = await readJsonBody<unknown>(publicResponse);

      const mappedCharacters =
        Array.isArray((charactersJson as { characters?: unknown[] })?.characters)
          ? ((charactersJson as { characters: unknown[] }).characters
              .filter(isRawCharacter)
              .map(mapCharacter))
          : [];

      const mappedPlayerCampaigns =
        Array.isArray((campaignsJson as { playerCampaigns?: unknown[] })?.playerCampaigns)
          ? ((campaignsJson as { playerCampaigns: unknown[] }).playerCampaigns
              .filter(isRawCampaign)
              .map(mapCampaign))
          : [];

      const mappedPublicCampaigns = Array.isArray(publicJson)
        ? (publicJson as unknown[]).filter(isRawCampaign).map(mapCampaign)
        : [];

      setCharacters(mappedCharacters);
      setPlayerCampaigns(mappedPlayerCampaigns);
      setPublicCampaigns(mappedPublicCampaigns);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to load dashboard data";
      setError(message);
      console.error("[PlayerDashboard] loadDashboardData error", err);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    loadDashboardData();
  }, [loadDashboardData]);

  const characterCampaignMap: CharacterCampaignMap = useMemo(() => {
    return playerCampaigns.reduce<CharacterCampaignMap>((acc, campaign) => {
      if (!campaign.characterId) {
        return acc;
      }

      if (!acc[campaign.characterId]) {
        acc[campaign.characterId] = [];
      }

      acc[campaign.characterId].push({ id: campaign.id, name: campaign.name });
      return acc;
    }, {});
  }, [playerCampaigns]);

  const joinedCampaignIds = useMemo(() => new Set(playerCampaigns.map((campaign) => campaign.id)), [playerCampaigns]);

  const combinedCampaigns = useMemo(() => {
    const campaigns = new Map<string, PlayerCampaign>();
    playerCampaigns.forEach((campaign) => campaigns.set(campaign.id, campaign));
    publicCampaigns.forEach((campaign) => {
      if (!campaigns.has(campaign.id)) {
        campaigns.set(campaign.id, campaign);
      } else {
        const existing = campaigns.get(campaign.id)!;
        campaigns.set(campaign.id, {
          ...existing,
          currentPlayers: campaign.currentPlayers ?? existing.currentPlayers,
          isPublic: campaign.isPublic ?? existing.isPublic,
        });
      }
    });
    return Array.from(campaigns.values());
  }, [playerCampaigns, publicCampaigns]);

  const filteredCampaigns = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLowerCase();
    if (!normalizedQuery) {
      return combinedCampaigns;
    }

    return combinedCampaigns.filter((campaign) => {
      const text = `${campaign.name} ${campaign.description ?? ""} ${campaign.dmUsername ?? ""} ${campaign.system ?? ""}`.toLowerCase();
      return text.includes(normalizedQuery);
    });
  }, [combinedCampaigns, searchQuery]);

  const activeCampaigns = useMemo(() => playerCampaigns.filter((campaign) => campaign.status === "active"), [playerCampaigns]);

  useEffect(() => {
    if (loading) {
      return;
    }
    if (activeCampaigns.length === 0 || activeCampaignId) {
      return;
    }

    const defaultCampaign = activeCampaigns[0];
    if (defaultCampaign) {
      void selectCampaign(defaultCampaign.id).catch((selectionError) => {
        console.error("[PlayerDashboard] Failed to set default active campaign:", selectionError);
      });
    }
  }, [activeCampaignId, activeCampaigns, loading, selectCampaign]);

  const handleSelectCampaign = useCallback(
    async (campaignId: string, { silent = false } = {}) => {
      try {
        await selectCampaign(campaignId);
        if (!silent) {
          toast.success("Campaign selected. You're ready to play.");
        }
      } catch (launchError) {
        const message = launchError instanceof Error ? launchError.message : "Failed to open campaign";
        toast.error(message);
        console.error("[PlayerDashboard] selectCampaign error", launchError);
      }
    },
    [selectCampaign]
  );

  const launchCampaign = useCallback(
    async (campaignId: string) => {
      try {
        await handleSelectCampaign(campaignId, { silent: true });
        onEnterGame();
      } catch (launchError) {
        const message = launchError instanceof Error ? launchError.message : "Failed to open campaign";
        toast.error(message);
        console.error("[PlayerDashboard] launchCampaign error", launchError);
      }
    },
    [handleSelectCampaign, onEnterGame]
  );

  const totalCharacterLevels = useMemo(
    () => characters.reduce((sum, character) => sum + character.level, 0),
    [characters]
  );

  const handleOpenJoinDialog = (campaign: PlayerCampaign) => {
    if (characters.length === 0) {
      toast.error("Create a character before joining a campaign.");
      return;
    }

    if (joinedCampaignIds.has(campaign.id)) {
      toast.info("You are already part of this campaign.");
      return;
    }

    setJoinState({ campaign, selectedCharacterId: characters[0].id, submitting: false });
  };

  const handleCloseJoinDialog = () => {
    setJoinState({ campaign: null, selectedCharacterId: null, submitting: false });
  };

  const handleConfirmJoin = async () => {
    if (!joinState.campaign || !joinState.selectedCharacterId) {
      toast.error("Select a character to join the campaign.");
      return;
    }

    try {
      setJoinState((current) => ({ ...current, submitting: true }));
      const response = await apiFetch(`/api/campaigns/${joinState.campaign.id}/players`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          userId,
          characterId: joinState.selectedCharacterId,
        }),
      });

      if (!response.ok) {
        throw new Error(await readErrorMessage(response, "Failed to join campaign"));
      }

      toast.success("Join request submitted successfully.");
      handleCloseJoinDialog();
      await loadDashboardData();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to join campaign";
      toast.error(message);
      console.error("[PlayerDashboard] handleConfirmJoin error", err);
    } finally {
      setJoinState((current) => ({ ...current, submitting: false }));
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "active":
        return "bg-green-500";
      case "recruiting":
        return "bg-blue-500";
      case "full":
        return "bg-yellow-500";
      case "completed":
        return "bg-gray-500";
      default:
        return "bg-gray-500";
    }
  };

  const getStatusBadgeVariant = (status: string) => {
    switch (status) {
      case "active":
        return "default" as const;
      case "recruiting":
        return "secondary" as const;
      case "full":
      case "completed":
        return "outline" as const;
      default:
        return "outline" as const;
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4" />
          <p className="text-muted-foreground">Loading your dashboard…</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center px-6">
        <Card className="max-w-lg w-full">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertCircle className="w-5 h-5 text-destructive" />
              Unable to load dashboard
            </CardTitle>
            <CardDescription>{error}</CardDescription>
          </CardHeader>
          <CardContent className="flex gap-2 justify-end">
            <Button variant="outline" onClick={loadDashboardData}>
              Retry
            </Button>
            <Button variant="ghost" onClick={onLogout}>
              Return to Login
            </Button>
          </CardContent>
        </Card>
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
              <p className="text-sm text-muted-foreground">Player Dashboard</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                if (activeCampaignId) {
                  void launchCampaign(activeCampaignId);
                }
              }}
              disabled={!activeCampaignId}
            >
              <Play className="w-4 h-4 mr-1" />
              Enter Game
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

      <div className="px-6 py-4 border-b bg-muted/30">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="text-center">
            <div className="text-2xl font-bold">{characters.length}</div>
            <div className="text-sm text-muted-foreground">Characters</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold">{playerCampaigns.length}</div>
            <div className="text-sm text-muted-foreground">Joined Campaigns</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold">{activeCampaigns.length}</div>
            <div className="text-sm text-muted-foreground">Active Right Now</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold">{totalCharacterLevels}</div>
            <div className="text-sm text-muted-foreground">Total Character Levels</div>
          </div>
        </div>
      </div>

      <div className="p-6">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
          <TabsList>
            <TabsTrigger value="characters">My Characters</TabsTrigger>
            <TabsTrigger value="campaigns">My Campaigns</TabsTrigger>
            <TabsTrigger value="browse">Browse Campaigns</TabsTrigger>
          </TabsList>

          <TabsContent value="characters" className="space-y-6">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-semibold">Your Characters</h2>
              <Button onClick={() => setCharacterManagerOpen(true)}>
                <Plus className="w-4 h-4 mr-1" />
                Create Character
              </Button>
            </div>

            {characters.length === 0 ? (
              <Card className="border-dashed">
                <CardContent className="py-10 text-center space-y-3">
                  <Info className="w-10 h-10 mx-auto text-muted-foreground" />
                  <div>
                    <p className="font-medium">No characters yet</p>
                    <p className="text-sm text-muted-foreground">Create a character to start joining campaigns.</p>
                  </div>
                  <Button onClick={() => setCharacterManagerOpen(true)}>
                    <Plus className="w-4 h-4 mr-1" />
                    Create Character
                  </Button>
                </CardContent>
              </Card>
            ) : (
              <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
                {characters.map((character) => {
                  const campaignsForCharacter = characterCampaignMap[character.id] ?? [];
                  const healthPercentage = formatPercentage(character.hitPoints.current, character.hitPoints.max);

                  return (
                    <Card key={character.id} className="hover:shadow-md transition-shadow">
                      <CardHeader className="pb-3">
                        <div className="flex items-center gap-3">
                          <Avatar className="w-12 h-12">
                            <AvatarImage src={character.avatarUrl} />
                            <AvatarFallback>{character.name.slice(0, 2)}</AvatarFallback>
                          </Avatar>
                          <div className="flex-1">
                            <CardTitle className="text-lg">{character.name}</CardTitle>
                            <CardDescription>
                              Level {character.level} {character.race} {character.class}
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
                            <span>{healthPercentage}%</span>
                          </div>
                          <Progress value={healthPercentage} />
                        </div>

                        <div className="flex justify-between text-xs text-muted-foreground">
                          <span>Background: {character.background || "—"}</span>
                          <span>Last played: {formatDate(character.lastPlayed)}</span>
                        </div>

                        <div className="text-xs">
                          <span className="font-medium text-muted-foreground">Campaigns:</span>{" "}
                          {campaignsForCharacter.length > 0 ? (
                            campaignsForCharacter.map((campaign, index) => (
                              <span key={campaign.id}>
                                {campaign.name}
                                {index < campaignsForCharacter.length - 1 ? ", " : ""}
                              </span>
                            ))
                          ) : (
                            <span className="text-muted-foreground">Not assigned</span>
                          )}
                        </div>

                        <div className="flex gap-2">
                          <Button variant="outline" size="sm" className="flex-1">
                            <Edit className="w-4 h-4 mr-1" />
                            Edit
                          </Button>
                          <Button
                            size="sm"
                            className="flex-1"
                            onClick={() => setActiveTab("campaigns")}
                          >
                            <Users className="w-4 h-4 mr-1" />
                            View Campaigns
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}
          </TabsContent>

          <TabsContent value="campaigns" className="space-y-6">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-semibold">Your Campaigns</h2>
            </div>

            {playerCampaigns.length === 0 ? (
              <Card className="border-dashed">
                <CardContent className="py-10 text-center space-y-3">
                  <Info className="w-10 h-10 mx-auto text-muted-foreground" />
                  <div>
                    <p className="font-medium">You have not joined any campaigns yet</p>
                    <p className="text-sm text-muted-foreground">Browse public campaigns to find your next adventure.</p>
                  </div>
                  <Button onClick={() => setActiveTab("browse")}>
                    <Search className="w-4 h-4 mr-1" />
                    Browse Campaigns
                  </Button>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-4">
                {playerCampaigns.map((campaign) => (
                  <Card key={campaign.id}>
                    <CardContent className="p-6">
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-3 mb-2">
                            <div className={`w-3 h-3 rounded-full ${getStatusColor(campaign.status)}`} />
                            <h3 className="font-semibold text-lg">{campaign.name}</h3>
                            <Badge variant={getStatusBadgeVariant(campaign.status)} className="capitalize">
                              {campaign.status}
                            </Badge>
                          </div>

                          <p className="text-muted-foreground mb-3">{campaign.description || "No description provided."}</p>

                          <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
                            <div className="flex items-center gap-1">
                              <User className="w-4 h-4" />
                              <span>DM: {campaign.dmUsername || "Unknown"}</span>
                            </div>
                            <div className="flex items-center gap-1">
                              <Users className="w-4 h-4" />
                              <span>
                                {campaign.currentPlayers !== undefined
                                  ? `${campaign.currentPlayers}/${campaign.maxPlayers} players`
                                  : `${campaign.maxPlayers} max players`}
                              </span>
                            </div>
                            <div className="flex items-center gap-1">
                              <MapIcon className="w-4 h-4" />
                              <span>{campaign.system}</span>
                            </div>
                            {campaign.levelRange && (
                              <div className="flex items-center gap-1">
                                <Star className="w-4 h-4" />
                                <span>Levels {campaign.levelRange.min}-{campaign.levelRange.max}</span>
                              </div>
                            )}
                            {campaign.nextSession && (
                              <div className="flex items-center gap-1">
                                <Calendar className="w-4 h-4" />
                                <span>Next: {formatDate(campaign.nextSession)}</span>
                              </div>
                            )}
                          </div>

                          {campaign.characterName && (
                            <div className="mt-3 text-sm text-muted-foreground">
                              Playing as <span className="font-medium text-foreground">{campaign.characterName}</span>
                            </div>
                          )}
                        </div>

                        <div className="flex gap-2 ml-4">
                          <Button variant="outline" size="sm">
                            <Eye className="w-4 h-4 mr-1" />
                            View
                          </Button>
                          {campaign.characterId && campaign.characterName ? (
                            campaign.id === activeCampaignId ? (
                              <button
                                type="button"
                                data-slot="button"
                                onClick={() => void launchCampaign(campaign.id)}
                                className="inline-flex items-center justify-center whitespace-nowrap text-sm font-medium transition-all disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 [&_svg]:shrink-0 outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive bg-primary text-primary-foreground hover:bg-primary/90 h-8 rounded-md gap-1.5 px-3 has-[>svg]:px-2.5"
                              >
                                <Play className="w-4 h-4 mr-1" />
                                Play
                              </button>
                            ) : (
                              <Button size="sm" onClick={() => void handleSelectCampaign(campaign.id)}>
                                <Play className="w-4 h-4 mr-1" />
                                Set Active
                              </Button>
                            )
                          ) : null}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="browse" className="space-y-6">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-semibold">Browse Campaigns</h2>
              <div className="relative w-full max-w-md">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground w-4 h-4" />
                <Input
                  placeholder="Search campaigns..."
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  className="pl-10"
                />
              </div>
            </div>

            {filteredCampaigns.length === 0 ? (
              <Card className="border-dashed">
                <CardContent className="py-10 text-center space-y-3">
                  <Info className="w-10 h-10 mx-auto text-muted-foreground" />
                  <div>
                    <p className="font-medium">No campaigns match your search</p>
                    <p className="text-sm text-muted-foreground">Try a different keyword or clear the search field.</p>
                  </div>
                  <Button variant="outline" onClick={() => setSearchQuery("")}>
                    Clear search
                  </Button>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-4">
                {filteredCampaigns.map((campaign) => {
                  const isJoined = joinedCampaignIds.has(campaign.id);
                  const isRecruiting = campaign.status === "recruiting";

                  return (
                    <Card key={campaign.id} className={isJoined ? "ring-2 ring-primary/20" : ""}>
                      <CardContent className="p-6">
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            <div className="flex items-center gap-3 mb-2">
                              <div className={`w-3 h-3 rounded-full ${getStatusColor(campaign.status)}`} />
                              <h3 className="font-semibold text-lg">{campaign.name}</h3>
                              <Badge variant={getStatusBadgeVariant(campaign.status)} className="capitalize">
                                {campaign.status}
                              </Badge>
                              {isJoined && (
                                <Badge variant="outline" className="text-green-600 border-green-600">
                                  Joined
                                </Badge>
                              )}
                            </div>

                            <p className="text-muted-foreground mb-3">{campaign.description || "No description provided."}</p>

                            <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
                              <div className="flex items-center gap-1">
                                <User className="w-4 h-4" />
                                <span>DM: {campaign.dmUsername || "Unknown"}</span>
                              </div>
                              <div className="flex items-center gap-1">
                                <Users className="w-4 h-4" />
                                <span>
                                  {campaign.currentPlayers !== undefined
                                    ? `${campaign.currentPlayers}/${campaign.maxPlayers} players`
                                    : `${campaign.maxPlayers} max players`}
                                </span>
                              </div>
                              <div className="flex items-center gap-1">
                                <MapIcon className="w-4 h-4" />
                                <span>{campaign.system}</span>
                              </div>
                              {campaign.levelRange && (
                                <div className="flex items-center gap-1">
                                  <Star className="w-4 h-4" />
                                  <span>Levels {campaign.levelRange.min}-{campaign.levelRange.max}</span>
                                </div>
                              )}
                              {campaign.isPublic && <Badge variant="secondary">Public</Badge>}
                            </div>
                          </div>

                          <div className="flex gap-2 ml-4">
                            <Button variant="outline" size="sm">
                              <Eye className="w-4 h-4 mr-1" />
                              View Details
                            </Button>
                            {!isJoined && isRecruiting && (
                              <Button
                                size="sm"
                                onClick={() => handleOpenJoinDialog(campaign)}
                              >
                                <UserPlus className="w-4 h-4 mr-1" />
                                Request to Join
                              </Button>
                            )}
                            {isJoined && campaign.characterId && campaign.characterName && (
                              campaign.id === activeCampaignId ? (
                                <button
                                  type="button"
                                  data-slot="button"
                                  onClick={() => void launchCampaign(campaign.id)}
                                  className="inline-flex items-center justify-center whitespace-nowrap text-sm font-medium transition-all disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 [&_svg]:shrink-0 outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive bg-primary text-primary-foreground hover:bg-primary/90 h-8 rounded-md gap-1.5 px-3 has-[>svg]:px-2.5"
                                >
                                  <Play className="w-4 h-4 mr-1" />
                                  Play
                                </button>
                              ) : (
                                <Button size="sm" onClick={() => void handleSelectCampaign(campaign.id)}>
                                  <Play className="w-4 h-4 mr-1" />
                                  Set Active
                                </Button>
                              )
                            )}
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>

      <Dialog open={Boolean(joinState.campaign)} onOpenChange={(open) => (!open ? handleCloseJoinDialog() : undefined)}>
        {joinState.campaign && (
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Select a character</DialogTitle>
              <DialogDescription>
                Choose which character you want to bring into {joinState.campaign.name}.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              <div>
                <p className="text-sm text-muted-foreground mb-2">Character</p>
                <Select
                  value={joinState.selectedCharacterId ?? ""}
                  onValueChange={(value) =>
                    setJoinState((current) => ({ ...current, selectedCharacterId: value }))
                  }
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select a character" />
                  </SelectTrigger>
                  <SelectContent>
                    {characters.map((character) => (
                      <SelectItem key={character.id} value={character.id}>
                        {character.name} — Level {character.level} {character.class}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={handleCloseJoinDialog} disabled={joinState.submitting}>
                Cancel
              </Button>
              <Button onClick={handleConfirmJoin} disabled={!joinState.selectedCharacterId || joinState.submitting}>
                {joinState.submitting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                Confirm Join
              </Button>
            </DialogFooter>
          </DialogContent>
        )}
      </Dialog>

      <Dialog open={characterManagerOpen} onOpenChange={setCharacterManagerOpen}>
        <DialogContent className="max-w-[1100px] w-full max-h-[90vh] overflow-hidden p-0">
          <DialogHeader className="px-6 pt-6 pb-4">
            <DialogTitle>Character Manager</DialogTitle>
            <DialogDescription>
              Create, edit, and delete your characters using the live database. Changes apply immediately.
            </DialogDescription>
          </DialogHeader>
          <div className="h-[78vh]">
            <CharacterManager />
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
