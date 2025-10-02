import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  createObjective,
  deleteObjective,
  listCampaignObjectives,
  listCampaignSpawns,
  updateObjective,
  apiFetch,
  readErrorMessage,
  readJsonBody,
  requestObjectiveAssist,
  HttpError,
  type ObjectiveRecord,
  type ObjectiveCreatePayload,
  type ObjectiveUpdatePayload,
  type ObjectiveAssistField,
  type SpawnPoint,
} from "../utils/api-client";
import { Campaign } from "./campaign-shared";
import { useWebSocket } from "../hooks/useWebSocket";
import { useGameSession } from "../contexts/GameSessionContext";
import { ObjectivePinMap } from "./objective-pin-map";
import { Button } from "./ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
import { Badge } from "./ui/badge";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";
import { Switch } from "./ui/switch";
import { Label } from "./ui/label";
import { ScrollArea } from "./ui/scroll-area";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { Separator } from "./ui/separator";
import { LoadingSpinner } from "./ui/loading-spinner";
import { Alert, AlertDescription, AlertTitle } from "./ui/alert";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "./ui/command";
import { cn } from "./ui/utils";
import {
  Plus,
  ChevronDown,
  ChevronRight,
  Pencil,
  Trash2,
  GripVertical,
  RefreshCcw,
  MapPin,
  Landmark,
  Map as MapIcon,
  GitBranchPlus,
  Sparkles,
  Loader2,
} from "lucide-react";

const toNullable = (value: string): string | null => {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

type ObjectiveLocationKind = "none" | "pin" | "burg" | "marker";

interface ObjectiveFormValues {
  title: string;
  parentId: string | null;
  isMajor: boolean;
  slug: string | null;
  descriptionMd: string;
  treasureMd: string;
  combatMd: string;
  npcsMd: string;
  rumoursMd: string;
  locationType: ObjectiveLocationKind;
  pin: { x: number; y: number } | null;
  locationBurgId: string | null;
  locationMarkerId: string | null;
}

interface ObjectiveTreeNode {
  record: ObjectiveRecord;
  children: ObjectiveTreeNode[];
}

interface BurgOption {
  id: string;
  name: string;
  population?: number | null;
}

interface MarkerOption {
  id: string;
  label: string;
  icon?: string | null;
}

const ROOT_PARENT_VALUE = "__root__";
const CLEAR_LINK_VALUE = "__clear__";
const DEFAULT_LOCATION_RADIUS = 150000;
const MAP_RADIUS_FRACTION = 0.05;
const WARNING_ALERT_CLASS = "border-amber-500/40 bg-amber-500/10 text-amber-900";

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const isObjectiveRecord = (value: unknown): value is ObjectiveRecord => {
  if (!isPlainObject(value)) {
    return false;
  }

  return (
    typeof value.id === "string" && value.id.trim().length > 0
    && typeof value.campaignId === "string" && value.campaignId.trim().length > 0
    && typeof value.title === "string"
  );
};

const toStringArray = (value: unknown): string[] | null => {
  if (!Array.isArray(value)) {
    return null;
  }

  const items = value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0);
  return items.length ? items : [];
};

interface BoundsEnvelope {
  west: number;
  south: number;
  east: number;
  north: number;
}

type AssistUiState = {
  pending: boolean;
  message: string | null;
  error: string | null;
};

const createAssistUiState = (): Record<ObjectiveAssistField, AssistUiState> => ({
  description: { pending: false, message: null, error: null },
  treasure: { pending: false, message: null, error: null },
  combat: { pending: false, message: null, error: null },
  npcs: { pending: false, message: null, error: null },
  rumours: { pending: false, message: null, error: null },
});

const assistFieldLabels: Record<ObjectiveAssistField, string> = {
  description: "Description",
  treasure: "Treasure",
  combat: "Combat Notes",
  npcs: "NPCs",
  rumours: "Rumours",
};

const assistFieldRecordKeys: Record<ObjectiveAssistField, keyof ObjectiveRecord> = {
  description: "descriptionMd",
  treasure: "treasureMd",
  combat: "combatMd",
  npcs: "npcsMd",
  rumours: "rumoursMd",
};

const assistFieldFormKeys: Record<ObjectiveAssistField, keyof ObjectiveFormValues> = {
  description: "descriptionMd",
  treasure: "treasureMd",
  combat: "combatMd",
  npcs: "npcsMd",
  rumours: "rumoursMd",
};

interface ObjectivesPanelProps {
  campaign: Campaign | null;
  canEdit: boolean;
  worldMap: {
    id: string;
    name: string;
    bounds: {
      north: number;
      south: number;
      east: number;
      west: number;
    };
  } | null;
  worldMapLoading?: boolean;
  worldMapError?: string | null;
}

const buildObjectiveTree = (records: ObjectiveRecord[]): ObjectiveTreeNode[] => {
  const nodes = new Map<string, ObjectiveTreeNode>();

  records.forEach((record) => {
    nodes.set(record.id, {
      record,
      children: [],
    });
  });

  const roots: ObjectiveTreeNode[] = [];

  nodes.forEach((node) => {
    // Reset children in case this is a rebuild
    node.children = [];
  });

  records.forEach((record) => {
    const node = nodes.get(record.id);
    if (!node) return;

    if (record.parentId && nodes.has(record.parentId)) {
      nodes.get(record.parentId)?.children.push(node);
    } else {
      roots.push(node);
    }
  });

  const sortNodes = (list: ObjectiveTreeNode[]) => {
    list.sort((a, b) => {
      const aIndex = Number.isFinite(a.record.orderIndex) ? a.record.orderIndex : 0;
      const bIndex = Number.isFinite(b.record.orderIndex) ? b.record.orderIndex : 0;
      return aIndex - bIndex;
    });
    list.forEach((node) => sortNodes(node.children));
  };

  sortNodes(roots);
  return roots;
};

const objectiveToFormValues = (objective: ObjectiveRecord): ObjectiveFormValues => {
  let locationType: ObjectiveLocationKind = "none";
  let pin: { x: number; y: number } | null = null;
  let locationBurgId: string | null = null;
  let locationMarkerId: string | null = null;

  if (objective.location?.type === "pin" && Array.isArray(objective.location.pin?.coordinates)) {
    const [x, y] = objective.location.pin.coordinates;
    if (Number.isFinite(Number(x)) && Number.isFinite(Number(y))) {
      locationType = "pin";
      pin = { x: Number(x), y: Number(y) };
    }
  } else if (objective.location?.type === "burg" && objective.location.burgId) {
    locationType = "burg";
    locationBurgId = objective.location.burgId;
  } else if (objective.location?.type === "marker" && objective.location.markerId) {
    locationType = "marker";
    locationMarkerId = objective.location.markerId;
  }

  return {
    title: objective.title ?? "",
    parentId: objective.parentId ?? null,
    isMajor: Boolean(objective.isMajor),
    slug: objective.slug ?? null,
    descriptionMd: objective.descriptionMd ?? "",
    treasureMd: objective.treasureMd ?? "",
    combatMd: objective.combatMd ?? "",
    npcsMd: objective.npcsMd ?? "",
    rumoursMd: objective.rumoursMd ?? "",
    locationType,
    pin,
    locationBurgId,
    locationMarkerId,
  };
};

