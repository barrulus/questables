import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { WORLD_MAP_NONE_SENTINEL } from "../campaign-shared";
import type { WorldMapSummary } from "../../utils/world-map-cache";

export interface WorldMapSelectProps {
  value: string;
  onValueChange: (value: string) => void;
  worldMaps: WorldMapSummary[];
  worldMapsLoading: boolean;
  id?: string;
}

export function WorldMapSelect({
  value,
  onValueChange,
  worldMaps,
  worldMapsLoading,
  id,
}: WorldMapSelectProps) {
  if (worldMapsLoading) {
    return <p className="text-sm text-muted-foreground">Loading world maps…</p>;
  }

  if (worldMaps.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No world maps available. Upload one from the Map Manager before activating this
        campaign.
      </p>
    );
  }

  return (
    <Select value={value} onValueChange={onValueChange}>
      <SelectTrigger id={id}>
        <SelectValue placeholder="Select a world map" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={WORLD_MAP_NONE_SENTINEL}>
          No world map (set later)
        </SelectItem>
        {worldMaps.map((map) => (
          <SelectItem key={map.id} value={map.id}>
            {map.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
