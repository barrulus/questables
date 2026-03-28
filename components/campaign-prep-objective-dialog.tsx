import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "./ui/dialog";
import { Label } from "./ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";

type MapLocationKind = "pin" | "burg" | "marker" | "region";

interface ObjectiveLinkContext {
  label: string;
  context: { coordinate: number[] };
}

interface ObjectiveOption {
  id: string;
  title: string;
}

interface ObjectiveDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  linkContext: ObjectiveLinkContext | null;
  objectives: ObjectiveOption[];
  objectivesLoading: boolean;
  selectedObjectiveId: string | null;
  onObjectiveChange: (id: string | null) => void;
  locationKind: MapLocationKind;
  onLocationKindChange: (kind: MapLocationKind) => void;
  availableLocationKinds: Set<MapLocationKind>;
  error: string | null;
  onSubmit: () => void;
  onCancel: () => void;
  saving: boolean;
}

export function ObjectiveLocationDialog({
  open,
  onOpenChange,
  linkContext,
  objectives,
  objectivesLoading,
  selectedObjectiveId,
  onObjectiveChange,
  locationKind,
  onLocationKindChange,
  availableLocationKinds,
  error,
  onSubmit,
  onCancel,
  saving,
}: ObjectiveDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Link objective to map</DialogTitle>
          <DialogDescription>
            Choose which objective should inherit this map location.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {linkContext ? (
            <div className="rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
              <div className="font-medium text-foreground">{linkContext.label}</div>
              <div>
                x: {linkContext.context.coordinate[0].toFixed(1)} · y: {linkContext.context.coordinate[1].toFixed(1)}
              </div>
            </div>
          ) : null}
          <div className="space-y-2">
            <Label htmlFor="objective-select">Objective</Label>
            <Select
              value={selectedObjectiveId ?? "__none__"}
              onValueChange={(value) => onObjectiveChange(value === "__none__" ? null : value)}
            >
              <SelectTrigger id="objective-select">
                <SelectValue placeholder={objectivesLoading ? "Loading objectives…" : "Select objective"} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__" disabled>
                  Select objective
                </SelectItem>
                {objectives.map((objective) => (
                  <SelectItem key={objective.id} value={objective.id}>
                    {objective.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {objectivesLoading ? <p className="text-xs text-muted-foreground">Loading objectives…</p> : null}
          </div>
          <div className="space-y-2">
            <Label htmlFor="objective-location-kind">Link as</Label>
            <Select
              value={locationKind}
              onValueChange={(value) => onLocationKindChange(value as MapLocationKind)}
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
          {error ? <p className="text-xs text-destructive">{error}</p> : null}
        </div>
        <DialogFooter className="gap-2">
          <Button type="button" variant="outline" onClick={onCancel} disabled={saving}>
            Cancel
          </Button>
          <Button type="button" onClick={onSubmit} disabled={saving || objectivesLoading || !selectedObjectiveId}>
            {saving ? "Linking…" : "Link objective"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
