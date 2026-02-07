import type TileLayer from "ol/layer/Tile";

import type { WorldMapBounds } from "./map-data-loader";
import type { TileSetConfig as QuestablesTileSetConfig } from "./maps/questables-tile-source";

export interface RefreshTileLayerOptions {
  baseLayer: TileLayer | null;
  tileSet: QuestablesTileSetConfig | null;
  worldBounds: WorldMapBounds;
  createSource: (_tileSet: QuestablesTileSetConfig, _bounds: WorldMapBounds) => unknown;
  applyConstraints: (_tileSet: QuestablesTileSetConfig) => void;
  clearError: () => void;
  onFailure: (_error: unknown) => void;
}

export const refreshTileLayerSource = ({
  baseLayer,
  tileSet,
  worldBounds,
  createSource,
  applyConstraints,
  clearError,
  onFailure,
}: RefreshTileLayerOptions) => {
  if (!baseLayer) return;

  try {
    if (tileSet) {
      const source = createSource(tileSet, worldBounds);
      baseLayer.setSource(source as Parameters<NonNullable<RefreshTileLayerOptions['baseLayer']>['setSource']>[0]);
      baseLayer.setVisible(true);
      baseLayer.setOpacity(1);
      baseLayer.changed();
      applyConstraints(tileSet);
      clearError();
    } else {
      baseLayer.setSource(null);
      baseLayer.setVisible(false);
      baseLayer.changed();
      clearError();
    }
  } catch (error) {
    onFailure(error);
  }
};
