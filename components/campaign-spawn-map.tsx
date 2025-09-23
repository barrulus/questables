import { useEffect, useRef, useState, useCallback } from "react";
import Map from "ol/Map";
import View from "ol/View";
import TileLayer from "ol/layer/Tile";
import VectorLayer from "ol/layer/Vector";
import VectorSource from "ol/source/Vector";
import XYZ from "ol/source/XYZ";
import TileGrid from "ol/tilegrid/TileGrid";
import Feature from "ol/Feature";
import Point from "ol/geom/Point";
import { Circle as CircleStyle, Fill, Stroke, Style } from "ol/style";
import { defaults as defaultControls } from "ol/control";

import { mapDataLoader } from "./map-data-loader";
import { questablesProjection, updateProjectionExtent } from "./map-projection";
import type { SpawnPoint } from "../utils/api-client";

interface WorldMapBounds {
  north: number;
  south: number;
  east: number;
  west: number;
}

export interface CampaignSpawnMapProps {
  worldMap: {
    id: string;
    name: string;
    bounds: WorldMapBounds;
  };
  spawn: SpawnPoint | null;
  editing: boolean;
  canEdit: boolean;
  onSelectPosition: (_position: { x: number; y: number }) => void;
  onError?: (_message: string) => void;
}

interface TileSetConfig {
  id: string;
  name: string;
  base_url: string;
  attribution?: string | null;
  min_zoom?: number | null;
  max_zoom?: number | null;
  tile_size?: number | null;
}

const DEFAULT_TILE_SIZE = 256;

const buildTileSource = (tileSet: TileSetConfig, bounds: WorldMapBounds) => {
  const minZoom = Number.isFinite(tileSet.min_zoom)
    ? Math.max(0, Math.floor(Number(tileSet.min_zoom)))
    : 0;
  const maxZoomCandidate = Number.isFinite(tileSet.max_zoom)
    ? Math.floor(Number(tileSet.max_zoom))
    : 20;
  const maxZoom = Math.max(minZoom, maxZoomCandidate);
  const tileSize = Number.isFinite(tileSet.tile_size)
    ? Math.max(1, Number(tileSet.tile_size))
    : DEFAULT_TILE_SIZE;

  const extent = updateProjectionExtent(bounds);
  const worldWidth = extent[2] - extent[0];
  const resolutions = Array.from({ length: maxZoom + 1 }, (_, zoomLevel) => (
    worldWidth / tileSize / Math.pow(2, zoomLevel)
  ));

  return new XYZ({
    projection: questablesProjection,
    url: tileSet.base_url,
    attributions: tileSet.attribution ?? undefined,
    tileGrid: new TileGrid({
      extent,
      origin: [extent[0], extent[3]],
      resolutions,
      tileSize,
    }),
    wrapX: false,
    minZoom,
    maxZoom,
    transition: 0,
  });
};

const spawnStyle = new Style({
  image: new CircleStyle({
    radius: 8,
    fill: new Fill({ color: "#f97316" }),
    stroke: new Stroke({ color: "#fff", width: 2 })
  })
});

