import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { RadioGroup, RadioGroupItem } from "./ui/radio-group";
import { Alert, AlertDescription, AlertTitle } from "./ui/alert";
import { Loader2, MapPin } from "lucide-react";

interface SelectOption {
  value: string;
  label: string;
}

interface TeleportNpcPanelProps {
  noneValue: string;
  npcId: string;
  onNpcIdChange: (value: string) => void;
  npcOptions: SelectOption[];
  npcsLoading: boolean;
  mode: "location" | "coordinates";
  onModeChange: (value: "location" | "coordinates") => void;
  locationId: string;
  onLocationIdChange: (value: string) => void;
  locationOptions: SelectOption[];
  locationsLoading: boolean;
  x: string;
  onXChange: (value: string) => void;
  y: string;
  onYChange: (value: string) => void;
  reason: string;
  onReasonChange: (value: string) => void;
  pending: boolean;
  feedback: { currentLocationId?: string | null; worldPosition?: { coordinates?: number[] } | null } | null;
  error: string | null;
  onTeleport: () => void;
}

export function TeleportNpcPanel({
  noneValue, npcId, onNpcIdChange, npcOptions, npcsLoading,
  mode, onModeChange, locationId, onLocationIdChange, locationOptions, locationsLoading,
  x, onXChange, y, onYChange, reason, onReasonChange,
  pending, feedback, error, onTeleport,
}: TeleportNpcPanelProps) {
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="dm-sidebar-npc-select">NPC</Label>
        <Select value={npcId} onValueChange={onNpcIdChange}>
          <SelectTrigger id="dm-sidebar-npc-select">
            <SelectValue placeholder={npcsLoading ? "Loading NPCs\u2026" : "Select an NPC"} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={noneValue}>Select an NPC</SelectItem>
            {npcOptions.map((option) => (
              <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label>Destination</Label>
        <RadioGroup value={mode} onValueChange={(v) => onModeChange(v as "location" | "coordinates")} className="flex flex-col gap-2 md:flex-row md:items-center">
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

      {mode === "location" ? (
        <div className="space-y-2">
          <Label htmlFor="dm-sidebar-npc-location-select">Location</Label>
          <Select value={locationId} onValueChange={onLocationIdChange}>
            <SelectTrigger id="dm-sidebar-npc-location-select">
              <SelectValue placeholder={locationsLoading ? "Loading locations\u2026" : "Select a location"} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={noneValue}>Select a location</SelectItem>
              {locationOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : (
        <div className="grid gap-4 grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="dm-sidebar-npc-x">X coordinate</Label>
            <Input id="dm-sidebar-npc-x" value={x} onChange={(e) => onXChange(e.target.value)} placeholder="42.5" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="dm-sidebar-npc-y">Y coordinate</Label>
            <Input id="dm-sidebar-npc-y" value={y} onChange={(e) => onYChange(e.target.value)} placeholder="99.1" />
          </div>
        </div>
      )}

      <div className="space-y-2">
        <Label htmlFor="dm-sidebar-npc-reason">Audit reason (optional)</Label>
        <Input id="dm-sidebar-npc-reason" value={reason} onChange={(e) => onReasonChange(e.target.value)} placeholder="Relocate closer to the party" />
      </div>

      <div className="flex flex-wrap gap-2">
        <Button onClick={onTeleport} disabled={pending}>
          {pending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <MapPin className="mr-2 h-4 w-4" />}Teleport NPC
        </Button>
      </div>

      {feedback && (
        <Alert>
          <AlertTitle>NPC teleported</AlertTitle>
          <AlertDescription>
            {feedback.currentLocationId
              ? `Now located at ${feedback.currentLocationId}.`
              : `World position ${(feedback.worldPosition?.coordinates ?? []).join(", ")}.`}
          </AlertDescription>
        </Alert>
      )}
      {error && (
        <Alert variant="destructive">
          <AlertTitle>NPC teleport failed</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
    </div>
  );
}
