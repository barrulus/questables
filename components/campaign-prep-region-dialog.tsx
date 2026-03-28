import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "./ui/dialog";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { Textarea } from "./ui/textarea";
import type { CampaignRegionCategory } from "../utils/api-client";

const REGION_CATEGORY_OPTIONS: Array<{ value: CampaignRegionCategory; label: string }> = [
  { value: "encounter", label: "Encounter" },
  { value: "rumour", label: "Rumour" },
  { value: "narrative", label: "Narrative" },
  { value: "travel", label: "Travel" },
  { value: "custom", label: "Custom" },
];

interface RegionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  seedContext: { coordinate: number[] } | null;
  name: string;
  onNameChange: (value: string) => void;
  category: CampaignRegionCategory;
  onCategoryChange: (value: CampaignRegionCategory) => void;
  color: string;
  onColorChange: (value: string) => void;
  description: string;
  onDescriptionChange: (value: string) => void;
  error: string | null;
  onSubmit: () => void;
  onCancel: () => void;
  saving: boolean;
}

export function RegionCreationDialog({
  open,
  onOpenChange,
  seedContext,
  name,
  onNameChange,
  category,
  onCategoryChange,
  color,
  onColorChange,
  description,
  onDescriptionChange,
  error,
  onSubmit,
  onCancel,
  saving,
}: RegionDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create campaign region</DialogTitle>
          <DialogDescription>
            Name and categorize the selected area. Regions are persisted to the live database immediately.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {seedContext ? (
            <div className="rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
              <div className="flex items-center justify-between">
                <span className="font-medium text-foreground">Seed coordinates</span>
                <span>
                  x: {seedContext.coordinate[0].toFixed(1)} · y: {seedContext.coordinate[1].toFixed(1)}
                </span>
              </div>
            </div>
          ) : null}
          <div className="space-y-2">
            <Label htmlFor="region-name">Name</Label>
            <Input
              id="region-name"
              value={name}
              onChange={(event) => onNameChange(event.target.value)}
              placeholder="Bandit ambush territory"
              autoFocus
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="region-category">Category</Label>
            <Select value={category} onValueChange={(value) => onCategoryChange(value as CampaignRegionCategory)}>
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
                value={color}
                onChange={(event) => onColorChange(event.target.value)}
              />
              <Input
                value={color}
                onChange={(event) => onColorChange(event.target.value)}
                className="h-8"
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="region-description">Description (optional)</Label>
            <Textarea
              id="region-description"
              value={description}
              onChange={(event) => onDescriptionChange(event.target.value)}
              rows={3}
              placeholder="Notable encounters, terrain notes, or rumours about this region"
            />
          </div>
          {error ? <p className="text-xs text-destructive">{error}</p> : null}
        </div>
        <DialogFooter className="gap-2">
          <Button type="button" variant="outline" onClick={onCancel} disabled={saving}>
            Cancel
          </Button>
          <Button type="button" onClick={onSubmit} disabled={saving}>
            {saving ? "Saving…" : "Save region"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
