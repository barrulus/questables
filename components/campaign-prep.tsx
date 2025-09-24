import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "./ui/alert";
import { Button } from "./ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "./ui/dialog";
import { Label } from "./ui/label";
import { Textarea } from "./ui/textarea";
import { Skeleton } from "./ui/skeleton";
import { CampaignSpawnMap, type CampaignSpawnMapProps } from "./campaign-spawn-map";
import { ObjectivesPanel } from "./objectives-panel";
import SessionManager from "./session-manager";
import type { Campaign } from "./campaign-shared";
import {
  listCampaignSpawns,
  upsertCampaignSpawn,
  type SpawnPoint,
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
  spawnMapComponent?: (_props: CampaignSpawnMapProps) => JSX.Element;
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
}

const parseBounds = (value: unknown): WorldMapRecord["bounds"] | null => {
  if (!value) return null;
  if (typeof value === "object" && value !== null) {
    const candidate = value as Record<string, unknown>;
    const north = Number(candidate.north);
    const south = Number(candidate.south);
    const east = Number(candidate.east);
    const west = Number(candidate.west);
    if ([north, south, east, west].every((coordinate) => Number.isFinite(coordinate))) {
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
  spawnMapComponent,
}: CampaignPrepProps) {
  const user = viewerOverride === undefined
    ? useUser().user
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

      setWorldMap({
        id: String(payload.id ?? campaign.world_map_id),
        name: typeof payload.name === "string" && payload.name.trim() ? String(payload.name) : "World Map",
        bounds,
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

  const handleSelectPosition = useCallback((position: { x: number; y: number }) => {
    setPendingPosition(position);
    setNoteDraft(spawn?.note ?? "");
    setIsDialogOpen(true);
  }, [spawn]);

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
        <Alert variant="warning">
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

    const SpawnMapComponent = spawnMapComponent ?? CampaignSpawnMap;

    return (
      <SpawnMapComponent
        worldMap={worldMap}
        spawn={spawn}
        editing={editing}
        canEdit={isCampaignDm}
        onSelectPosition={handleSelectPosition}
        onError={(message) => {
          toast.error(message);
        }}
      />
    );
  };

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>Campaign Prep Map</CardTitle>
            <CardDescription>
              Place the default spawn pin for the party and capture any scene-setting notes that should load before a session.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {renderMap()}

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

      <ObjectivesPanel
        campaign={campaign}
        canEdit={isCampaignDm}
        worldMap={worldMap}
        worldMapLoading={worldMapLoading}
        worldMapError={worldMapError}
      />
    </div>
  );
}
