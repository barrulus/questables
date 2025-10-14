import TileGrid from 'ol/tilegrid/TileGrid';
import XYZ from 'ol/source/XYZ';
import type { WorldMapBounds } from '../map-data-loader';
import { questablesProjection, updateProjectionExtent } from '../map-projection';

export interface TileSetConfig {
  id: string;
  name: string;
  base_url: string;
  attribution?: string;
  min_zoom?: number;
  max_zoom?: number;
  tile_size?: number;
  wrapX?: boolean;
}

const DEFAULT_TILE_SIZE = 256;

export const createQuestablesTileSource = (
  tileSet: TileSetConfig,
  worldBounds?: WorldMapBounds | null,
) => {
  const minZoom = Number.isFinite(tileSet?.min_zoom)
    ? Math.max(0, Math.floor(Number(tileSet.min_zoom)))
    : 0;
  const maxZoomCandidate = Number.isFinite(tileSet?.max_zoom)
    ? Math.floor(Number(tileSet.max_zoom))
    : 20;
  const maxZoom = Math.max(minZoom, maxZoomCandidate);
  const tileSize = Number.isFinite(tileSet?.tile_size)
    ? Math.max(1, Number(tileSet.tile_size))
    : DEFAULT_TILE_SIZE;

  const extent = updateProjectionExtent(worldBounds ?? null);
  const width = extent[2] - extent[0];

  const resolutions = Array.from({ length: maxZoom + 1 }, (_, z) => width / tileSize / Math.pow(2, z));

  const tileGrid = new TileGrid({
    extent,
    origin: [extent[0], extent[3]],
    resolutions,
    tileSize
  });

  return new XYZ({
    projection: questablesProjection,
    url: tileSet.base_url,
    attributions: tileSet.attribution,
    tileGrid,
    wrapX: Boolean(tileSet.wrapX),
    minZoom,
    maxZoom,
    transition: 0
  });
};
