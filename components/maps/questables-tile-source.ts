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

export interface PixelDimensions {
  widthPixels: number;
  heightPixels: number;
  metersPerPixel: number;
}

const DEFAULT_TILE_SIZE = 256;

export const createQuestablesTileSource = (
  tileSet: TileSetConfig,
  worldBounds?: WorldMapBounds | null,
  pixelDimensions?: PixelDimensions | null,
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

  const projectionExtent = updateProjectionExtent(worldBounds ?? null);

  // Tile images cover the full SVG area, which may be larger than the content
  // bounds stored in the DB. Use pixel dimensions to compute the true tile
  // extent when available; otherwise fall back to the projection extent.
  const tileExtent: [number, number, number, number] =
    pixelDimensions &&
    Number.isFinite(pixelDimensions.widthPixels) &&
    Number.isFinite(pixelDimensions.heightPixels) &&
    Number.isFinite(pixelDimensions.metersPerPixel) &&
    pixelDimensions.widthPixels > 0 &&
    pixelDimensions.heightPixels > 0 &&
    pixelDimensions.metersPerPixel > 0
      ? [
          0,
          -(pixelDimensions.heightPixels * pixelDimensions.metersPerPixel),
          pixelDimensions.widthPixels * pixelDimensions.metersPerPixel,
          0,
        ]
      : projectionExtent;

  const width = tileExtent[2] - tileExtent[0];

  const resolutions = Array.from({ length: maxZoom + 1 }, (_, z) => width / tileSize / Math.pow(2, z));

  const tileGrid = new TileGrid({
    extent: tileExtent,
    origin: [tileExtent[0], tileExtent[3]],
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
