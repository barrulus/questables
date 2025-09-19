import Projection from 'ol/proj/Projection';
import { addProjection } from 'ol/proj';

export const PIXEL_PROJECTION_CODE = 'QUESTABLES_PIXEL';
export const DEFAULT_PIXEL_EXTENT: [number, number, number, number] = [0, -20480000, 20480000, 0];

export const questablesProjection = new Projection({
  code: PIXEL_PROJECTION_CODE,
  units: 'm',
  extent: DEFAULT_PIXEL_EXTENT
});

addProjection(questablesProjection);

export const updateProjectionExtent = (
  bounds?: { west: number; south: number; east: number; north: number } | null
): [number, number, number, number] => {
  if (!bounds) {
    questablesProjection.setExtent(DEFAULT_PIXEL_EXTENT);
    return DEFAULT_PIXEL_EXTENT;
  }

  const extent: [number, number, number, number] = [
    bounds.west,
    bounds.south,
    bounds.east,
    bounds.north
  ];
  questablesProjection.setExtent(extent);
  return extent;
};
