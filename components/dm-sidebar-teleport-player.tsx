import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { RadioGroup, RadioGroupItem } from "./ui/radio-group";
import { Alert, AlertDescription, AlertTitle } from "./ui/alert";
import { Loader2, Target } from "lucide-react";

interface SelectOption {
  value: string;
  label: string;
}

interface TeleportPlayerPanelProps {
  noneValue: string;
  playerId: string;
  onPlayerIdChange: (value: string) => void;
  playerOptions: SelectOption[];
  playersLoading: boolean;
  playersError: string | null;
  mode: "spawn" | "coordinates";
  onModeChange: (value: "spawn" | "coordinates") => void;
  spawnId: string;
  onSpawnIdChange: (value: string) => void;
  spawnOptions: SelectOption[];
  spawns: unknown[];
  spawnsLoading: boolean;
  spawnsError: string | null;
  x: string;
  onXChange: (value: string) => void;
  y: string;
  onYChange: (value: string) => void;
  reason: string;
  onReasonChange: (value: string) => void;
  pending: boolean;
  feedback: { geometry?: { coordinates?: number[] } | null; reason?: string | null } | null;
  error: string | null;
  onTeleport: () => void;
}

export function TeleportPlayerPanel({
  noneValue, playerId, onPlayerIdChange, playerOptions, playersLoading, playersError,
  mode, onModeChange, spawnId, onSpawnIdChange, spawnOptions, spawns, spawnsLoading, spawnsError,
  x, onXChange, y, onYChange, reason, onReasonChange,
  pending, feedback, error, onTeleport,
}: TeleportPlayerPanelProps) {
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="dm-sidebar-player-select">Campaign player</Label>
        <Select value={playerId} onValueChange={onPlayerIdChange}>
          <SelectTrigger id="dm-sidebar-player-select">
            <SelectValue placeholder={playersLoading ? "Loading roster\u2026" : "Select a player"} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={noneValue}>Select a player</SelectItem>
            {playerOptions.map((option) => (
              <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {playersError && <p className="text-xs text-destructive">{playersError}</p>}
      </div>

      <div className="space-y-2">
        <Label>Destination</Label>
        <RadioGroup value={mode} onValueChange={(v) => onModeChange(v as "spawn" | "coordinates")} className="flex flex-col gap-2 md:flex-row md:items-center">
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

      {mode === "spawn" ? (
        <div className="space-y-2">
          <Label htmlFor="dm-sidebar-player-spawn-select">Spawn point</Label>
          <Select value={spawnId} onValueChange={onSpawnIdChange} disabled={spawns.length === 0}>
            <SelectTrigger id="dm-sidebar-player-spawn-select">
              <SelectValue placeholder={spawnsLoading ? "Loading spawns\u2026" : "Select a spawn"} />
            </SelectTrigger>
            <SelectContent>
              {spawnOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {spawnsError && <p className="text-xs text-destructive">{spawnsError}</p>}
          {spawns.length === 0 && (
            <p className="text-xs text-muted-foreground">No spawn points defined. Switch to manual coordinates to teleport players.</p>
          )}
        </div>
      ) : (
        <div className="grid gap-4 grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="dm-sidebar-player-x">X coordinate</Label>
            <Input id="dm-sidebar-player-x" value={x} onChange={(e) => onXChange(e.target.value)} placeholder="123.45" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="dm-sidebar-player-y">Y coordinate</Label>
            <Input id="dm-sidebar-player-y" value={y} onChange={(e) => onYChange(e.target.value)} placeholder="678.90" />
          </div>
        </div>
      )}

      <div className="space-y-2">
        <Label htmlFor="dm-sidebar-player-reason">Audit reason (optional)</Label>
        <Input id="dm-sidebar-player-reason" value={reason} onChange={(e) => onReasonChange(e.target.value)} placeholder="DM reposition during encounter" />
      </div>

      <div className="flex flex-wrap gap-2">
        <Button onClick={onTeleport} disabled={pending}>
          {pending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Target className="mr-2 h-4 w-4" />}Teleport player
        </Button>
      </div>

      {feedback && (
        <Alert>
          <AlertTitle>Player teleported</AlertTitle>
          <AlertDescription>
            Position {(feedback.geometry?.coordinates ?? []).join(", ")} · Reason: {feedback.reason ?? "unspecified"}
          </AlertDescription>
        </Alert>
      )}
      {error && (
        <Alert variant="destructive">
          <AlertTitle>Player teleport failed</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
    </div>
  );
}
