import TileGrid from 'ol/tilegrid/TileGrid';
import XYZ from 'ol/source/XYZ';
import { questablesProjection } from '../map-projection';
import { getApiBaseUrl } from '../../utils/api-client';

const DEFAULT_TILE_SIZE = 256;

export const createSettlementTileSource = (
  burgId: string,
  maxZoom: number,
  tileSize: number = DEFAULT_TILE_SIZE,
) => {
  const totalPixels = tileSize * Math.pow(2, maxZoom);
  const extent: [number, number, number, number] = [0, -totalPixels, totalPixels, 0];
  const width = extent[2] - extent[0];

  const resolutions = Array.from(
    { length: maxZoom + 1 },
    (_, z) => width / tileSize / Math.pow(2, z),
  );

  const tileGrid = new TileGrid({
    extent,
    origin: [extent[0], extent[3]],
    resolutions,
    tileSize,
  });

  const baseUrl = getApiBaseUrl();

  return new XYZ({
    projection: questablesProjection,
    url: `${baseUrl}/api/maps/settlements/${burgId}/tiles/{z}/{x}/{y}.png`,
    tileGrid,
    wrapX: false,
    minZoom: 0,
    maxZoom,
    transition: 0,
  });
};
