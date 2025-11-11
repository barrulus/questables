import TileLayer from "ol/layer/Tile";

export const createBaseTileLayer = (): TileLayer => {
  return new TileLayer({ preload: 2, zIndex: 0, opacity: 1 });
};