const formValuesToPayload = (
  values: ObjectiveFormValues,
): {
  location: ObjectiveCreatePayload["location"];
  base: Omit<ObjectiveCreatePayload, "title" | "location"> & Partial<Omit<ObjectiveUpdatePayload, "title" | "location">>;
} => {
  let location = undefined as ObjectiveCreatePayload["location"];

  if (values.locationType === "pin" && values.pin) {
    location = { type: "pin", x: values.pin.x, y: values.pin.y };
  } else if (values.locationType === "burg" && values.locationBurgId) {
    location = { type: "burg", burgId: values.locationBurgId };
  } else if (values.locationType === "marker" && values.locationMarkerId) {
    location = { type: "marker", markerId: values.locationMarkerId };
  }

  const base: Omit<ObjectiveCreatePayload, "title" | "location"> & Partial<Omit<ObjectiveUpdatePayload, "title" | "location">> = {
    parentId: values.parentId,
    isMajor: values.isMajor,
    slug: values.slug ?? null,
    descriptionMd: toNullable(values.descriptionMd ?? ""),
    treasureMd: toNullable(values.treasureMd ?? ""),
    combatMd: toNullable(values.combatMd ?? ""),
    npcsMd: toNullable(values.npcsMd ?? ""),
    rumoursMd: toNullable(values.rumoursMd ?? ""),
  };

  return { location, base };
};

const buildLocationSummary = (
  objective: ObjectiveRecord,
  burgs: Map<string, BurgOption>,
  markers: Map<string, MarkerOption>,
): string => {
  if (!objective.location) {
    return "No location set";
  }

  if (objective.location.type === "pin" && Array.isArray(objective.location.pin?.coordinates)) {
    const [x, y] = objective.location.pin.coordinates;
    return `Pin @ (${Number(x).toFixed(1)}, ${Number(y).toFixed(1)})`;
  }

  if (objective.location.type === "burg") {
    const reference = objective.location.burgId ? burgs.get(objective.location.burgId) : null;
    return reference ? `Burg · ${reference.name}` : "Linked burg";
  }

  if (objective.location.type === "marker") {
    const reference = objective.location.markerId ? markers.get(objective.location.markerId) : null;
    return reference ? `Marker · ${reference.label}` : "Linked marker";
  }

  return "Location configured";
};

interface ObjectiveDialogProps {
  mode: "create" | "edit";
  open: boolean;
  values: ObjectiveFormValues;
  onChange: (_next: ObjectiveFormValues) => void;
  onSubmit: () => void;
  onOpenChange: (_open: boolean) => void;
  saving: boolean;
  parentOptions: ObjectiveRecord[];
  disabled?: boolean;
  worldMap?: ObjectivesPanelProps["worldMap"];
  markerUnavailable: boolean;
  burgOptions: BurgOption[];
  markerOptions: MarkerOption[];
  assistEnabled: boolean;
  assistStates: Record<ObjectiveAssistField, AssistUiState>;
  onRequestAssist: (_field: ObjectiveAssistField) => void;
  assistDisabledReason?: string | null;
}

