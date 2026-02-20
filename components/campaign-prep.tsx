import { useCallback, useEffect, useMemo, useState, type ReactElement } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "./ui/alert";
import { Button } from "./ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
import { Badge } from "./ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "./ui/dialog";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Textarea } from "./ui/textarea";
import { Skeleton } from "./ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { CampaignPrepMap, type CampaignPrepMapProps, type MapContextDetails, type MapFeatureDetails } from "./campaign-prep-map";
import { ObjectivesPanel } from "./objectives-panel";
import SessionManager from "./session-manager";
import type { Campaign } from "./campaign-shared";
import {
  listCampaignSpawns,
  listCampaignObjectives,
  listCampaignRegions,
  createCampaignRegion,
  searchWorldBurgs,
  updateObjectiveLocation,
  upsertCampaignSpawn,
  type SpawnPoint,
  type ObjectiveRecord,
  type CampaignRegion,
  type BurgSearchResult,
  type CampaignRegionCategory,
  type ObjectiveLocationPayload,
} from "../utils/api-client";
import { apiFetch, readErrorMessage, readJsonBody } from "../utils/api-client";
import { useUser } from "../contexts/UserContext";
import { useGameSession } from "../contexts/GameSessionContext";

interface CampaignPrepProps {
  campaign: Campaign | null;
  viewerOverride?: { id: string; roles?: string[] | null } | null;
  worldMapOverride?: WorldMapRecord | null;
  spawnOverride?: SpawnPoint | null;
  loadSpawnsOverride?: (_campaignId: string) => Promise<SpawnPoint[]>;
  upsertSpawnOverride?: (
    _campaignId: string,
    _payload: { position: { x: number; y: number }; note: string | null }
  ) => Promise<SpawnPoint>;
  mapComponent?: (_props: CampaignPrepMapProps) => ReactElement;
}

interface WorldMapRecord {
  id: string;
  name: string;
  bounds: {
    north: number;
    south: number;
    east: number;
    west: number;
  };
  width_pixels?: number | null;
  height_pixels?: number | null;
  meters_per_pixel?: number | null;
}

type MapLocationKind = "pin" | "burg" | "marker" | "region";

const REGION_CATEGORY_OPTIONS: Array<{ value: CampaignRegionCategory; label: string }> = [
  { value: "encounter", label: "Encounter" },
  { value: "rumour", label: "Rumour" },
  { value: "narrative", label: "Narrative" },
  { value: "travel", label: "Travel" },
  { value: "custom", label: "Custom" },
];

const parseBounds = (value: unknown): WorldMapRecord["bounds"] | null => {
  if (!value) return null;
  if (typeof value === "object" && value !== null) {
    const candidate = value as Record<string, unknown>;
    const north = Number(candidate.north);
    const south = Number(candidate.south);
    const east = Number(candidate.east);
    const west = Number(candidate.west);
    if ([north, south, east, west].every((coordinate) => Number.isFinite(coordinate))) {
      if (east <= west || north <= south) {
        return null;
      }
      return { north, south, east, west };
    }
    return null;
  }

  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return parseBounds(parsed);
    } catch {
      return null;
    }
  }

  return null;
};

