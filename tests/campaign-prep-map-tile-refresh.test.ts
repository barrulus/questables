import { jest } from "@jest/globals";
import type TileLayer from "ol/layer/Tile";

import { refreshTileLayerSource } from "../components/campaign-prep-map-tile-refresh";

const createMockTileLayer = (): jest.Mocked<TileLayer> =>
  ({
    setSource: jest.fn(),
    setVisible: jest.fn(),
    setOpacity: jest.fn(),
    changed: jest.fn(),
  } as unknown as jest.Mocked<TileLayer>);

describe("refreshTileLayerSource", () => {
  const worldBounds = {
    west: 0,
    south: 0,
    east: 10,
    north: 10,
  };

  const tileSet = {
    id: "mock-tileset",
    name: "Mock Tileset",
    base_url: "https://tiles.example.com",
    attribution: "Test",
    min_zoom: 2,
    max_zoom: 8,
    tile_size: 256,
    wrapX: true,
  } as const;

  it("applies a tileset source and keeps the view unchanged", () => {
    const baseLayer = createMockTileLayer();
    const createSource = jest.fn().mockReturnValue("mock-source");
    const applyConstraints = jest.fn();
    const clearError = jest.fn();
    const onFailure = jest.fn();

    refreshTileLayerSource({
      baseLayer,
      tileSet,
      worldBounds,
      createSource,
      applyConstraints,
      clearError,
      onFailure,
    });

    expect(createSource).toHaveBeenCalledWith(tileSet, worldBounds);
    expect(baseLayer.setSource).toHaveBeenCalledWith("mock-source");
    expect(baseLayer.setVisible).toHaveBeenCalledWith(true);
    expect(baseLayer.setOpacity).toHaveBeenCalledWith(1);
    expect(baseLayer.changed).toHaveBeenCalledTimes(1);
    expect(applyConstraints).toHaveBeenCalledWith(tileSet);
    expect(clearError).toHaveBeenCalledTimes(1);
    expect(onFailure).not.toHaveBeenCalled();
  });

  it("clears the tile source when no tileset is provided", () => {
    const baseLayer = createMockTileLayer();
    const createSource = jest.fn();
    const applyConstraints = jest.fn();
    const clearError = jest.fn();
    const onFailure = jest.fn();

    refreshTileLayerSource({
      baseLayer,
      tileSet: null,
      worldBounds,
      createSource,
      applyConstraints,
      clearError,
      onFailure,
    });

    expect(createSource).not.toHaveBeenCalled();
    expect(baseLayer.setSource).toHaveBeenCalledWith(null);
    expect(baseLayer.setVisible).toHaveBeenCalledWith(false);
    expect(baseLayer.setOpacity).not.toHaveBeenCalled();
    expect(baseLayer.changed).toHaveBeenCalledTimes(1);
    expect(applyConstraints).not.toHaveBeenCalled();
    expect(clearError).toHaveBeenCalledTimes(1);
    expect(onFailure).not.toHaveBeenCalled();
  });

  it("delegates errors to the failure handler", () => {
    const baseLayer = createMockTileLayer();
    const failingSourceFactory = jest.fn(() => {
      throw new Error("Boom");
    });
    const applyConstraints = jest.fn();
    const clearError = jest.fn();
    const onFailure = jest.fn();

    refreshTileLayerSource({
      baseLayer,
      tileSet,
      worldBounds,
      createSource: failingSourceFactory,
      applyConstraints,
      clearError,
      onFailure,
    });

    expect(failingSourceFactory).toHaveBeenCalledTimes(1);
    expect(baseLayer.setSource).not.toHaveBeenCalled();
    expect(applyConstraints).not.toHaveBeenCalled();
    expect(clearError).not.toHaveBeenCalled();
    expect(onFailure).toHaveBeenCalledTimes(1);
    expect(onFailure.mock.calls[0][0]).toBeInstanceOf(Error);
  });
});