const ObjectiveDialog = ({
  mode,
  open,
  values,
  onChange,
  onSubmit,
  onOpenChange,
  saving,
  parentOptions,
  disabled,
  worldMap,
  markerUnavailable,
  burgOptions,
  markerOptions,
  assistEnabled,
  assistStates,
  onRequestAssist,
  assistDisabledReason,
}: ObjectiveDialogProps) => {
  const [pinPickerOpen, setPinPickerOpen] = useState(false);
  const [burgBrowserOpen, setBurgBrowserOpen] = useState(false);
  const [markerBrowserOpen, setMarkerBrowserOpen] = useState(false);

  useEffect(() => {
    if (!open) {
      setPinPickerOpen(false);
    }
  }, [open]);

  const renderAssistButton = (field: ObjectiveAssistField) => {
    const label = assistFieldLabels[field];
    const state = assistStates[field];
    const disabledAssist = disabled || saving || !assistEnabled || state.pending;

    return (
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={() => onRequestAssist(field)}
        disabled={disabledAssist}
        aria-label={`Assist ${label}`}
      >
        {state.pending ? (
          <>
            <Loader2 className="mr-2 h-3 w-3 animate-spin" />
            Generating…
          </>
        ) : (
          <>
            <Sparkles className="mr-2 h-3 w-3" />
            Assist
          </>
        )}
      </Button>
    );
  };

  const renderAssistStatus = (field: ObjectiveAssistField, options?: { showDisabledInfo?: boolean }) => {
    const state = assistStates[field];
    if (assistEnabled) {
      if (state.error) {
        return <p className="text-xs text-destructive">{state.error}</p>;
      }
      if (state.message) {
        return <p className="text-xs text-muted-foreground">{state.message}</p>;
      }
      return null;
    }

    if (options?.showDisabledInfo && assistDisabledReason) {
      return <p className="text-xs italic text-muted-foreground">{assistDisabledReason}</p>;
    }

    return null;
  };

  return (
    <>
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>{mode === "create" ? "Create Objective" : "Edit Objective"}</DialogTitle>
          <DialogDescription>
            Titles, content fields, and location data are persisted immediately through the live Objective API.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-6 md:grid-cols-[1fr_280px]">
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="objective-title">Title *</Label>
              <Input
                id="objective-title"
                disabled={disabled}
                value={values.title}
                onChange={(event) => onChange({ ...values, title: event.target.value })}
                placeholder="Describe the objective"
              />
            </div>
            <div className="flex items-center justify-between rounded-md border p-3">
              <div className="space-y-1">
                <Label htmlFor="objective-major">Major objective</Label>
                <p className="text-sm text-muted-foreground">
                  Major objectives surface prominently in the prep view and DM sidebar.
                </p>
              </div>
              <Switch
                id="objective-major"
                disabled={disabled}
                checked={values.isMajor}
                onCheckedChange={(checked) => onChange({ ...values, isMajor: checked })}
              />
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="objective-slug">Slug</Label>
                <Input
                  id="objective-slug"
                  disabled={disabled}
                  value={values.slug ?? ""}
                  onChange={(event) => onChange({ ...values, slug: event.target.value || null })}
                  placeholder="Optional short identifier"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="objective-parent">Parent objective</Label>
                <Select
                  value={values.parentId ?? ROOT_PARENT_VALUE}
                  onValueChange={(value) => onChange({ ...values, parentId: value === ROOT_PARENT_VALUE ? null : value })}
                  disabled={disabled}
                >
                  <SelectTrigger id="objective-parent">
                    <SelectValue placeholder="Top-level objective" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ROOT_PARENT_VALUE}>Top-level objective</SelectItem>
                    {parentOptions.map((objective) => (
                      <SelectItem key={objective.id} value={objective.id}>
                        {objective.title}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <Separator />
            <div className="grid gap-4">
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <Label htmlFor="objective-description">Description</Label>
                  {renderAssistButton("description")}
                </div>
                <Textarea
                  id="objective-description"
                  disabled={disabled}
                  value={values.descriptionMd}
                  rows={4}
                  onChange={(event) => onChange({ ...values, descriptionMd: event.target.value })}
                  placeholder="Main objective details in Markdown"
                />
                {renderAssistStatus("description", { showDisabledInfo: true })}
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <Label htmlFor="objective-treasure">Treasure</Label>
                  {renderAssistButton("treasure")}
                </div>
                <Textarea
                  id="objective-treasure"
                  disabled={disabled}
                  value={values.treasureMd}
                  rows={3}
                  onChange={(event) => onChange({ ...values, treasureMd: event.target.value })}
                  placeholder="Loot drops, rewards, or boons"
                />
                {renderAssistStatus("treasure")}
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <Label htmlFor="objective-combat">Combat Notes</Label>
                  {renderAssistButton("combat")}
                </div>
                <Textarea
                  id="objective-combat"
                  disabled={disabled}
                  value={values.combatMd}
                  rows={3}
                  onChange={(event) => onChange({ ...values, combatMd: event.target.value })}
                  placeholder="Encounters, stat block links, or strategy"
                />
                {renderAssistStatus("combat")}
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <Label htmlFor="objective-npcs">NPCs</Label>
                  {renderAssistButton("npcs")}
                </div>
                <Textarea
                  id="objective-npcs"
                  disabled={disabled}
                  value={values.npcsMd}
                  rows={3}
                  onChange={(event) => onChange({ ...values, npcsMd: event.target.value })}
                  placeholder="Key NPCs, alliances, and hooks"
                />
                {renderAssistStatus("npcs")}
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <Label htmlFor="objective-rumours">Rumours</Label>
                  {renderAssistButton("rumours")}
                </div>
                <Textarea
                  id="objective-rumours"
                  disabled={disabled}
                  value={values.rumoursMd}
                  rows={3}
                  onChange={(event) => onChange({ ...values, rumoursMd: event.target.value })}
                  placeholder="Foreshadowing, myths, or misinformation"
                />
                {renderAssistStatus("rumours")}
              </div>
            </div>
          </div>
          <div className="space-y-4">
            <div className="rounded-md border p-3">
              <h4 className="text-sm font-semibold">Location</h4>
              <p className="mt-1 text-xs text-muted-foreground">
                Tie objectives to world coordinates, burgs, or markers pulled from the live map dataset.
              </p>
              <div className="mt-3 space-y-3">
                <Select
                  value={values.locationType}
                  disabled={disabled || (!worldMap && values.locationType === "pin")}
                  onValueChange={(value) => {
                    const next = value as ObjectiveLocationKind;
                    onChange({
                      ...values,
                      locationType: next,
                      pin: next === "pin" ? values.pin : null,
                      locationBurgId: next === "burg" ? values.locationBurgId : null,
                      locationMarkerId: next === "marker" ? values.locationMarkerId : null,
                    });
                  }}
                >
                  <SelectTrigger aria-label="Objective location type">
                    <SelectValue placeholder="Select location type" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No linked location</SelectItem>
                    <SelectItem value="pin" disabled={!worldMap}>
                      Map pin (world coordinates)
                    </SelectItem>
                    <SelectItem value="burg">Existing burg</SelectItem>
                    <SelectItem value="marker">Map marker</SelectItem>
                  </SelectContent>
                </Select>
                {markerUnavailable && (
                  <Alert variant="default" className={WARNING_ALERT_CLASS}>
                    <AlertTitle>Markers endpoint unavailable</AlertTitle>
                    <AlertDescription>
                      The backend does not yet expose `/api/maps/:worldId/markers`. Notify the backend team before enabling marker links.
                    </AlertDescription>
                  </Alert>
                )}
                {values.locationType === "pin" && (
                  <div className="space-y-2">
                    {!worldMap && (
                      <Alert variant="default" className={WARNING_ALERT_CLASS}>
                        <AlertTitle>World map required</AlertTitle>
                        <AlertDescription>
                          Link a world map to the campaign before setting pin-based objective locations.
                        </AlertDescription>
                      </Alert>
                    )}
                    {worldMap && (
                      <>
                        <div className="flex items-center justify-between gap-2 text-sm">
                          <div>
                            <span className="font-medium">Selected coordinates</span>
                            <div className="text-xs text-muted-foreground">
                              {values.pin
                                ? `x: ${values.pin.x.toFixed(2)} · y: ${values.pin.y.toFixed(2)}`
                                : "No point selected"}
                            </div>
                          </div>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => setPinPickerOpen(true)}
                            disabled={disabled}
                          >
                          <MapIcon className="mr-2 h-4 w-4" />
                            Select on map
                          </Button>
                        </div>
                        <Dialog open={pinPickerOpen} onOpenChange={setPinPickerOpen}>
                          <DialogContent className="max-w-4xl">
                            <DialogHeader>
                              <DialogTitle>Select objective coordinates</DialogTitle>
                              <DialogDescription>
                                Click the world map to position the objective. Coordinates are stored in SRID 0 immediately when you save the objective.
                              </DialogDescription>
                            </DialogHeader>
                            <ObjectivePinMap
                              worldMap={worldMap}
                              value={values.pin}
                              onSelect={(coords) => onChange({ ...values, pin: coords })}
                            />
                            <DialogFooter>
                              <Button variant="outline" onClick={() => setPinPickerOpen(false)}>
                                Done
                              </Button>
                            </DialogFooter>
                          </DialogContent>
                        </Dialog>
                      </>
                    )}
                  </div>
                )}
                {values.locationType === "burg" && (
                  <div className="space-y-2">
                    <Label htmlFor="objective-burg" className="text-xs text-muted-foreground">
                      Burgs are fetched from the live `maps_burgs` dataset. Select one to anchor the objective.
                    </Label>
                    <Select
                      value={values.locationBurgId ?? CLEAR_LINK_VALUE}
                      onValueChange={(value) =>
                        onChange({ ...values, locationBurgId: value === CLEAR_LINK_VALUE ? null : value })
                      }
                      disabled={disabled}
                    >
                      <SelectTrigger id="objective-burg">
                        <SelectValue placeholder="Select burg" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={CLEAR_LINK_VALUE}>Clear burg link</SelectItem>
                        {burgOptions.map((burg) => (
                          <SelectItem key={burg.id} value={burg.id}>
                            {burg.name}
                            {burg.population ? ` · pop ${burg.population}` : ""}
                          </SelectItem>
                        ))}
                      </SelectContent>
                      </Select>
                    {burgOptions.length === 0 && (
                      <p className="text-xs text-muted-foreground">
                        No burgs found near the campaign spawn. Adjust the spawn or populate the map dataset.
                      </p>
                    )}
                      {burgOptions.length > 0 && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => setBurgBrowserOpen(true)}
                        >
                          Browse burgs
                        </Button>
                      )}
                  </div>
                )}
                {values.locationType === "marker" && !markerUnavailable && (
                  <div className="space-y-2">
                    <Label htmlFor="objective-marker" className="text-xs text-muted-foreground">
                      Markers are loaded live from PostGIS. Choose one to link this objective.
                    </Label>
                      <Select
                        value={values.locationMarkerId ?? CLEAR_LINK_VALUE}
                        onValueChange={(value) =>
                          onChange({ ...values, locationMarkerId: value === CLEAR_LINK_VALUE ? null : value })
                        }
                        disabled={disabled}
                      >
                        <SelectTrigger id="objective-marker">
                          <SelectValue placeholder="Select marker" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={CLEAR_LINK_VALUE}>Clear marker link</SelectItem>
                          {markerOptions.map((marker) => (
                            <SelectItem key={marker.id} value={marker.id}>
                              {marker.label}
                              {marker.icon ? ` · ${marker.icon}` : ""}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {markerOptions.length === 0 && (
                        <p className="text-xs text-muted-foreground">
                          No markers found near the campaign spawn.
                        </p>
                      )}
                      {markerOptions.length > 0 && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => setMarkerBrowserOpen(true)}
                        >
                          Browse markers
                        </Button>
                      )}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
        <DialogFooter className="mt-4">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button type="button" onClick={onSubmit} disabled={saving || values.title.trim().length === 0}>
            {saving ? "Saving…" : mode === "create" ? "Create objective" : "Save changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    <Dialog open={burgBrowserOpen} onOpenChange={setBurgBrowserOpen}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Select burg</DialogTitle>
          <DialogDescription>
            Search the burgs near the campaign spawn and link one to this objective.
          </DialogDescription>
        </DialogHeader>
        <Command>
          <CommandInput placeholder="Search burgs…" />
          <CommandEmpty>No burgs found.</CommandEmpty>
          <CommandList>
            <CommandGroup heading="Burgs">
              {burgOptions.map((burg) => (
                <CommandItem
                  key={burg.id}
                  value={`${burg.name} ${burg.id}`}
                  onSelect={() => {
                    onChange({ ...values, locationBurgId: burg.id });
                    setBurgBrowserOpen(false);
                  }}
                >
                  <div className="flex flex-col">
                    <span className="font-medium">{burg.name}</span>
                    {burg.population ? (
                      <span className="text-xs text-muted-foreground">
                        Population {burg.population.toLocaleString()}
                      </span>
                    ) : null}
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
    <Dialog open={markerBrowserOpen} onOpenChange={setMarkerBrowserOpen}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Select marker</DialogTitle>
          <DialogDescription>
            Search the available markers near the campaign spawn and link one.
          </DialogDescription>
        </DialogHeader>
        <Command>
          <CommandInput placeholder="Search markers…" />
          <CommandEmpty>No markers found.</CommandEmpty>
          <CommandList>
            <CommandGroup heading="Markers">
              {markerOptions.map((marker) => (
                <CommandItem
                  key={marker.id}
                  value={`${marker.label} ${marker.id}`}
                  onSelect={() => {
                    onChange({ ...values, locationMarkerId: marker.id });
                    setMarkerBrowserOpen(false);
                  }}
                >
                  <div className="flex flex-col">
                    <span className="font-medium">{marker.label}</span>
                    {marker.icon ? (
                      <span className="text-xs text-muted-foreground">Icon: {marker.icon}</span>
                    ) : null}
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
    </>
  );
};

const BulkCreateDialog = ({
  open,
  onOpenChange,
  onSubmit,
  saving,
  parentOptions,
  parentId,
  setParentId,
  isMajor,
  setIsMajor,
  draft,
  setDraft,
}: {
  open: boolean;
  onOpenChange: (_open: boolean) => void;
  onSubmit: () => void;
  saving: boolean;
  parentOptions: ObjectiveRecord[];
  parentId: string | null;
  setParentId: (_value: string | null) => void;
  isMajor: boolean;
  setIsMajor: (_value: boolean) => void;
  draft: string;
  setDraft: (_value: string) => void;
}) => (
  <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="sm:max-w-2xl">
      <DialogHeader>
        <DialogTitle>Bulk create objectives</DialogTitle>
        <DialogDescription>
          Paste or type one objective title per line. Each entry becomes a distinct objective saved through the live API.
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="bulk-parent">Parent objective</Label>
          <Select value={parentId ?? ROOT_PARENT_VALUE} onValueChange={(value) => setParentId(value === ROOT_PARENT_VALUE ? null : value)}>
            <SelectTrigger id="bulk-parent">
              <SelectValue placeholder="Top-level objective" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ROOT_PARENT_VALUE}>Top-level objective</SelectItem>
              {parentOptions.map((objective) => (
                <SelectItem key={objective.id} value={objective.id}>
                  {objective.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center justify-between rounded-md border p-3">
          <div>
            <p className="text-sm font-medium">Mark as major objectives</p>
            <p className="text-xs text-muted-foreground">
              Applies the major flag to every objective created in this batch.
            </p>
          </div>
          <Switch checked={isMajor} onCheckedChange={setIsMajor} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="bulk-objectives">Objective titles</Label>
          <Textarea
            id="bulk-objectives"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            rows={8}
            placeholder={"Secure the outpost\nExtract the prisoners\nSabotage the airship"}
          />
        </div>
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
          Cancel
        </Button>
        <Button type="button" onClick={onSubmit} disabled={saving || draft.trim().length === 0}>
          {saving ? "Creating…" : "Create objectives"}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
);

interface ObjectiveTreeProps {
  nodes: ObjectiveTreeNode[];
  expanded: Set<string>;
  toggleExpanded: (_id: string) => void;
  onEdit: (_objective: ObjectiveRecord) => void;
  onAddChild: (_objective: ObjectiveRecord) => void;
  onDelete: (_objective: ObjectiveRecord) => void;
  canEdit: boolean;
  burgIndex: Map<string, BurgOption>;
  markerIndex: Map<string, MarkerOption>;
  reordering: boolean;
  onDragStart: (_id: string, _parentId: string | null) => void;
  onDragEnd: () => void;
  onDropAt: (_targetId: string, _position: "before" | "after") => void;
  dropTarget: { id: string; position: "before" | "after" } | null;
  onHover: (_targetId: string, _position: "before" | "after" | null) => void;
}

const ObjectiveTree = ({
  nodes,
  expanded,
  toggleExpanded,
  onEdit,
  onAddChild,
  onDelete,
  canEdit,
  burgIndex,
  markerIndex,
  reordering,
  onDragStart,
  onDragEnd,
  onDropAt,
  dropTarget,
  onHover,
}: ObjectiveTreeProps) => {
  const renderNodes = (tree: ObjectiveTreeNode[], depth = 0) => (
    <div className={cn(depth > 0 && "ml-5 border-l pl-4")}>{
      tree.map((node) => {
        const { record } = node;
        const hasChildren = node.children.length > 0;
        const isExpanded = expanded.has(record.id);
        const locationSummary = buildLocationSummary(record, burgIndex, markerIndex);
        const isDropBefore = dropTarget?.id === record.id && dropTarget.position === "before";
        const isDropAfter = dropTarget?.id === record.id && dropTarget.position === "after";

        return (
          <div key={record.id} className="space-y-1">
            <div
              data-testid={`drop-before-${record.id}`}
              className={cn(
                "h-2 rounded-sm border border-dashed border-transparent transition-colors",
                isDropBefore && "border-primary/70"
              )}
              onDragOver={(event) => {
                if (!canEdit || reordering) return;
                event.preventDefault();
                onHover(record.id, "before");
              }}
              onDragEnter={(event) => {
                if (!canEdit || reordering) return;
                event.preventDefault();
                onHover(record.id, "before");
              }}
              onDragLeave={() => {
                if (!canEdit || reordering) return;
                onHover(record.id, null);
              }}
              onDrop={(event) => {
                if (!canEdit || reordering) return;
                event.preventDefault();
                onHover(record.id, null);
                onDropAt(record.id, "before");
              }}
            />
            <div
              className={cn(
                "flex items-start gap-2 rounded-md border bg-card p-3 shadow-sm",
                reordering && "opacity-60",
              )}
              data-testid={`objective-${record.id}`}
              draggable={canEdit && !reordering}
              onDragStart={(event) => {
                if (!canEdit || reordering) {
                  event.preventDefault();
                  return;
                }
                event.dataTransfer.effectAllowed = "move";
                onDragStart(record.id, record.parentId ?? null);
              }}
              onDragEnd={onDragEnd}
            >
              <div className="flex flex-col items-center justify-center pt-1">
                {hasChildren ? (
                  <button
                    type="button"
                    className="rounded p-1 text-muted-foreground hover:bg-muted"
                    onClick={() => toggleExpanded(record.id)}
                    aria-label={isExpanded ? "Collapse objective" : "Expand objective"}
                  >
                    {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                  </button>
                ) : (
                  <span className="h-4 w-4" aria-hidden />
                )}
              </div>
              <div className="flex-shrink-0 pt-1 text-muted-foreground">
                {canEdit && <GripVertical className="h-4 w-4" />}
              </div>
              <div className="flex flex-1 flex-col gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium leading-none">{record.title}</span>
                  {record.isMajor && <Badge variant="secondary">Major</Badge>}
                  {record.slug && (
                    <Badge variant="outline" className="text-xs">
                      {record.slug}
                    </Badge>
                  )}
                </div>
                <div className="grid gap-1 text-xs text-muted-foreground sm:grid-cols-2">
                  <div className="flex items-center gap-1">
                    <MapPin className="h-3 w-3" />
                    <span>{locationSummary}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <Landmark className="h-3 w-3" />
                    <span>Order: {Number(record.orderIndex)}</span>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => onEdit(record)}
                    disabled={!canEdit || reordering}
                  >
                    <Pencil className="mr-1 h-3 w-3" /> Edit
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => onAddChild(record)}
                    disabled={!canEdit || reordering}
                  >
                    <GitBranchPlus className="mr-1 h-3 w-3" /> Add child
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="text-destructive"
                    onClick={() => onDelete(record)}
                    disabled={!canEdit || reordering}
                  >
                    <Trash2 className="mr-1 h-3 w-3" /> Delete
                  </Button>
                </div>
              </div>
            </div>
            <div
              data-testid={`drop-after-${record.id}`}
              className={cn(
                "h-2 rounded-sm border border-dashed border-transparent transition-colors",
                isDropAfter && "border-primary/70"
              )}
              onDragOver={(event) => {
                if (!canEdit || reordering) return;
                event.preventDefault();
                onHover(record.id, "after");
              }}
              onDragEnter={(event) => {
                if (!canEdit || reordering) return;
                event.preventDefault();
                onHover(record.id, "after");
              }}
              onDragLeave={() => {
                if (!canEdit || reordering) return;
                onHover(record.id, null);
              }}
              onDrop={(event) => {
                if (!canEdit || reordering) return;
                event.preventDefault();
                onHover(record.id, null);
                onDropAt(record.id, "after");
              }}
            />
            {hasChildren && isExpanded && (
              <div className="mt-2">
                {renderNodes(node.children, depth + 1)}
              </div>
            )}
          </div>
        );
      })
    } </div>
  );

  if (nodes.length === 0) {
    return (
      <div className="flex h-40 flex-col items-center justify-center rounded-md border border-dashed">
        <p className="text-sm font-medium">No objectives yet</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Capture objectives to drive your prep notes, LLM assists, and DM sidebar controls.
        </p>
      </div>
    );
  }

  return <div className="space-y-2">{renderNodes(nodes)}</div>;
};

export function ObjectivesPanel({ campaign, canEdit, worldMap, worldMapLoading, worldMapError }: ObjectivesPanelProps) {
  const [objectives, setObjectives] = useState<ObjectiveRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [bulkDialogOpen, setBulkDialogOpen] = useState(false);
  const [formValues, setFormValues] = useState<ObjectiveFormValues | null>(null);
  const [activeObjective, setActiveObjective] = useState<ObjectiveRecord | null>(null);
  const [defaultParentId, setDefaultParentId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [bulkSaving, setBulkSaving] = useState(false);
  const [bulkDraft, setBulkDraft] = useState("");
  const [bulkParentId, setBulkParentId] = useState<string | null>(null);
  const [bulkIsMajor, setBulkIsMajor] = useState(false);
  const [burgOptions, setBurgOptions] = useState<BurgOption[]>([]);
  const [markerOptions, setMarkerOptions] = useState<MarkerOption[]>([]);
  const [markerUnavailable, setMarkerUnavailable] = useState(false);
  const [reordering, setReordering] = useState(false);
  const [dragState, setDragState] = useState<{ id: string; parentId: string | null } | null>(null);
  const [dropTarget, setDropTarget] = useState<{ id: string; position: "before" | "after" } | null>(null);
  const [assistStates, setAssistStates] = useState<Record<ObjectiveAssistField, AssistUiState>>(createAssistUiState);
  const [spawn, setSpawn] = useState<SpawnPoint | null>(null);
  const [spawnLoaded, setSpawnLoaded] = useState(false);
  const { messages } = useWebSocket(campaign?.id ?? "");
  const { playerVisibilityRadius } = useGameSession();
  const processedMessageIndexRef = useRef(0);

  const disabledAssistState = useMemo(createAssistUiState, []);

  const objectiveIndex = useMemo(() => {
    const map = new Map<string, ObjectiveRecord>();
    objectives.forEach((objective) => {
      map.set(objective.id, objective);
    });
    return map;
  }, [objectives]);

  const burgIndex = useMemo(() => {
    const map = new Map<string, BurgOption>();
    burgOptions.forEach((burg) => map.set(burg.id, burg));
    return map;
  }, [burgOptions]);

  const markerIndex = useMemo(() => {
    const map = new Map<string, MarkerOption>();
    markerOptions.forEach((marker) => map.set(marker.id, marker));
    return map;
  }, [markerOptions]);

  const tree = useMemo(() => buildObjectiveTree(objectives), [objectives]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    setExpanded((prev) => {
      const next = new Set(prev);
      objectives
        .filter((objective) => !objective.parentId)
        .forEach((objective) => next.add(objective.id));
      return next;
    });
  }, [objectives]);

  const loadObjectives = useCallback(async () => {
    if (!campaign?.id) {
      setObjectives([]);
      setLoadError(null);
      return;
    }

    setLoading(true);
    setLoadError(null);
    try {
      const list = await listCampaignObjectives(campaign.id);
      setObjectives(list);
    } catch (error) {
      console.error("[ObjectivesPanel] Failed to load objectives", error);
      setLoadError(error instanceof Error ? error.message : "Failed to load objectives");
    } finally {
      setLoading(false);
    }
  }, [campaign?.id]);

  useEffect(() => {
    processedMessageIndexRef.current = 0;
    void loadObjectives();
  }, [loadObjectives]);

  useEffect(() => {
    if (!campaign?.id) {
      setSpawn(null);
      setSpawnLoaded(true);
      return;
    }

    let cancelled = false;
    const controller = new AbortController();

    (async () => {
      setSpawnLoaded(false);
      try {
        const spawns = await listCampaignSpawns(campaign.id, { signal: controller.signal });
        if (cancelled) return;
        const defaultSpawn = spawns.find((entry) => entry.isDefault) ?? spawns[0] ?? null;
        setSpawn(defaultSpawn ?? null);
      } catch (error) {
        if (!cancelled && !controller.signal.aborted) {
          console.error('[ObjectivesPanel] Failed to load spawn points', error);
          setSpawn(null);
        }
      } finally {
        if (!cancelled) {
          setSpawnLoaded(true);
        }
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [campaign?.id]);

  const computeBoundsNearSpawn = useCallback((): BoundsEnvelope | null => {
    if (!spawn?.geometry || !Array.isArray(spawn.geometry.coordinates)) {
      return null;
    }

    const [x, y] = spawn.geometry.coordinates;
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      return null;
    }

    const baseRadius = Number.isFinite(playerVisibilityRadius ?? NaN) && (playerVisibilityRadius ?? 0) > 0
      ? (playerVisibilityRadius as number)
      : DEFAULT_LOCATION_RADIUS;

    const bounds = worldMap?.bounds;
    const spanX = bounds ? Math.abs(bounds.east - bounds.west) : null;
    const spanY = bounds ? Math.abs(bounds.north - bounds.south) : null;
    const spanRadius = spanX && spanY
      ? Math.max(baseRadius, Math.min(spanX, spanY) * MAP_RADIUS_FRACTION)
      : baseRadius;
    const radius = spanRadius;

    return {
      west: x - radius,
      south: y - radius,
      east: x + radius,
      north: y + radius,
    };
  }, [spawn, playerVisibilityRadius, worldMap?.bounds]);

  const fetchBurgs = useCallback(async () => {
    if (!worldMap?.id || !spawnLoaded) {
      if (!spawnLoaded) {
        return;
      }
      setBurgOptions([]);
      return;
    }
    try {
      const bounds = computeBoundsNearSpawn();
      const boundsQuery = bounds
        ? `?bounds=${encodeURIComponent(JSON.stringify(bounds))}`
        : '';

      const response = await apiFetch(`/api/maps/${worldMap.id}/burgs${boundsQuery}`);
      if (!response.ok) {
        throw new Error(await readErrorMessage(response, "Failed to load burgs"));
      }
      const payload = await readJsonBody<unknown>(response);
      if (!Array.isArray(payload)) {
        setBurgOptions([]);
        return;
      }

      const options = payload.reduce<BurgOption[]>((acc, raw, index) => {
        if (!isPlainObject(raw)) {
          return acc;
        }

        const idCandidate = raw.id ?? raw.burg_id ?? index;
        const id = typeof idCandidate === "string" ? idCandidate : String(idCandidate);
        if (!id.trim()) {
          return acc;
        }

        const nameCandidate = raw.name;
        const name = typeof nameCandidate === "string" && nameCandidate.trim().length > 0
          ? nameCandidate
          : `Burg ${id}`;

        const populationValue = typeof raw.population === "number"
          ? raw.population
          : Number(raw.population);
        const population = Number.isFinite(populationValue) ? Number(populationValue) : null;

        acc.push({ id, name, population });
        return acc;
      }, []);

      setBurgOptions(options);
    } catch (error) {
      console.error("[ObjectivesPanel] Failed to load burg options", error);
      setBurgOptions([]);
    }
  }, [worldMap?.id, computeBoundsNearSpawn, spawnLoaded]);

  const fetchMarkers = useCallback(async () => {
    if (!worldMap?.id || !spawnLoaded) {
      if (!spawnLoaded) {
        return;
      }
      setMarkerOptions([]);
      setMarkerUnavailable(false);
      return;
    }

    try {
      const bounds = computeBoundsNearSpawn();
      const boundsQuery = bounds
        ? `?bounds=${encodeURIComponent(JSON.stringify(bounds))}`
        : '';

      const response = await apiFetch(`/api/maps/${worldMap.id}/markers${boundsQuery}`);
      if (response.status === 404) {
        setMarkerUnavailable(true);
        setMarkerOptions([]);
        return;
      }
      if (!response.ok) {
        throw new Error(await readErrorMessage(response, "Failed to load markers"));
      }
      const payload = await readJsonBody<unknown>(response);
      if (!Array.isArray(payload)) {
        setMarkerOptions([]);
        return;
      }

      const options = payload.reduce<MarkerOption[]>((acc, raw, index) => {
        if (!isPlainObject(raw)) {
          return acc;
        }

        const idCandidate = raw.id ?? raw.marker_id ?? index;
        const id = typeof idCandidate === "string" ? idCandidate : String(idCandidate);
        if (!id.trim()) {
          return acc;
        }

        const note = typeof raw.note === "string" ? raw.note : null;
        const type = typeof raw.type === "string" ? raw.type : null;
        const label = note && note.trim().length > 0
          ? note
          : type && type.trim().length > 0
            ? type
            : `Marker ${id}`;
        const icon = typeof raw.icon === "string" ? raw.icon : null;

        acc.push({ id, label, icon });
        return acc;
      }, []);

      setMarkerOptions(options);
      setMarkerUnavailable(false);
    } catch (error) {
      console.error("[ObjectivesPanel] Failed to load marker options", error);
      setMarkerOptions([]);
      setMarkerUnavailable(false);
    }
  }, [worldMap?.id, computeBoundsNearSpawn, spawnLoaded]);

  useEffect(() => {
    void fetchBurgs();
    void fetchMarkers();
  }, [fetchBurgs, fetchMarkers]);

  useEffect(() => {
    if (!campaign?.id) return;
    const pendingMessages = messages.slice(processedMessageIndexRef.current);
    if (pendingMessages.length === 0) {
      return;
    }

    pendingMessages.forEach((message) => {
      if (!isPlainObject(message)) {
        return;
      }

      const type = typeof message.type === "string" ? message.type : null;
      if (!type) {
        return;
      }

      const data = isPlainObject(message.data) ? message.data : null;

      if (type === "objective-created" && data && isObjectiveRecord(data.objective)) {
        const record = data.objective;
        setObjectives((prev) => {
          const exists = prev.some((item) => item.id === record.id);
          if (exists) {
            return prev.map((item) => (item.id === record.id ? record : item));
          }
          return [...prev, record];
        });
      } else if (type === "objective-updated" && data && isObjectiveRecord(data.objective)) {
        const record = data.objective;
        setObjectives((prev) => prev.map((item) => (item.id === record.id ? record : item)));
      } else if (type === "objective-deleted" && data) {
        const ids = toStringArray(data.deletedObjectiveIds);
        if (!ids) {
          return;
        }
        setObjectives((prev) => prev.filter((item) => !ids.includes(item.id)));
      }
    });

    processedMessageIndexRef.current = messages.length;
  }, [messages, campaign?.id]);

  const toggleExpanded = useCallback((id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const openCreateDialog = useCallback(
    (parentId: string | null = null) => {
      setDefaultParentId(parentId);
      setFormValues({
        title: "",
        parentId,
        isMajor: false,
        slug: null,
        descriptionMd: "",
        treasureMd: "",
        combatMd: "",
        npcsMd: "",
        rumoursMd: "",
        locationType: worldMap ? "pin" : "none",
        pin: null,
        locationBurgId: null,
        locationMarkerId: null,
      });
      setCreateDialogOpen(true);
    },
    [worldMap],
  );

  const handleCreate = useCallback(async () => {
    if (!campaign?.id || !formValues) return;

    const title = formValues.title.trim();
    if (!title) {
      toast.error("Objective title is required.");
      return;
    }

    const parentId = formValues.parentId ?? null;
    const siblings = objectives
      .filter((objective) => (objective.parentId ?? null) === parentId)
      .sort((a, b) => a.orderIndex - b.orderIndex);
    const nextOrderIndex = siblings.length;

    const { location, base } = formValuesToPayload(formValues);

    const payload: ObjectiveCreatePayload = {
      title,
      parentId,
      orderIndex: nextOrderIndex,
      isMajor: base.isMajor,
      slug: base.slug ?? null,
      descriptionMd: base.descriptionMd ?? null,
      treasureMd: base.treasureMd ?? null,
      combatMd: base.combatMd ?? null,
      npcsMd: base.npcsMd ?? null,
      rumoursMd: base.rumoursMd ?? null,
      location,
    };

    setSaving(true);
    try {
      const record = await createObjective(campaign.id, payload);
      setObjectives((prev) => [...prev, record]);
      toast.success("Objective created.");
      setCreateDialogOpen(false);
      setFormValues(null);
    } catch (error) {
      console.error("[ObjectivesPanel] Failed to create objective", error);
      toast.error(error instanceof Error ? error.message : "Failed to create objective");
    } finally {
      setSaving(false);
    }
  }, [campaign?.id, formValues, objectives]);

  const openEditDialog = useCallback((objective: ObjectiveRecord) => {
    setActiveObjective(objective);
    setFormValues(objectiveToFormValues(objective));
    setAssistStates(createAssistUiState());
    setEditDialogOpen(true);
  }, []);

  const handleUpdate = useCallback(async () => {
    if (!activeObjective || !formValues) return;

    const title = formValues.title.trim();
    if (!title) {
      toast.error("Objective title is required.");
      return;
    }

    const { location, base } = formValuesToPayload(formValues);

    const payload: ObjectiveUpdatePayload = {
      title,
      parentId: base.parentId,
      isMajor: base.isMajor,
      slug: base.slug ?? null,
      descriptionMd: base.descriptionMd ?? null,
      treasureMd: base.treasureMd ?? null,
      combatMd: base.combatMd ?? null,
      npcsMd: base.npcsMd ?? null,
      rumoursMd: base.rumoursMd ?? null,
      location,
    };

    setSaving(true);
    try {
      const updated = await updateObjective(activeObjective.id, payload);
      setObjectives((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
      toast.success("Objective updated.");
      setEditDialogOpen(false);
      setFormValues(null);
      setActiveObjective(null);
    } catch (error) {
      console.error("[ObjectivesPanel] Failed to update objective", error);
      toast.error(error instanceof Error ? error.message : "Failed to update objective");
    } finally {
      setSaving(false);
    }
  }, [activeObjective, formValues]);

  const handleRequestAssist = useCallback(
    async (field: ObjectiveAssistField) => {
      if (!canEdit) {
        toast.error("You do not have permission to run assists in this campaign.");
        return;
      }

      if (!activeObjective?.id) {
        toast.error("Select an objective before requesting an assist.");
        return;
      }

      setAssistStates((prev) => ({
        ...prev,
        [field]: { pending: true, message: null, error: null },
      }));

      try {
        const response = await requestObjectiveAssist(activeObjective.id, field);
        const updated = response.objective;

        setObjectives((prev) => {
          const exists = prev.some((item) => item.id === updated.id);
          if (!exists) {
            return [...prev, updated];
          }
          return prev.map((item) => (item.id === updated.id ? updated : item));
        });

        setActiveObjective(updated);

        const recordKey = assistFieldRecordKeys[field];
        const formKey = assistFieldFormKeys[field];
        const updatedValue = updated[recordKey] as string | null | undefined;

        setFormValues((prev) => {
          if (!prev) return prev;
          const nextValue = updatedValue ?? "";
          return { ...prev, [formKey]: nextValue };
        });

        const provider = response.assist?.provider ?? null;
        const providerLabel = [provider?.name, provider?.model].filter((value): value is string => Boolean(value && value.trim())).join(" · ");
        const successMessage = providerLabel
          ? `Generated with ${providerLabel}.`
          : "Assist content applied.";

        setAssistStates((prev) => ({
          ...prev,
          [field]: { pending: false, message: successMessage, error: null },
        }));

        toast.success(`${assistFieldLabels[field]} updated with assist content.`);
      } catch (error) {
        let message = error instanceof Error ? error.message : "Failed to generate objective assist.";
        if (error instanceof HttpError) {
          if (error.status === 429) {
            message = "Assist request throttled. Please wait before retrying.";
          } else if (error.status === 503) {
            message = "Assist service unavailable. Try again shortly.";
          }
        }

        console.error(`[ObjectivesPanel] Objective assist failed for ${field}`, error);
        setAssistStates((prev) => ({
          ...prev,
          [field]: { pending: false, message: null, error: message },
        }));
        toast.error(message);
      }
    },
    [activeObjective?.id, canEdit],
  );

  const handleDelete = useCallback(
    async (objective: ObjectiveRecord) => {
      if (!canEdit) return;
      if (!window.confirm("Delete this objective and all of its descendants?")) {
        return;
      }

      try {
        const deletedIds = await deleteObjective(objective.id);
        setObjectives((prev) => prev.filter((item) => !deletedIds.includes(item.id)));
        toast.success("Objective deleted.");
      } catch (error) {
        console.error("[ObjectivesPanel] Failed to delete objective", error);
        toast.error(error instanceof Error ? error.message : "Failed to delete objective");
      }
    },
    [canEdit],
  );

  const handleBulkCreate = useCallback(async () => {
    if (!campaign?.id) return;
    const titles = bulkDraft
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    if (titles.length === 0) {
      toast.error("Enter at least one objective title.");
      return;
    }

    const parentId = bulkParentId ?? null;
    const siblings = objectives
      .filter((objective) => (objective.parentId ?? null) === parentId)
      .sort((a, b) => a.orderIndex - b.orderIndex);

    let orderIndex = siblings.length;
    const created: ObjectiveRecord[] = [];

    setBulkSaving(true);
    try {
      for (const title of titles) {
        const payload: ObjectiveCreatePayload = {
          title,
          parentId,
          orderIndex,
          isMajor: bulkIsMajor,
          slug: null,
          descriptionMd: null,
          treasureMd: null,
          combatMd: null,
          npcsMd: null,
          rumoursMd: null,
        };
        const record = await createObjective(campaign.id, payload);
        created.push(record);
        orderIndex += 1;
      }
      setObjectives((prev) => [...prev, ...created]);
      toast.success(`Created ${created.length} objective${created.length === 1 ? "" : "s"}.`);
      setBulkDialogOpen(false);
      setBulkDraft("");
    } catch (error) {
      console.error("[ObjectivesPanel] Bulk create failed", error);
      toast.error(error instanceof Error ? error.message : "Failed to create objectives");
    } finally {
      setBulkSaving(false);
    }
  }, [bulkDraft, bulkIsMajor, bulkParentId, campaign?.id, objectives]);

  const handleDropAt = useCallback(
    async (targetId: string, position: "before" | "after") => {
      if (!dragState) return;
      const dragged = objectiveIndex.get(dragState.id);
      const target = objectiveIndex.get(targetId);
      if (!dragged || !target) return;

      if (targetId === dragged.id) {
        setDragState(null);
        setDropTarget(null);
        return;
      }

      const draggedParent = dragged.parentId ?? null;
      const targetParent = target.parentId ?? null;
      if (draggedParent !== targetParent) {
        toast.error("Drag between branches is not supported. Use Edit to change the parent.");
        setDropTarget(null);
        setDragState(null);
        return;
      }

      const siblings = objectives
        .filter((objective) => (objective.parentId ?? null) === draggedParent)
        .sort((a, b) => a.orderIndex - b.orderIndex);

      const withoutDragged = siblings.filter((objective) => objective.id !== dragged.id);
      const targetIndex = withoutDragged.findIndex((objective) => objective.id === targetId);
      if (targetIndex === -1) {
        setDropTarget(null);
        setDragState(null);
        return;
      }

      const insertionIndex = position === "before" ? targetIndex : targetIndex + 1;
      const reordered = [
        ...withoutDragged.slice(0, insertionIndex),
        dragged,
        ...withoutDragged.slice(insertionIndex),
      ];

      const updates = reordered.map((objective, index) => ({
        id: objective.id,
        orderIndex: index,
      }));

      const prior = objectives;
      const orderMap = new Map(updates.map((entry) => [entry.id, entry.orderIndex]));
      setObjectives((prev) =>
        prev.map((objective) =>
          orderMap.has(objective.id)
            ? { ...objective, orderIndex: orderMap.get(objective.id)! }
            : objective,
        ),
      );

      setReordering(true);
      try {
        const changed = updates.filter((entry) => objectiveIndex.get(entry.id)?.orderIndex !== entry.orderIndex);
        for (const entry of changed) {
          await updateObjective(entry.id, { orderIndex: entry.orderIndex });
        }
        if (changed.length > 0) {
          toast.success("Objective order updated.");
        }
      } catch (error) {
        console.error("[ObjectivesPanel] Failed to persist objective reordering", error);
        setObjectives(prior);
        toast.error(error instanceof Error ? error.message : "Failed to reorder objectives");
      } finally {
        setReordering(false);
        setDragState(null);
        setDropTarget(null);
      }
    },
    [dragState, objectiveIndex, objectives],
  );

  const parentOptions = useMemo(() => objectives.filter((objective) => objective.id !== activeObjective?.id), [objectives, activeObjective?.id]);

  const canRenderActions = Boolean(campaign);

  return (
    <Card>
      <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <CardTitle>Objectives</CardTitle>
          <CardDescription>
            Create, reorder, and manage the full objective tree against the live campaign backend.
          </CardDescription>
        </div>
        {canRenderActions && (
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void loadObjectives()}
              disabled={loading}
            >
              <RefreshCcw className="mr-2 h-4 w-4" /> Refresh
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setBulkParentId(null);
                setBulkDraft("");
                setBulkIsMajor(false);
                setBulkDialogOpen(true);
              }}
              disabled={!canEdit}
            >
              Bulk add
            </Button>
            <Button type="button" size="sm" onClick={() => openCreateDialog(null)} disabled={!canEdit}>
              <Plus className="mr-2 h-4 w-4" /> New objective
            </Button>
          </div>
        )}
      </CardHeader>
      <CardContent>
        {!campaign && (
          <Alert>
            <AlertTitle>Select a campaign</AlertTitle>
            <AlertDescription>
              Choose a campaign to load its objectives and manage the prep tree.
            </AlertDescription>
          </Alert>
        )}
        {campaign && loadError && (
          <Alert variant="destructive" className="mb-4">
            <AlertTitle>Failed to load objectives</AlertTitle>
            <AlertDescription>{loadError}</AlertDescription>
          </Alert>
        )}
        {campaign && !loadError && (
          <div className="space-y-4">
            {(loading || worldMapLoading) && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <LoadingSpinner className="h-4 w-4" />
                Loading {loading ? "objectives" : "world map"}…
              </div>
            )}
            {worldMapError && (
              <Alert variant="default" className={WARNING_ALERT_CLASS}>
                <AlertTitle>World map unavailable</AlertTitle>
                <AlertDescription>{worldMapError}</AlertDescription>
              </Alert>
            )}
            <ScrollArea className="max-h-[36rem] pr-4">
              <ObjectiveTree
                nodes={tree}
                expanded={expanded}
                toggleExpanded={toggleExpanded}
                onAddChild={(objective) => openCreateDialog(objective.id)}
                onEdit={openEditDialog}
                onDelete={handleDelete}
                canEdit={canEdit}
                burgIndex={burgIndex}
                markerIndex={markerIndex}
                reordering={reordering}
                onDragStart={(id, parentId) => {
                  setDragState({ id, parentId });
                }}
              onDragEnd={() => {
                setDragState(null);
                setDropTarget(null);
              }}
              onDropAt={(id, position) => {
                setDropTarget({ id, position });
                void handleDropAt(id, position);
              }}
              dropTarget={dropTarget}
              onHover={(id, position) => {
                if (position) {
                  setDropTarget({ id, position });
                } else {
                  setDropTarget(null);
                }
              }}
            />
            </ScrollArea>
          </div>
        )}
      </CardContent>

      <ObjectiveDialog
        mode="create"
        open={createDialogOpen}
        onOpenChange={(open) => {
          setCreateDialogOpen(open);
          if (!open) setFormValues(null);
        }}
        values={
          createDialogOpen
            ? formValues ?? {
                title: "",
                parentId: defaultParentId,
                isMajor: false,
                slug: null,
                descriptionMd: "",
                treasureMd: "",
                combatMd: "",
                npcsMd: "",
                rumoursMd: "",
                locationType: worldMap ? "pin" : "none",
                pin: null,
                locationBurgId: null,
                locationMarkerId: null,
              }
            : {
                title: "",
                parentId: defaultParentId,
                isMajor: false,
                slug: null,
                descriptionMd: "",
                treasureMd: "",
                combatMd: "",
                npcsMd: "",
                rumoursMd: "",
                locationType: worldMap ? "pin" : "none",
                pin: null,
                locationBurgId: null,
                locationMarkerId: null,
              }
        }
        onChange={(next) => setFormValues(next)}
        onSubmit={handleCreate}
        saving={saving}
        parentOptions={objectives}
        disabled={!canEdit}
        worldMap={worldMap}
        markerUnavailable={markerUnavailable}
        burgOptions={burgOptions}
        markerOptions={markerOptions}
        assistEnabled={false}
        assistStates={disabledAssistState}
        onRequestAssist={() => {}}
        assistDisabledReason="Save the objective before requesting an LLM assist."
      />

      {editDialogOpen && formValues && activeObjective && (
        <ObjectiveDialog
          mode="edit"
          open={editDialogOpen}
          onOpenChange={(open) => {
            setEditDialogOpen(open);
            if (!open) {
              setActiveObjective(null);
              setFormValues(null);
            }
          }}
          values={formValues}
          onChange={(next) => setFormValues(next)}
          onSubmit={handleUpdate}
          saving={saving}
          parentOptions={parentOptions}
          disabled={!canEdit}
          worldMap={worldMap}
          markerUnavailable={markerUnavailable}
          burgOptions={burgOptions}
          markerOptions={markerOptions}
          assistEnabled={Boolean(activeObjective.id) && canEdit}
          assistStates={assistStates}
          onRequestAssist={handleRequestAssist}
          assistDisabledReason={null}
        />
      )}

      <BulkCreateDialog
        open={bulkDialogOpen}
        onOpenChange={(open) => setBulkDialogOpen(open)}
        onSubmit={handleBulkCreate}
        saving={bulkSaving}
        parentOptions={objectives}
        parentId={bulkParentId}
        setParentId={setBulkParentId}
        isMajor={bulkIsMajor}
        setIsMajor={setBulkIsMajor}
        draft={bulkDraft}
        setDraft={setBulkDraft}
      />
    </Card>
  );
}
