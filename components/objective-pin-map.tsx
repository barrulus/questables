import { useCallback, useEffect, useRef, useState } from "react";
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
import { cn } from "./ui/utils";
import { LoadingSpinner } from "./ui/loading-spinner";

interface WorldMapBounds {
  north: number;
  south: number;
  east: number;
  west: number;
}

export interface ObjectivePinMapProps {
  worldMap: {
    id: string;
    name: string;
    bounds: WorldMapBounds;
  };
  value: { x: number; y: number } | null;
  onSelect: (_coords: { x: number; y: number }) => void;
  className?: string;
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

type ObjectiveSelectionFeature = Feature<Point>;
type ObjectiveSelectionSource = VectorSource<ObjectiveSelectionFeature>;
type ObjectiveSelectionLayer = VectorLayer<ObjectiveSelectionSource>;

const selectionStyle = new Style({
  image: new CircleStyle({
    radius: 7,
    fill: new Fill({ color: "#2563eb" }),
    stroke: new Stroke({ color: "#fff", width: 2 }),
  }),
});

const toNumber = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return null;
};

const parseTileSetRecord = (raw: unknown): TileSetConfig | null => {
  if (!raw || typeof raw !== "object") {
    return null;
  }

  const record = raw as Record<string, unknown>;
  const baseUrl = typeof record.base_url === "string" ? record.base_url.trim() : "";
  if (!baseUrl) {
    return null;
  }

  const minZoom = toNumber(record.min_zoom);
  const maxZoom = toNumber(record.max_zoom);
  const tileSize = toNumber(record.tile_size);

  return {
    id: String(record.id ?? "default"),
    name:
      typeof record.name === "string" && record.name.trim()
        ? record.name
        : String(record.id ?? "Tile Set"),
    base_url: baseUrl,
    attribution: typeof record.attribution === "string" ? record.attribution : null,
    min_zoom: minZoom,
    max_zoom: maxZoom,
    tile_size: tileSize,
  };
};

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

export function ObjectivePinMap({ worldMap, value, onSelect, className }: ObjectivePinMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<Map | null>(null);

  const selectionLayerRef = useRef<ObjectiveSelectionLayer | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<{ x: number; y: number } | null>(value);

  const updateSelectionFeature = useCallback((coords: { x: number; y: number } | null) => {
    const source = selectionLayerRef.current?.getSource();
    if (!source) return;

    source.clear();
    if (!coords) return;

    const feature = new Feature<Point>({
      geometry: new Point([coords.x, coords.y]),
      id: "objective-selection",
    });
    feature.setStyle(selectionStyle);
    source.addFeature(feature);
  }, []);

  useEffect(() => {
    setSelected(value);
  }, [value?.x, value?.y]);

  useEffect(() => {
    if (!selected) return;
    updateSelectionFeature(selected);
    if (mapRef.current) {
      mapRef.current.getView().animate({ center: [selected.x, selected.y], duration: 200 });
    }
  }, [selected, updateSelectionFeature]);

  useEffect(() => {
    let cancelled = false;
    let tileLayer: TileLayer<XYZ> | null = null;
    let selectionLayer: ObjectiveSelectionLayer | null = null;

    const initializeMap = async () => {
      if (!containerRef.current) {
        return;
      }

      setLoading(true);
      setError(null);

      try {
        const rawTileSets = await mapDataLoader.loadTileSets();
        if (cancelled) return;

        const tileSets: TileSetConfig[] = Array.isArray(rawTileSets)
          ? rawTileSets
              .map(parseTileSetRecord)
              .filter((tileSet): tileSet is TileSetConfig => tileSet !== null)
          : [];

        if (tileSets.length === 0) {
          setError("No active tile sets are configured. Upload tiles before selecting map coordinates.");
          setLoading(false);
          return;
        }

        const activeTileSet = tileSets[0];
        updateProjectionExtent(worldMap.bounds);

        tileLayer = new TileLayer({
          source: buildTileSource(activeTileSet, worldMap.bounds),
        });

        selectionLayer = new VectorLayer<ObjectiveSelectionSource>({
          source: new VectorSource<ObjectiveSelectionFeature>({ wrapX: false }),
        });
        selectionLayerRef.current = selectionLayer;

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
          target: containerRef.current,
          layers: [tileLayer, selectionLayer],
          view,
          controls: defaultControls({ zoom: true, rotate: false, attribution: false }),
        });

        map.on("singleclick", (event) => {
          const [x, y] = event.coordinate;
          const coords = { x: Number(x), y: Number(y) };
          setSelected(coords);
          onSelect(coords);
        });

        mapRef.current = map;
        map.updateSize();
        updateSelectionFeature(value);
      } catch (initializationError) {
        if (cancelled) return;
        console.error("[ObjectivePinMap] Failed to initialize map", initializationError);
        setError(initializationError instanceof Error ? initializationError.message : "Failed to load world map tiles");
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void initializeMap();

    return () => {
      cancelled = true;
      if (mapRef.current) {
        mapRef.current.setTarget(undefined);
        mapRef.current = null;
      }
      mapRef.current = null;
      selectionLayerRef.current = null;
      tileLayer = null;
      selectionLayer = null;
    };
  }, [worldMap.bounds, worldMap.id, onSelect, updateSelectionFeature, value]);

  return (
    <div className={cn("relative h-[24rem] w-full overflow-hidden rounded-md border", className)}>
      <div ref={containerRef} className="h-full w-full" />
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center bg-background/70 backdrop-blur">
          <LoadingSpinner className="h-6 w-6" />
        </div>
      )}
      {error && !loading && (
        <div className="absolute inset-0 flex items-center justify-center bg-background/80 p-4 text-center text-sm text-destructive">
          {error}
        </div>
      )}
    </div>
  );
}
