import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "./ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";

interface MovementDialogData {
  playerId: string;
  playerName: string;
  coordinate: [number, number];
  currentPosition: [number, number];
}

type MoveMode = 'walk' | 'ride' | 'boat' | 'fly' | 'teleport' | 'gm';

interface MapPlayerMovementDialogProps {
  dialog: MovementDialogData | null;
  onClose: () => void;
  moveMode: MoveMode;
  onMoveModeChange: (mode: MoveMode) => void;
  availableMoveModes: MoveMode[];
  movementDistance: number;
  onConfirm: () => void;
}

export type { MovementDialogData, MoveMode };

export function MapPlayerMovementDialog({
  dialog, onClose,
  moveMode, onMoveModeChange, availableMoveModes,
  movementDistance, onConfirm,
}: MapPlayerMovementDialogProps) {
  return (
    <Dialog open={Boolean(dialog)} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Confirm Movement</DialogTitle>
          <DialogDescription>
            Approve the new destination for this player token.
          </DialogDescription>
        </DialogHeader>
        {dialog ? (
          <div className="space-y-4 text-sm">
            <div className="text-muted-foreground">
              Moving <span className="font-semibold text-foreground">{dialog.playerName}</span>
            </div>
            <div className="grid gap-2">
              <div className="flex justify-between">
                <span>Current position</span>
                <span>{dialog.currentPosition[0].toFixed(2)}, {dialog.currentPosition[1].toFixed(2)}</span>
              </div>
              <div className="flex justify-between">
                <span>Target position</span>
                <span>{dialog.coordinate[0].toFixed(2)}, {dialog.coordinate[1].toFixed(2)}</span>
              </div>
              <div className="flex justify-between">
                <span>Distance</span>
                <span>{movementDistance.toFixed(2)} units (SRID-0)</span>
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium text-foreground">Movement mode</label>
              <Select value={moveMode} onValueChange={(value) => onMoveModeChange(value as MoveMode)}>
                <SelectTrigger className="w-full"><SelectValue placeholder="Select mode" /></SelectTrigger>
                <SelectContent>
                  {availableMoveModes.map((mode) => (
                    <SelectItem key={mode} value={mode}>
                      {mode.charAt(0).toUpperCase() + mode.slice(1)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        ) : null}
        <DialogFooter className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={onConfirm} disabled={!dialog}>Move token</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
