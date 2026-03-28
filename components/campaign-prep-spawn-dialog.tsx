import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "./ui/dialog";
import { Label } from "./ui/label";
import { Textarea } from "./ui/textarea";

interface SpawnDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pendingPosition: { x: number; y: number } | null;
  noteDraft: string;
  onNoteDraftChange: (value: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
  saving: boolean;
}

export function SpawnPointEditorDialog({
  open,
  onOpenChange,
  pendingPosition,
  noteDraft,
  onNoteDraftChange,
  onSubmit,
  onCancel,
  saving,
}: SpawnDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
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
              onChange={(event) => onNoteDraftChange(event.target.value)}
              placeholder="Describe the opening scene or context the party should see when they load in."
              rows={4}
            />
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="button" onClick={onSubmit} disabled={saving}>
            {saving ? "Saving…" : "Save Spawn"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
