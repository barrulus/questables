import TileGrid from 'ol/tilegrid/TileGrid';
import XYZ from 'ol/source/XYZ';
import { questablesProjection } from '../map-projection';
import { getApiBaseUrl } from '../../utils/api-client';

const DEFAULT_TILE_SIZE = 256;

export interface SvgViewBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Mirrors settlemaker's `computeTileInfo`: pads the SVG viewBox to a square
 * because the tile pyramid assumes square tiles and square grid. Returns the
 * padded viewBox in the same settlement-local Y-DOWN convention the SVG uses.
 */
export function squareViewBox(vb: SvgViewBox): SvgViewBox {
  const squareExtent = Math.max(vb.width, vb.height);
  const dx = (squareExtent - vb.width) / 2;
  const dy = (squareExtent - vb.height) / 2;
  return { x: vb.x - dx, y: vb.y - dy, width: squareExtent, height: squareExtent };
}

/**
 * Build an XYZ tile source that lines up with the settlement's local coord
 * frame. The server renders tiles by cropping the squared SVG viewBox into a
 * 2^maxZoom grid, so the OL tile grid needs to mirror that in projection
 * coords. We invert Y on the way into OL (Y-up) — callers that paint features
 * (players, entrances) whose coords are Y-DOWN must do the same flip.
 */
export const createSettlementTileSource = (
  burgId: string,
  maxZoom: number,
  viewBox?: SvgViewBox,
  tileSize: number = DEFAULT_TILE_SIZE,
) => {
  // Legacy callers that predate the sidecar-driven MapRoot flow don't have
  // the viewBox and fall back to a Y-up pixel grid anchored at the origin.
  // These paths are dead once MapRoot is wired, but keeping the fallback
  // avoids accidental runtime breakage.
  const totalPixels = tileSize * Math.pow(2, maxZoom);
  const fallbackVb: SvgViewBox = { x: 0, y: -totalPixels, width: totalPixels, height: totalPixels };
  const sq = squareViewBox(viewBox ?? fallbackVb);
  // OL is Y-up; the SVG viewBox is Y-down. Flip Y when converting extent:
  //   svg top (smallest svg-y) → OL max-y
  //   svg bottom (largest svg-y) → OL min-y
  const extent: [number, number, number, number] = [
    sq.x,
    -(sq.y + sq.height),
    sq.x + sq.width,
    -sq.y,
  ];

  const resolutions = Array.from(
    { length: maxZoom + 1 },
    (_, z) => sq.width / tileSize / Math.pow(2, z),
  );

  const tileGrid = new TileGrid({
    extent,
    origin: [sq.x, -sq.y], // top-left of tile (0,0) in OL coords
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
