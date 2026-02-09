import type { ReactNode } from "react";
import Feature, { type FeatureLike } from "ol/Feature";
import Point from "ol/geom/Point";
import { Circle as CircleStyle, Fill, Stroke, Style, Text } from "ol/style";
import type { Coordinate } from "ol/coordinate";

import type { WorldMapBounds } from "./map-data-loader";
import { getFeatureTypeFromProperties } from "./maps/feature-tooltip";
import type { GeometryFeature, SpawnFeature } from "./layers";
import type { SpawnPoint, CampaignRegion } from "../utils/api-client";

// ── Exported interfaces ──────────────────────────────────────────────

export interface MapContextDetails {
  coordinate: [number, number];
  feature: GeometryFeature | null;
  featureType: string | null;
  pixel: Coordinate;
  originalEvent: MouseEvent;
}

export interface MapContextAction {
  id: string;
  label: string;
  icon?: ReactNode;
  onSelect: (_context: MapContextDetails) => void;
  disabled?: boolean;
}

export interface BaseWorldMap {
  id: string;
  name: string;
  bounds: WorldMapBounds;
  width_pixels?: number | null;
  height_pixels?: number | null;
  meters_per_pixel?: number | null;
}

export interface MapFeatureDetails {
  id: string | null;
  type: string | null;
  name: string;
  coordinate: [number, number] | null;
  properties: Record<string, unknown>;
}

export interface CampaignPrepMapProps {
  worldMap: BaseWorldMap;
  spawn: SpawnPoint | null;
  editingSpawn: boolean;
  canEditSpawn: boolean;
  onSelectSpawn?: (_position: { x: number; y: number }) => void;
  onRequestLinkObjective?: (_context: MapContextDetails) => void;
  onRegionDrawComplete?: (_payload: { geometry: Record<string, unknown>; context: MapContextDetails | null }) => void;
  contextActionBuilder?: (_context: MapContextDetails, _defaults: MapContextAction[]) => MapContextAction[];
  onFeatureSelected?: (_details: MapFeatureDetails | null) => void;
  highlightPoint?: { coordinate: [number, number]; label?: string | null } | null;
  regions?: CampaignRegion[];
  className?: string;
  onError?: (_message: string) => void;
}

// ── Constants ────────────────────────────────────────────────────────

export const EXTENT_PADDING_RATIO = 0.05;

// ── Type aliases ─────────────────────────────────────────────────────

export type BoundsLike = {
  west: number;
  south: number;
  east: number;
  north: number;
};

export type CachedViewState = {
  center: [number, number];
  zoom: number | null;
  resolution: number | null;
  extent: [number, number, number, number];
  size: [number, number];
  boundsSignature: string;
  userAdjusted: boolean;
};

export type LooseTileSet = {
  id?: unknown;
  name?: unknown;
  base_url?: unknown;
  attribution?: unknown;
  min_zoom?: unknown;
  max_zoom?: unknown;
  tile_size?: unknown;
  wrapX?: unknown;
};

// ── Pure utility functions ───────────────────────────────────────────

export const isFiniteNumber = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v);

export const padExtent = (
  extent: [number, number, number, number],
  ratio: number = EXTENT_PADDING_RATIO,
): [number, number, number, number] => {
  const width = extent[2] - extent[0];
  const height = extent[3] - extent[1];
  if (width <= 0 || height <= 0) {
    return extent;
  }
  const padX = width * ratio;
  const padY = height * ratio;
  return [extent[0] - padX, extent[1] - padY, extent[2] + padX, extent[3] + padY];
};

export const createBoundsSignature = (bounds: BoundsLike | null | undefined): string => {
  if (!bounds) {
    return "bounds:none";
  }
  const { west, south, east, north } = bounds;
  const serialize = (value: number) =>
    Number.isFinite(value) ? value.toFixed(4) : "nan";
  return `bounds:${serialize(west)}|${serialize(south)}|${serialize(east)}|${serialize(north)}`;
};

export const isFiniteCoordinateTuple = (
  candidate: [number, number] | undefined | null,
): candidate is [number, number] => {
  return (
    Array.isArray(candidate)
    && candidate.length >= 2
    && candidate.every((value) => typeof value === "number" && Number.isFinite(value))
  );
};

export const isTileSetRecord = (v: unknown): v is Required<Pick<LooseTileSet, "id" | "base_url">> & LooseTileSet => {
  if (typeof v !== "object" || v === null) {
    return false;
  }
  const candidate = v as LooseTileSet;
  return typeof candidate.id === "string" && typeof candidate.base_url === "string";
};

export const castGeometryFeature = (feature: FeatureLike | undefined): GeometryFeature | null => {
  if (!feature) return null;
  return feature as GeometryFeature;
};

export const featureTypeFromProperties = (feature: GeometryFeature | null): string | null =>
  getFeatureTypeFromProperties(feature);

export const buildFeatureDetails = (feature: GeometryFeature | null, coordinate: Coordinate | null): MapFeatureDetails | null => {
  if (!feature) return null;
  const data = feature.get("data");
  const featureIdCandidate = feature.getId();
  const dataId = data && typeof data === "object" && "id" in data && typeof (data as Record<string, unknown>).id === "string"
    ? (data as Record<string, unknown>).id as string
    : null;
  const featureId = typeof featureIdCandidate === "string" && featureIdCandidate.trim()
    ? featureIdCandidate.trim()
    : dataId;

  const type = featureTypeFromProperties(feature);
  const nameProperty = feature.get("name");
  const derivedName = typeof nameProperty === "string" && nameProperty.trim()
    ? nameProperty.trim()
    : data && typeof data === "object" && "name" in data && typeof (data as Record<string, unknown>).name === "string"
      ? ((data as Record<string, unknown>).name as string)
      : type ?? "Feature";

  const properties = data && typeof data === "object"
    ? { ...(data as Record<string, unknown>) }
    : {};

  const normalizedCoordinate: [number, number] | null =
    coordinate && coordinate.length >= 2 && coordinate.every((value) => Number.isFinite(value))
      ? [coordinate[0], coordinate[1]]
      : null;

  return {
    id: featureId,
    type,
    name: derivedName,
    coordinate: normalizedCoordinate,
    properties,
  };
};

export const convertSpawnToFeature = (spawn: SpawnPoint | null): SpawnFeature | null => {
  if (!spawn?.geometry?.coordinates || spawn.geometry.coordinates.length < 2) {
    return null;
  }
  const [x, y] = spawn.geometry.coordinates.map(Number);
  const feature = new Feature<Point>({
    geometry: new Point([x, y]),
    id: spawn.id ?? "campaign-spawn",
    data: spawn,
  });
  feature.setStyle(spawnStyle);
  return feature;
};

// ── Static styles ────────────────────────────────────────────────────

export const spawnStyle = new Style({
  image: new CircleStyle({
    radius: 9,
    fill: new Fill({ color: "#f97316" }),
    stroke: new Stroke({ color: "#fff", width: 2 }),
  }),
  text: new Text({
    text: "Spawn",
    offsetY: -22,
    font: 'bold 12px "Inter", sans-serif',
    fill: new Fill({ color: "#111827" }),
    stroke: new Stroke({ color: "#FFFFFF", width: 3 }),
  }),
});