export function CampaignPrep({
  campaign,
  viewerOverride,
  worldMapOverride,
  spawnOverride,
  loadSpawnsOverride,
  upsertSpawnOverride,
  mapComponent,
}: CampaignPrepProps) {
  const { user: contextUser } = useUser();
  const user = viewerOverride === undefined
    ? contextUser
    : viewerOverride ?? null;
  const { activeCampaignId, viewerRole } = useGameSession();
  const [worldMap, setWorldMap] = useState<WorldMapRecord | null>(worldMapOverride ?? null);
  const [worldMapLoading, setWorldMapLoading] = useState(worldMapOverride === undefined);
  const [worldMapError, setWorldMapError] = useState<string | null>(null);

  const [spawn, setSpawn] = useState<SpawnPoint | null>(spawnOverride ?? null);
  const [spawnLoading, setSpawnLoading] = useState(spawnOverride === undefined);
  const [spawnError, setSpawnError] = useState<string | null>(null);

  const [editing, setEditing] = useState(false);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [pendingPosition, setPendingPosition] = useState<{ x: number; y: number } | null>(null);
  const [noteDraft, setNoteDraft] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [regions, setRegions] = useState<CampaignRegion[]>([]);
  const [regionDialogOpen, setRegionDialogOpen] = useState(false);
  const [pendingRegionGeometry, setPendingRegionGeometry] = useState<Record<string, unknown> | null>(null);
  const [regionSeedContext, setRegionSeedContext] = useState<MapContextDetails | null>(null);
  const [regionSaving, setRegionSaving] = useState(false);
  const [regionError, setRegionError] = useState<string | null>(null);
  const [regionName, setRegionName] = useState("");
  const [regionCategory, setRegionCategory] = useState<CampaignRegionCategory>("custom");
  const [regionColor, setRegionColor] = useState("#0ea5e9");
  const [regionDescription, setRegionDescription] = useState("");
  const [objectiveLinkContext, setObjectiveLinkContext] = useState<{
    context: MapContextDetails;
    defaultKind: "pin" | "burg" | "marker" | "region";
    label: string;
  } | null>(null);
  const [objectiveDialogOpen, setObjectiveDialogOpen] = useState(false);
  const [objectiveOptions, setObjectiveOptions] = useState<ObjectiveRecord[]>([]);
  const [objectiveSelection, setObjectiveSelection] = useState<string | null>(null);
  const [objectiveLocationKind, setObjectiveLocationKind] = useState<"pin" | "burg" | "marker" | "region">("pin");
  const [objectiveLoading, setObjectiveLoading] = useState(false);
  const [objectiveError, setObjectiveError] = useState<string | null>(null);
  const [objectiveSaving, setObjectiveSaving] = useState(false);
  const [objectivesRefreshKey, setObjectivesRefreshKey] = useState(0);
  const [burgQuery, setBurgQuery] = useState("");
  const [burgResults, setBurgResults] = useState<BurgSearchResult[]>([]);
  const [burgSearching, setBurgSearching] = useState(false);
  const [highlightPoint, setHighlightPoint] = useState<{ coordinate: [number, number]; label?: string | null } | null>(null);
  const [featureDetails, setFeatureDetails] = useState<MapFeatureDetails | null>(null);

  const refreshRegions = useCallback(async () => {
    if (!campaign?.id) return;
    try {
      const data = await listCampaignRegions(campaign.id);
      setRegions(data);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to load campaign regions";
      toast.error(message);
    }
  }, [campaign?.id]);

  const loadObjectiveOptions = useCallback(async () => {
    if (!campaign?.id) return;
    setObjectiveLoading(true);
    try {
      const records = await listCampaignObjectives(campaign.id);
      setObjectiveOptions(records);
      setObjectiveError(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to load objectives";
      setObjectiveError(message);
    } finally {
      setObjectiveLoading(false);
    }
  }, [campaign?.id]);

  const deriveLocationKind = useCallback((context: MapContextDetails): MapLocationKind => {
    const normalized = context.featureType?.toLowerCase();
    if (normalized === "burg") return "burg";
    if (normalized === "marker") return "marker";
    if (normalized === "region") return "region";
    return "pin";
  }, []);

  const extractFeatureLabel = useCallback((context: MapContextDetails): string => {
    const feature = context.feature;
    if (feature) {
      const name = feature.get("name");
      if (typeof name === "string" && name.trim()) {
        return name.trim();
      }
      const data = feature.get("data") as Record<string, unknown> | undefined;
      const dataName = data && typeof data.name === "string" ? data.name : null;
      if (dataName) {
        return dataName;
      }
    }
    return `(${context.coordinate[0].toFixed(1)}, ${context.coordinate[1].toFixed(1)})`;
  }, []);

  const isCampaignDm = useMemo(() => {
    if (!user || !campaign) return false;
    if (user.roles?.includes("admin")) return true;
    return user.id === campaign.dm_user_id;
  }, [campaign, user]);

  const campaignId = campaign?.id ?? null;
  const normalizedViewerRole = typeof viewerRole === "string" ? viewerRole.toLowerCase() : null;
  const isCampaignCoDm = useMemo(() => {
    if (!campaignId || !normalizedViewerRole) {
      return false;
    }
    if (normalizedViewerRole !== "co-dm") {
      return false;
    }
    return activeCampaignId === campaignId;
  }, [activeCampaignId, campaignId, normalizedViewerRole]);

  const canManageSessions = Boolean(campaignId && (isCampaignDm || isCampaignCoDm));

  const loadWorldMap = useCallback(async () => {
    if (!campaign?.world_map_id) {
      setWorldMap(null);
      setWorldMapError(null);
      return;
    }

    setWorldMapLoading(true);
    setWorldMapError(null);
    try {
      const response = await apiFetch(`/api/maps/world/${campaign.world_map_id}`);
      if (!response.ok) {
        throw new Error(await readErrorMessage(response, "Failed to load world map"));
      }
      const payload = await readJsonBody<Record<string, unknown>>(response);
      const bounds = parseBounds(payload?.bounds);
      if (!bounds) {
        throw new Error("World map is missing bounds; regenerate the map metadata before using the prep view.");
      }

      const widthPixels = Number(payload.width_pixels);
      const heightPixels = Number(payload.height_pixels);
      const metersPerPixel = Number(payload.meters_per_pixel);

      setWorldMap({
        id: String(payload.id ?? campaign.world_map_id),
        name: typeof payload.name === "string" && payload.name.trim() ? String(payload.name) : "World Map",
        bounds,
        width_pixels: Number.isFinite(widthPixels) && widthPixels > 0 ? widthPixels : null,
        height_pixels: Number.isFinite(heightPixels) && heightPixels > 0 ? heightPixels : null,
        meters_per_pixel: Number.isFinite(metersPerPixel) && metersPerPixel > 0 ? metersPerPixel : null,
      });
    } catch (error) {
      setWorldMapError(error instanceof Error ? error.message : "Failed to load world map");
      setWorldMap(null);
    } finally {
      setWorldMapLoading(false);
    }
  }, [campaign]);

  const loadSpawn = useCallback(async () => {
    if (!campaign) {
      setSpawn(null);
      setSpawnError(null);
      return;
    }

    setSpawnLoading(true);
    setSpawnError(null);
    try {
      const loader = loadSpawnsOverride ?? listCampaignSpawns;
      const spawns = await loader(campaign.id);
      const defaultSpawn = spawns.find((item) => item.isDefault) ?? spawns[0] ?? null;
      setSpawn(defaultSpawn ?? null);
    } catch (error) {
      setSpawnError(error instanceof Error ? error.message : "Failed to load spawn data");
      setSpawn(null);
    } finally {
      setSpawnLoading(false);
    }
  }, [campaign]);

  useEffect(() => {
    if (worldMapOverride !== undefined) {
      setWorldMap(worldMapOverride);
      setWorldMapError(null);
      setWorldMapLoading(false);
      return;
    }
    void loadWorldMap();
  }, [loadWorldMap, worldMapOverride]);

  useEffect(() => {
    if (spawnOverride !== undefined) {
      setSpawn(spawnOverride);
      setSpawnError(null);
      setSpawnLoading(false);
      return;
    }
    void loadSpawn();
  }, [loadSpawn, spawnOverride]);

  useEffect(() => {
    setEditing(false);
    setIsDialogOpen(false);
    setPendingPosition(null);
  }, [campaign?.id]);

  useEffect(() => {
    if (!campaign?.id || !worldMap) return;
    void refreshRegions();
  }, [campaign?.id, refreshRegions, worldMap]);

  useEffect(() => {
    if (!worldMap) {
      setBurgResults([]);
      setBurgSearching(false);
      return;
    }

    const trimmed = burgQuery.trim();
    if (!trimmed) {
      setBurgResults([]);
      setBurgSearching(false);
      return;
    }

    const controller = new AbortController();
    setBurgSearching(true);
    searchWorldBurgs(worldMap.id, trimmed, { signal: controller.signal })
      .then((results) => {
        setBurgResults(results);
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        const message = error instanceof Error ? error.message : "Failed to search burgs";
        toast.error(message);
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setBurgSearching(false);
        }
      });

    return () => {
      controller.abort();
      setBurgSearching(false);
    };
  }, [burgQuery, worldMap]);

  const handleMapErrorStable = useCallback((message: string) => {
    toast.error(message);
  }, []);

  const handleSelectPosition = useCallback((position: { x: number; y: number }) => {
    setPendingPosition(position);
    setNoteDraft(spawn?.note ?? "");
    setIsDialogOpen(true);
  }, [spawn]);

  const handleSelectBurgResult = useCallback((burg: BurgSearchResult) => {
    if (!burg.geometry || !Array.isArray((burg.geometry as { coordinates?: unknown }).coordinates)) {
      toast.error("Selected burg is missing coordinates.");
      return;
    }
    const coords = (burg.geometry as { coordinates: [number, number] }).coordinates;
    const coordinate: [number, number] = [Number(coords[0]), Number(coords[1])];
    setHighlightPoint({ coordinate, label: burg.name });
    setFeatureDetails({
      id: burg.id,
      type: "burg",
      name: burg.name,
      coordinate,
      properties: {
        population: burg.population ?? burg.populationraw ?? null,
        state: burg.state ?? null,
        culture: burg.culture ?? null,
        religion: burg.religion ?? null,
      },
    });
  }, []);

  const resetRegionDialog = useCallback(() => {
    setRegionDialogOpen(false);
    setPendingRegionGeometry(null);
    setRegionSeedContext(null);
    setRegionSaving(false);
    setRegionError(null);
    setRegionName("");
    setRegionCategory("custom");
    setRegionColor("#0ea5e9");
    setRegionDescription("");
    setHighlightPoint(null);
  }, []);

  const handleCreateRegion = useCallback(async () => {
    if (!campaign?.id || !pendingRegionGeometry) {
      resetRegionDialog();
      return;
    }

    const trimmedName = regionName.trim();
    if (!trimmedName) {
      setRegionError("Region name is required.");
      return;
    }

    setRegionSaving(true);
    try {
      await createCampaignRegion(campaign.id, {
        name: trimmedName,
        description: regionDescription.trim() ? regionDescription.trim() : null,
        category: regionCategory,
        color: regionColor ? regionColor.trim() : null,
        worldMapId: worldMap?.id ?? null,
        metadata: regionSeedContext ? { seedType: regionSeedContext.featureType } : {},
        geometry: pendingRegionGeometry,
      });
      toast.success("Region saved.");
      resetRegionDialog();
      setHighlightPoint(null);
      await refreshRegions();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to create region";
      setRegionError(message);
    } finally {
      setRegionSaving(false);
    }
  }, [campaign?.id, pendingRegionGeometry, regionCategory, regionColor, regionDescription, regionName, regionSeedContext, refreshRegions, resetRegionDialog, worldMap?.id]);

  const handleCancelObjectiveLink = useCallback(() => {
    setObjectiveDialogOpen(false);
    setObjectiveLinkContext(null);
    setObjectiveSelection(null);
    setObjectiveError(null);
    setHighlightPoint(null);
  }, []);

  const handleConfirmObjectiveLink = useCallback(async () => {
    if (!objectiveSelection) {
      setObjectiveError("Select an objective to link.");
      return;
    }

    if (!objectiveLinkContext) {
      setObjectiveError("No map context is available.");
      return;
    }

    const { context } = objectiveLinkContext;
    const coordinate = context.coordinate;
    const featureData = context.feature?.get("data") as Record<string, unknown> | undefined;
    let payload: ObjectiveLocationPayload;

    if (objectiveLocationKind === "pin") {
      payload = { locationType: "pin", pin: { x: coordinate[0], y: coordinate[1] } };
    } else if (objectiveLocationKind === "burg") {
      const burgId = typeof featureData?.id === "string" ? featureData.id : undefined;
      if (!burgId) {
        setObjectiveError("The selected location is missing a burg identifier.");
        return;
      }
      payload = { locationType: "burg", locationBurgId: burgId };
    } else if (objectiveLocationKind === "marker") {
      const markerId = typeof featureData?.id === "string" ? featureData.id : undefined;
      if (!markerId) {
        setObjectiveError("The selected location is missing a marker identifier.");
        return;
      }
      payload = { locationType: "marker", locationMarkerId: markerId };
    } else {
      const regionId = typeof featureData?.id === "string" ? featureData.id : undefined;
      if (!regionId) {
        setObjectiveError("The selected region is missing an identifier.");
        return;
      }
      payload = { locationType: "region", locationRegionId: regionId };
    }

    setObjectiveSaving(true);
    try {
      await updateObjectiveLocation(objectiveSelection, payload);
      toast.success("Objective location updated.");
      setObjectiveSaving(false);
      setObjectivesRefreshKey((key) => key + 1);
      handleCancelObjectiveLink();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to update objective location";
      setObjectiveError(message);
      setObjectiveSaving(false);
    }
  }, [handleCancelObjectiveLink, objectiveLinkContext, objectiveLocationKind, objectiveSelection]);

  const availableLocationKinds = useMemo(() => {
    const kinds = new Set<MapLocationKind>(["pin"]);
    const data = objectiveLinkContext?.context.feature?.get("data") as Record<string, unknown> | undefined;
    const featureType = objectiveLinkContext?.context.featureType?.toLowerCase();
    if (featureType === "burg" && typeof data?.id === "string") {
      kinds.add("burg");
    }
    if (featureType === "marker" && typeof data?.id === "string") {
      kinds.add("marker");
    }
    if (featureType === "region" && typeof data?.id === "string") {
      kinds.add("region");
    }
    return kinds;
  }, [objectiveLinkContext]);

  useEffect(() => {
    if (!availableLocationKinds.has(objectiveLocationKind)) {
      setObjectiveLocationKind("pin");
    }
  }, [availableLocationKinds, objectiveLocationKind]);

  const handleObjectiveLinkRequest = useCallback((context: MapContextDetails) => {
    const defaultKind = deriveLocationKind(context);
    const label = extractFeatureLabel(context);
    setObjectiveLocationKind(defaultKind);
    setObjectiveSelection(null);
    setObjectiveError(null);
    setObjectiveLinkContext({ context, defaultKind, label });
    setObjectiveDialogOpen(true);
    setHighlightPoint({ coordinate: [context.coordinate[0], context.coordinate[1]], label });
    void loadObjectiveOptions();
  }, [deriveLocationKind, extractFeatureLabel, loadObjectiveOptions]);

  const handleRegionDrawComplete = useCallback(({ geometry, context }: { geometry: Record<string, unknown>; context: MapContextDetails | null }) => {
    setPendingRegionGeometry(geometry);
    setRegionSeedContext(context ?? null);
    const fallbackName = context ? extractFeatureLabel(context) : `Region ${regions.length + 1}`;
    setRegionName(fallbackName);
    setRegionCategory("custom");
    setRegionColor("#0ea5e9");
    setRegionDescription("");
    setRegionError(null);
    setRegionDialogOpen(true);
    if (context) {
      setHighlightPoint({ coordinate: [context.coordinate[0], context.coordinate[1]], label: fallbackName });
    }
  }, [extractFeatureLabel, regions.length]);

  const handleSubmit = useCallback(async () => {
    if (!campaign || !pendingPosition) {
      setIsDialogOpen(false);
      setEditing(false);
      return;
    }

    setSaving(true);
    try {
      const saver = upsertSpawnOverride ?? upsertCampaignSpawn;
      const updatedSpawn = await saver(campaign.id, {
        position: pendingPosition,
        note: noteDraft.trim() ? noteDraft.trim() : null,
      });
      setSpawn(updatedSpawn);
      toast.success("Spawn location saved.");
      setIsDialogOpen(false);
      setEditing(false);
      setPendingPosition(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to save spawn location");
    } finally {
      setSaving(false);
    }
  }, [campaign, noteDraft, pendingPosition]);

  const handleEditNote = useCallback(() => {
    if (!spawn || !spawn.geometry || !Array.isArray(spawn.geometry.coordinates)) {
      toast.error("Set the spawn location before editing the note.");
      return;
    }

    const [x, y] = spawn.geometry.coordinates;
    setPendingPosition({ x: Number(x), y: Number(y) });
    setNoteDraft(spawn.note ?? "");
    setIsDialogOpen(true);
  }, [spawn]);

  const spawnCoordinates = useMemo(() => {
    const coords = spawn?.geometry?.coordinates;
    if (!Array.isArray(coords) || coords.length < 2) return null;
    return {
      x: Number(coords[0]).toFixed(2),
      y: Number(coords[1]).toFixed(2),
    };
  }, [spawn]);

  const renderMap = () => {
    if (!campaign) {
      return (
        <Alert variant="default">
          <AlertTitle>Select a campaign</AlertTitle>
          <AlertDescription>Choose a campaign to prep before setting a spawn.</AlertDescription>
        </Alert>
      );
    }

    if (!campaign.world_map_id) {
      return (
        <Alert variant="destructive">
          <AlertTitle>World map required</AlertTitle>
          <AlertDescription>
            Link a world map to this campaign from the settings dialog before configuring the default spawn.
          </AlertDescription>
        </Alert>
      );
    }

    if (worldMapLoading) {
      return <Skeleton className="h-96 w-full" />;
    }

    if (worldMapError || !worldMap) {
      return (
        <Alert variant="destructive">
          <AlertTitle>Unable to load map</AlertTitle>
          <AlertDescription>{worldMapError ?? "The world map metadata could not be loaded."}</AlertDescription>
        </Alert>
      );
    }

    const MapComponent = mapComponent ?? CampaignPrepMap;

    return (
      <MapComponent
        worldMap={worldMap}
        spawn={spawn}
        editingSpawn={editing}
        canEditSpawn={isCampaignDm}
        onSelectSpawn={handleSelectPosition}
        onRequestLinkObjective={handleObjectiveLinkRequest}
        onRegionDrawComplete={handleRegionDrawComplete}
        onFeatureSelected={setFeatureDetails}
        highlightPoint={highlightPoint}
        regions={regions}
        className="h-[70vh]"
        onError={handleMapErrorStable}
      />
    );
  };

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,4fr)_minmax(0,2.3fr)] xl:items-start">
      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>Campaign Prep Map</CardTitle>
            <CardDescription>
              Place the default spawn pin for the party and capture any scene-setting notes that should load before a session.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2">
                <Input
                  value={burgQuery}
                  onChange={(event) => setBurgQuery(event.target.value)}
                  placeholder="Search burgs…"
                  className="h-8 w-56"
                />
                {burgSearching && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
              </div>
              {burgResults.length > 0 && (
                <div className="flex flex-wrap items-center gap-2">
                  {burgResults.slice(0, 6).map((burg) => (
                    <Button
                      key={burg.id}
                      size="sm"
                      variant="outline"
                      onClick={() => handleSelectBurgResult(burg)}
                    >
                      {burg.name}
                      {typeof burg.population === "number" ? (
                        <span className="ml-1 text-[10px] text-muted-foreground">
                          {burg.population.toLocaleString()}
                        </span>
                      ) : null}
                    </Button>
                  ))}
                </div>
              )}
            </div>
            {renderMap()}

            {featureDetails ? (
              <div className="rounded-md border bg-muted/30 px-3 py-3 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <div className="font-semibold text-foreground">{featureDetails.name}</div>
                  {featureDetails.type ? <Badge variant="outline">{featureDetails.type}</Badge> : null}
                </div>
                {featureDetails.coordinate ? (
                  <div className="mt-1 text-xs text-muted-foreground">
                    x: {featureDetails.coordinate[0].toFixed(1)} · y: {featureDetails.coordinate[1].toFixed(1)}
                  </div>
                ) : null}
                <dl className="mt-3 space-y-1 text-xs">
                  {Object.entries(featureDetails.properties)
                    .filter(([, value]) => value !== null && value !== undefined && value !== "")
                    .slice(0, 6)
                    .map(([key, value]) => (
                      <div key={key} className="flex items-center justify-between gap-2">
                        <dt className="font-medium capitalize text-foreground">{key}</dt>
                        <dd className="text-right text-muted-foreground">
                          {typeof value === "number" ? value.toLocaleString() : String(value)}
                        </dd>
                      </div>
                    ))}
                </dl>
              </div>
            ) : null}

            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="default"
                size="sm"
                disabled={!isCampaignDm || !worldMap || worldMapLoading}
                onClick={() => setEditing(true)}
              >
                Set Spawn Location
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleEditNote}
                disabled={!isCampaignDm || !spawn || spawnLoading}
              >
                Edit Spawn Note
              </Button>
              {spawnLoading && <span className="text-xs text-muted-foreground">Refreshing spawn…</span>}
              {spawnError && <span className="text-xs text-destructive">{spawnError}</span>}
            </div>

            <div className="rounded-md border bg-muted/40 p-4">
              <h3 className="text-sm font-semibold">Current Spawn</h3>
              {spawn ? (
                <div className="mt-2 space-y-2 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="font-medium">Name</span>
                    <span>{spawn.name || "Default Spawn"}</span>
                  </div>
                  {spawnCoordinates && (
                    <div className="flex items-center justify-between">
                      <span className="font-medium">Coordinates</span>
                      <span>
                        x: {spawnCoordinates.x}, y: {spawnCoordinates.y}
                      </span>
                    </div>
                  )}
                  <div>
                    <span className="font-medium">Note</span>
                    <p className="mt-1 text-muted-foreground">
                      {spawn.note ? spawn.note : "No note provided."}
                    </p>
                  </div>
                </div>
              ) : (
                <p className="mt-2 text-sm text-muted-foreground">This campaign does not yet have a default spawn.</p>
              )}
            </div>

            <Dialog open={isDialogOpen} onOpenChange={(open) => {
              setIsDialogOpen(open);
              if (!open) {
                setEditing(false);
                setPendingPosition(null);
              }
            }}>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Save Default Spawn</DialogTitle>
                  <DialogDescription>
                    Confirm the spawn location note. Coordinates are stored automatically based on your map selection.
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4">
                  {pendingPosition && (
                    <div className="rounded-md bg-muted/50 p-3 text-sm">
                      <div className="flex items-center justify-between">
                        <span className="font-medium">Coordinates</span>
                        <span>
                          x: {pendingPosition.x.toFixed(2)}, y: {pendingPosition.y.toFixed(2)}
                        </span>
                      </div>
                    </div>
                  )}
                  <div className="space-y-2">
                    <Label htmlFor="spawn-note">Scene Note</Label>
                    <Textarea
                      id="spawn-note"
                      value={noteDraft}
                      onChange={(event) => setNoteDraft(event.target.value)}
                      placeholder="Describe the opening scene or context the party should see when they load in."
                      rows={4}
                    />
                  </div>
                </div>
                <DialogFooter className="gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setIsDialogOpen(false);
                      setEditing(false);
                      setPendingPosition(null);
                    }}
                  >
                    Cancel
                  </Button>
                  <Button type="button" onClick={handleSubmit} disabled={saving}>
                    {saving ? "Saving…" : "Save Spawn"}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>

            <Dialog open={regionDialogOpen} onOpenChange={(open) => {
              if (open) {
                setRegionDialogOpen(true);
              } else {
                resetRegionDialog();
              }
            }}>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Create campaign region</DialogTitle>
                  <DialogDescription>
                    Name and categorize the selected area. Regions are persisted to the live database immediately.
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4">
                  {regionSeedContext ? (
                    <div className="rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                      <div className="flex items-center justify-between">
                        <span className="font-medium text-foreground">Seed coordinates</span>
                        <span>
                          x: {regionSeedContext.coordinate[0].toFixed(1)} · y: {regionSeedContext.coordinate[1].toFixed(1)}
                        </span>
                      </div>
                    </div>
                  ) : null}
                  <div className="space-y-2">
                    <Label htmlFor="region-name">Name</Label>
                    <Input
                      id="region-name"
                      value={regionName}
                      onChange={(event) => setRegionName(event.target.value)}
                      placeholder="Bandit ambush territory"
                      autoFocus
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="region-category">Category</Label>
                    <Select value={regionCategory} onValueChange={(value) => setRegionCategory(value as CampaignRegionCategory)}>
                      <SelectTrigger id="region-category">
                        <SelectValue placeholder="Select category" />
                      </SelectTrigger>
                      <SelectContent>
                        {REGION_CATEGORY_OPTIONS.map((option) => (
                          <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="region-color">Color</Label>
                    <div className="flex items-center gap-2">
                      <Input
                        id="region-color"
                        type="color"
                        className="h-8 w-16 p-1"
                        value={regionColor}
                        onChange={(event) => setRegionColor(event.target.value)}
                      />
                      <Input
                        value={regionColor}
                        onChange={(event) => setRegionColor(event.target.value)}
                        className="h-8"
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="region-description">Description (optional)</Label>
                    <Textarea
                      id="region-description"
                      value={regionDescription}
                      onChange={(event) => setRegionDescription(event.target.value)}
                      rows={3}
                      placeholder="Notable encounters, terrain notes, or rumours about this region"
                    />
                  </div>
                  {regionError ? <p className="text-xs text-destructive">{regionError}</p> : null}
                </div>
                <DialogFooter className="gap-2">
                  <Button type="button" variant="outline" onClick={resetRegionDialog} disabled={regionSaving}>
                    Cancel
                  </Button>
                  <Button type="button" onClick={handleCreateRegion} disabled={regionSaving}>
                    {regionSaving ? "Saving…" : "Save region"}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>

            <Dialog open={objectiveDialogOpen} onOpenChange={(open) => {
              if (open) {
                setObjectiveDialogOpen(true);
              } else {
                handleCancelObjectiveLink();
              }
            }}>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Link objective to map</DialogTitle>
                  <DialogDescription>
                    Choose which objective should inherit this map location.
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4">
                  {objectiveLinkContext ? (
                    <div className="rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                      <div className="font-medium text-foreground">{objectiveLinkContext.label}</div>
                      <div>
                        x: {objectiveLinkContext.context.coordinate[0].toFixed(1)} · y: {objectiveLinkContext.context.coordinate[1].toFixed(1)}
                      </div>
                    </div>
                  ) : null}
                  <div className="space-y-2">
                    <Label htmlFor="objective-select">Objective</Label>
                    <Select
                      value={objectiveSelection ?? "__none__"}
                      onValueChange={(value) => setObjectiveSelection(value === "__none__" ? null : value)}
                    >
                      <SelectTrigger id="objective-select">
                        <SelectValue placeholder={objectiveLoading ? "Loading objectives…" : "Select objective"} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__" disabled>
                          Select objective
                        </SelectItem>
                        {objectiveOptions.map((objective) => (
                          <SelectItem key={objective.id} value={objective.id}>
                            {objective.title}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {objectiveLoading ? <p className="text-xs text-muted-foreground">Loading objectives…</p> : null}
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="objective-location-kind">Link as</Label>
                    <Select
                      value={objectiveLocationKind}
                      onValueChange={(value) => setObjectiveLocationKind(value as MapLocationKind)}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="pin">Pin (SRID 0 coordinate)</SelectItem>
                        <SelectItem value="burg" disabled={!availableLocationKinds.has("burg")}>Burg</SelectItem>
                        <SelectItem value="marker" disabled={!availableLocationKinds.has("marker")}>Marker</SelectItem>
                        <SelectItem value="region" disabled={!availableLocationKinds.has("region")}>Region</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  {objectiveError ? <p className="text-xs text-destructive">{objectiveError}</p> : null}
                </div>
                <DialogFooter className="gap-2">
                  <Button type="button" variant="outline" onClick={handleCancelObjectiveLink} disabled={objectiveSaving}>
                    Cancel
                  </Button>
                  <Button type="button" onClick={handleConfirmObjectiveLink} disabled={objectiveSaving || objectiveLoading || !objectiveSelection}>
                    {objectiveSaving ? "Linking…" : "Link objective"}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </CardContent>
        </Card>

        {campaignId ? (
          canManageSessions ? (
            <SessionManager key={campaignId} campaignId={campaignId} isDM={canManageSessions} />
          ) : (
            <Card>
              <CardHeader>
                <CardTitle>Session Management Restricted</CardTitle>
                <CardDescription>
                  Only the campaign’s DM or co-DM can schedule or close sessions from the prep view.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">
                  Ask the campaign owner to grant you co-DM access if you need to manage the session lifecycle.
                </p>
              </CardContent>
            </Card>
          )
        ) : null}
      </div>

      <div className="flex h-full flex-col overflow-y-auto">
        <ObjectivesPanel
          campaign={campaign}
          canEdit={isCampaignDm}
          worldMap={worldMap}
          worldMapLoading={worldMapLoading}
          worldMapError={worldMapError}
          regions={regions}
          refreshKey={objectivesRefreshKey}
        />
      </div>
    </div>
  );
}