export function CampaignSpawnMap({
  worldMap,
  spawn,
  editing,
  canEdit,
  onSelectPosition,
  onError,
}: CampaignSpawnMapProps) {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapInstanceRef = useRef<Map | null>(null);
  const spawnLayerRef = useRef<VectorLayer<VectorSource<Point>> | null>(null);
  const [initializing, setInitializing] = useState(true);

  const updateSpawnFeature = useCallback((spawnPoint: SpawnPoint | null) => {
    const source = spawnLayerRef.current?.getSource();
    if (!source) return;
    source.clear();

    const coordinates = spawnPoint?.geometry?.coordinates;
    if (!Array.isArray(coordinates) || coordinates.length < 2) {
      return;
    }

    const feature = new Feature({
      geometry: new Point([Number(coordinates[0]), Number(coordinates[1])]),
      id: spawnPoint?.id ?? "default-spawn",
    });
    feature.setStyle(spawnStyle);
    source.addFeature(feature);
  }, []);

  useEffect(() => {
    let cancelled = false;

    const initializeMap = async () => {
      if (!mapContainerRef.current) {
        return;
      }

      setInitializing(true);

      try {
        type RawTileSet = {
          id?: unknown;
          name?: unknown;
          base_url?: unknown;
          attribution?: unknown;
          min_zoom?: unknown;
          max_zoom?: unknown;
          tile_size?: unknown;
        };

        const rawTileSets = await mapDataLoader.loadTileSets() as RawTileSet[];
        if (cancelled) return;

        const tileSets: TileSetConfig[] = rawTileSets
          .filter((ts): ts is RawTileSet & { id: string | number; base_url: string } => (
            ts !== null && ts !== undefined && ts.id !== undefined && ts.base_url !== undefined
          ))
          .map((ts) => ({
            id: String(ts.id),
            name: typeof ts.name === "string" && ts.name.trim() ? ts.name : String(ts.id),
            base_url: String(ts.base_url),
            attribution: typeof ts.attribution === "string" ? ts.attribution : undefined,
            min_zoom: Number.isFinite(Number(ts.min_zoom)) ? Number(ts.min_zoom) : undefined,
            max_zoom: Number.isFinite(Number(ts.max_zoom)) ? Number(ts.max_zoom) : undefined,
            tile_size: Number.isFinite(Number(ts.tile_size)) ? Number(ts.tile_size) : undefined,
          }));

        if (!Array.isArray(tileSets) || tileSets.length === 0) {
          onError?.("No active tile sets are configured. Upload tiles before using the prep map.");
          return;
        }

        const activeTileSet = tileSets[0];
        if (!activeTileSet?.base_url) {
          onError?.("Tile set configuration missing base URL.");
          return;
        }

        const tileLayer = new TileLayer({
          source: buildTileSource(activeTileSet, worldMap.bounds),
        });

        const spawnLayer = new VectorLayer({
          source: new VectorSource<Point>({ wrapX: false }),
        });
        spawnLayerRef.current = spawnLayer;

        updateProjectionExtent(worldMap.bounds);

        const [west, south, east, north] = [
          worldMap.bounds.west,
          worldMap.bounds.south,
          worldMap.bounds.east,
          worldMap.bounds.north,
        ];

        const view = new View({
          projection: questablesProjection,
          center: [(west + east) / 2, (south + north) / 2],
          zoom: 2,
          minZoom: 0,
          maxZoom: 22,
          enableRotation: false,
          extent: [west, south, east, north],
          constrainOnlyCenter: true,
        });

        const map = new Map({
          target: mapContainerRef.current,
          view,
          layers: [tileLayer, spawnLayer],
          controls: defaultControls({ zoom: false, attribution: true }),
        });

        mapInstanceRef.current = map;

        map.on("click", (event) => {
          if (!editing || !canEdit) {
            return;
          }
          const [x, y] = event.coordinate;
          onSelectPosition({ x, y });
        });

        map.on("pointermove", () => {
          const target = map.getTargetElement();
          if (!target) return;
          target.style.cursor = editing && canEdit ? "crosshair" : "";
        });

        map.getView().fit([west, south, east, north], { padding: [32, 32, 32, 32], duration: 0 });
        map.updateSize();

        updateSpawnFeature(spawn ?? null);
      } catch (error) {
        if (!cancelled) {
          onError?.(error instanceof Error ? error.message : "Failed to initialize map");
        }
      } finally {
        if (!cancelled) {
          setInitializing(false);
        }
      }
    };

    initializeMap();

    return () => {
      cancelled = true;
      const map = mapInstanceRef.current;
      if (map) {
        map.setTarget(undefined);
      }
      mapInstanceRef.current = null;
      spawnLayerRef.current = null;
    };
  }, [worldMap, canEdit, editing, onError, onSelectPosition, spawn, updateSpawnFeature]);

  useEffect(() => {
    updateSpawnFeature(spawn ?? null);
  }, [spawn, updateSpawnFeature]);

  useEffect(() => {
    const map = mapInstanceRef.current;
    const target = map?.getTargetElement();
    if (target) {
      target.style.cursor = editing && canEdit ? "crosshair" : "";
    }
  }, [editing, canEdit]);

  return (
    <div className="relative">
      <div
        ref={mapContainerRef}
        className="h-96 w-full rounded-md border bg-muted"
        aria-label={`World map for ${worldMap.name}`}
      />
      {editing && canEdit && (
        <div className="pointer-events-none absolute left-4 top-4 rounded-md bg-background/90 px-3 py-2 shadow">
          <p className="text-sm font-medium">Click the map to set the default spawn.</p>
        </div>
      )}
      {initializing && (
        <div className="absolute inset-0 flex items-center justify-center rounded-md bg-background/75 text-sm font-medium">
          Loading map…
        </div>
      )}
    </div>
  );
}
