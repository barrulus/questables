/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import type { RefObject, ReactNode } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Button } from "./ui/button";
import { Tabs, TabsList, TabsTrigger } from "./ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { Badge } from "./ui/badge";
import { Popover, PopoverTrigger, PopoverContent } from "./ui/popover";
import { Checkbox } from "./ui/checkbox";
import { Switch } from "./ui/switch";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "./ui/dialog";
import { Avatar, AvatarFallback, AvatarImage } from "./ui/avatar";
import {
  MapPin,
  ZoomIn,
  ZoomOut,
  Move,
  Flag,
  Users,
  Crown,
  Globe,
  Crosshair,
  Layers,
  Navigation,
  Info,
  Search
} from "lucide-react";

// OpenLayers imports
import Map from 'ol/Map';
import View from 'ol/View';
import TileLayer from 'ol/layer/Tile';
import VectorLayer from 'ol/layer/Vector';
import VectorSource from 'ol/source/Vector';
import XYZ from 'ol/source/XYZ';
import Feature from 'ol/Feature';
import Point from 'ol/geom/Point';
import LineString from 'ol/geom/LineString';
import GeoJSON from 'ol/format/GeoJSON';
import { Style, Fill, Stroke, Circle as CircleStyle, Text } from 'ol/style';
import 'ol/ol.css';
import TileGrid from 'ol/tilegrid/TileGrid';
import { defaults as defaultControls } from 'ol/control';
import { Overlay } from 'ol';
import { mapDataLoader, type WorldMapBounds } from './map-data-loader';
import { DEFAULT_PIXEL_EXTENT, questablesProjection, updateProjectionExtent, PIXEL_PROJECTION_CODE } from './map-projection';
import { useGameSession } from "../contexts/GameSessionContext";
import { useUser } from "../contexts/UserContext";
import { useWebSocket } from "../hooks/useWebSocket";
import { apiFetch, fetchJson, readErrorMessage, readJsonBody } from "../utils/api-client";
import { toast } from "sonner";

interface PlayerToken {
  playerId: string;
  userId: string;
  characterId?: string;
  coordinates: [number, number];
  name: string;
  initials: string;
  avatarUrl?: string | null;
  visibilityState: 'visible' | 'stealthed' | 'hidden';
  role: string;
  canViewHistory: boolean;
  lastLocatedAt?: string | null;
  hitPoints?: { current: number; max: number; temporary?: number };
  conditions: string[];
}

interface PlayerTrailMeta {
  feature: Feature<LineString>;
  fetchedAt: number;
}

interface CampaignCharacterRow {
  id: string;
  name: string;
  avatar_url?: string | null;
  user_id?: string;
  campaign_player_id?: string;
  campaign_user_id?: string;
  role?: string;
  status?: string;
  visibility_state?: string;
  hit_points?: unknown;
  conditions?: unknown;
  loc_geometry?: unknown;
  last_located_at?: string | null;
}

interface WorldMapSummary {
  id: string;
  name: string;
  bounds: WorldMapBounds;
}

interface TileSetConfig {
  id: string;
  name: string;
  base_url: string;
  attribution?: string;
  min_zoom?: number;
  max_zoom?: number;
  tile_size?: number;
  wrapX?: boolean;
}

interface PopupDetails {
  data: unknown;
  feature: Feature;
  featureType: string;
  title: string;
  rows: Array<{ label: string; value: string }> | null;
  coordinates?: [number, number];
}

interface LayerVisibility {
  burgs: boolean;
  routes: boolean;
  rivers: boolean;
  cells: boolean;
  markers: boolean;
  campaignLocations: boolean;
  playerTokens: boolean;
  playerTrails: boolean;
}

const LABEL_VISIBILITY = {
  burgs: 3,
  markers: 6,
  campaignLocations: 7,
  pins: 6
} as const;

const MARKER_TYPE_ICONS: Record<string, string> = {
  circuses: '🎪',
  mirage: '💦',
  caves: '🦇',
  jousts: '🤺',
  waterfalls: '⟱',
  inns: '🍻',
  'hot-springs': '♨️',
  dungeons: '🗝️',
  'hill-monsters': '👹',
  'water-sources': '💧',
  bridges: '🌉',
  'sea-monsters': '🦑',
  canoes: '🛶',
  'disturbed-burials': '💀',
  volcanoes: '🌋',
  libraries: '📚',
  pirates: '🏴‍☠️',
  rifts: '🎆',
  'sacred-pineries': '🌲',
  'lake-monsters': '🐉',
  battlefields: '⚔️',
  'sacred-forests': '🌳',
  brigands: '💰',
  lighthouses: '🚨',
  encounters: '🧙',
  statues: '🗿',
  necropolises: '🪦',
  migration: '🐗',
  ruins: '🏺',
  fairs: '🎠',
  mines: '⛏️',
  portals: '🌀'
};

const INTERACTIVE_FEATURE_TYPES = new Set(['burg', 'marker', 'player']);
const MOVE_PROMPT_TOAST_ID = 'player-move-selection';
const MOVE_MODES = ['walk', 'ride', 'boat', 'fly', 'teleport', 'gm'] as const;
const TRAIL_CACHE_TTL_MS = 60_000;

const formatTypeLabel = (type: unknown): string => {
  if (typeof type !== 'string' || type.length === 0) {
    return 'Feature';
  }
  const cleaned = type.replace(/_/g, ' ');
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
};

const DEFAULT_ROUTE_STYLE = new Style({
  stroke: new Stroke({
    color: '#b07a57',
    width: 2,
    lineCap: 'round',
    lineJoin: 'round'
  })
});

const DEFAULT_ROUTE_STYLES = [DEFAULT_ROUTE_STYLE];

const ROUTE_STYLE_CONFIG: Record<string, { minZoom: number; styles: Style[] }> = {
  royal: {
    minZoom: 3,
    styles: [
      new Style({
        stroke: new Stroke({
          color: '#FFD700',
          width: 3.5,
          lineCap: 'round',
          lineJoin: 'round'
        })
      }),
      new Style({
        stroke: new Stroke({
          color: '#ee1a12ff',
          width: 2.0,
          lineCap: 'round',
          lineJoin: 'round'
        })
      })
    ]
  },
  majorSea: {
    minZoom: 3,
    styles: [
      new Style({
        stroke: new Stroke({
          color: '#FFFFFF',
          width: 3.5,
          lineCap: 'round',
          lineJoin: 'round'
        })
      }),
      new Style({
        stroke: new Stroke({
          color: '#1D4ED8',
          width: 3.0,
          lineCap: 'round',
          lineJoin: 'round'
        })
      })
    ]
  },
  regional: {
    minZoom: 5,
    styles: [
      new Style({
        stroke: new Stroke({
          color: '#87CEEB',
          width: 3.0,
          lineCap: 'round',
          lineJoin: 'round'
        })
      })
    ]
  },
  market: {
    minZoom: 5,
    styles: [
      new Style({
        stroke: new Stroke({
          color: '#8B4513',
          width: 3.0,
          lineCap: 'round',
          lineJoin: 'round'
        })
      })
    ]
  },
  local: {
    minZoom: 6,
    styles: [
      new Style({
        stroke: new Stroke({
          color: '#5C4033',
          width: 2.5,
          lineCap: 'round',
          lineJoin: 'round',
          lineDash: [8, 6]
        })
      })
    ]
  },
  footpath: {
    minZoom: 7,
    styles: [
      new Style({
        stroke: new Stroke({
          color: '#D2B48C',
          width: 2.0,
          lineCap: 'round',
          lineJoin: 'round',
          lineDash: [1, 8]
        })
      })
    ]
  }
};

const parseJsonValue = (value: unknown, fallback: unknown) => {
  if (value === null || value === undefined) return fallback;
  if (typeof value === 'object') {
    return value;
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return fallback;
    try {
      return JSON.parse(trimmed);
    } catch (error) {
      console.warn('[OpenLayersMap] Failed to parse JSON value', error);
      return fallback;
    }
  }

  return fallback;
};

const computeInitials = (name?: string | null): string => {
  if (!name) return '?';
  const parts = name
    .split(/\s+/)
    .map((part) => part.trim())
    .filter(Boolean);

  if (parts.length === 0) return '?';
  const first = parts[0].charAt(0).toUpperCase();
  const second = parts.length > 1 ? parts[parts.length - 1].charAt(0).toUpperCase() : '';
  return `${first}${second}` || first;
};

const normalizeConditions = (value: unknown): string[] => {
  const parsed = parseJsonValue(value, []);
  if (Array.isArray(parsed)) {
    return parsed
      .map((entry) => {
        if (typeof entry === 'string') return entry.trim();
        if (entry && typeof entry === 'object' && 'name' in entry && typeof entry.name === 'string') {
          return entry.name.trim();
        }
        return String(entry ?? '').trim();
      })
      .filter(Boolean);
  }
  return [];
};

const BURG_ZOOM_RULES = [
  { minZoom: 6, minPopulation: 0 },
  { minZoom: 5, minPopulation: 250 },
  { minZoom: 4, minPopulation: 1000 },
  { minZoom: 3, minPopulation: 10000 }
] as const;

const BURG_CATEGORY_THRESHOLDS = [
  { minPopulation: 10000, category: 'city' },
  { minPopulation: 1000, category: 'town' },
  { minPopulation: 250, category: 'village' },
  { minPopulation: 0, category: 'hamlet' }
] as const;

type BurgCategory = typeof BURG_CATEGORY_THRESHOLDS[number]['category'];

const BURG_STYLE_CONFIG: Record<BurgCategory, { radius: number; fill: string; stroke: string; font: string }> = {
  city:    { radius: 9, fill: '#1f78ff', stroke: '#ffffff', font: 'bold 13px "Inter", sans-serif' },
  town:    { radius: 7, fill: '#4c9c2d', stroke: '#ffffff', font: 'bold 12px "Inter", sans-serif' },
  village: { radius: 6, fill: '#c17d25', stroke: '#ffffff', font: '12px "Inter", sans-serif' },
  hamlet:  { radius: 5, fill: '#7b7f8c', stroke: '#ffffff', font: '12px "Inter", sans-serif' }
};

function getMinPopulationForZoom(zoom: number): number {
  const rule = BURG_ZOOM_RULES.find(({ minZoom }) => zoom >= minZoom);
  return rule ? rule.minPopulation : Number.POSITIVE_INFINITY;
}

function getBurgCategory(population: number): BurgCategory {
  const match = BURG_CATEGORY_THRESHOLDS.find(({ minPopulation }) => population >= minPopulation);
  return match ? match.category : 'hamlet';
}

const TOGGLEABLE_LAYER_OPTIONS: Array<{
  key: keyof LayerVisibility;
  label: string;
  icon: ReactNode;
}> = [
  { key: 'burgs', label: 'Burgs', icon: <Crown className="w-3 h-3" /> },
  { key: 'routes', label: 'Routes', icon: <Navigation className="w-3 h-3" /> },
  { key: 'markers', label: 'Markers', icon: <MapPin className="w-3 h-3" /> },
  { key: 'playerTokens', label: 'Players', icon: <Users className="w-3 h-3" /> },
  { key: 'playerTrails', label: 'Trails', icon: <Flag className="w-3 h-3" /> },
];

const DEFAULT_TILE_SIZE = 256;

const createGeographicTileSource = (tileSet: TileSetConfig, worldBounds?: WorldMapBounds | null) => {
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

export function OpenLayersMap() {
  const mapRef = useRef<HTMLDivElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<Map | null>(null);
  const overlayRef = useRef<Overlay | null>(null);
  const tileSetMinZoomRef = useRef<number>(0);
  const enforcedMinZoomRef = useRef<number>(0);
  const currentWorldBoundsRef = useRef<WorldMapBounds | null>(null);
  const currentZoomRef = useRef<number>(0);
  const hoveredFeatureIdRef = useRef<string | null>(null);

  // State
  const [mapMode, setMapMode] = useState<'world' | 'encounter'>('world');
  const [selectedTool, setSelectedTool] = useState<'move' | 'measure' | 'info'>('info');
  const [selectedWorldMap, setSelectedWorldMap] = useState<string>('');
  const [tileSets, setTileSets] = useState<TileSetConfig[]>([]);
  const [selectedTileSetId, setSelectedTileSetId] = useState<string>('');
  const [worldMaps, setWorldMaps] = useState<WorldMapSummary[]>([]);
  const [playerTokens, setPlayerTokens] = useState<PlayerToken[]>([]);
  const [playerLoading, setPlayerLoading] = useState(false);
  const [playerError, setPlayerError] = useState<string | null>(null);
  const [trailSelections, setTrailSelections] = useState<Record<string, boolean>>({});
  const [trailErrors, setTrailErrors] = useState<Record<string, string | null>>({});
  const [movementDialog, setMovementDialog] = useState<{
    playerId: string;
    playerName: string;
    coordinate: [number, number];
    currentPosition: [number, number];
  } | null>(null);
  const [moveMode, setMoveMode] = useState<string>('walk');
  const [selectedPlayerId, setSelectedPlayerId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [currentZoom, setCurrentZoom] = useState(0);
  const [layerVisibility, setLayerVisibility] = useState<LayerVisibility>({
    burgs: false,
    routes: false,
    rivers: false,
    cells: false,
    markers: false,
    campaignLocations: true,
    playerTokens: true,
    playerTrails: false
  });
  const [popupContent, setPopupContent] = useState<PopupDetails | null>(null);

  const {
    activeCampaignId,
    activeCampaign,
    playerVisibilityRadius,
    viewerRole,
    updateVisibilityMetadata,
  } = useGameSession();
  const { user } = useUser();
  const viewerRoles = useMemo(() => new Set((user?.roles ?? []).map((role) => role.toLowerCase())), [user?.roles]);
  const viewerIsAdmin = viewerRoles.has('admin');
  const normalizedViewerRole = viewerRole ? viewerRole.toLowerCase() : null;
  const viewerIsDm = normalizedViewerRole
    ? viewerRoles.has('admin') || ['dm', 'co-dm'].includes(normalizedViewerRole)
    : activeCampaign ? activeCampaign.dmUserId === user?.id : false;
  const {
    connected: socketConnected,
    messages: socketMessages,
    clearMessages: clearSocketMessages,
    getMessagesByType
  } = useWebSocket(activeCampaignId ?? '');

  const viewerIsCoDm = useMemo(
    () => normalizedViewerRole === 'co-dm'
      || playerTokens.some((token) => token.userId === user?.id && token.role === 'co-dm'),
    [normalizedViewerRole, playerTokens, user?.id]
  );
  const canControlAllTokens = viewerIsAdmin || viewerIsDm || viewerIsCoDm;
  const canTeleport = canControlAllTokens;

  const canControlPlayer = useCallback(
    (token: PlayerToken) => {
      if (canControlAllTokens) return true;
      if (!user?.id) return false;
      return token.userId === user.id;
    },
    [canControlAllTokens, user?.id]
  );

  const sortedPlayerTokens = useMemo(
    () => [...playerTokens].sort((a, b) => a.name.localeCompare(b.name)),
    [playerTokens]
  );

  const availableMoveModes = useMemo(
    () => (canTeleport ? MOVE_MODES : MOVE_MODES.filter((mode) => mode !== 'teleport' && mode !== 'gm')),
    [canTeleport]
  );

  const movementDistance = useMemo(() => {
    if (!movementDialog) return 0;
    const [targetX, targetY] = movementDialog.coordinate;
    const [currentX, currentY] = movementDialog.currentPosition;
    return Math.hypot(targetX - currentX, targetY - currentY);
  }, [movementDialog]);

  const geoJsonFormat = useMemo(() => new GeoJSON({
    dataProjection: PIXEL_PROJECTION_CODE,
    featureProjection: PIXEL_PROJECTION_CODE,
  }), []);
  const pendingMoveRef = useRef<{ playerId: string; playerName: string; coordinate?: [number, number] } | null>(null);
  const wasSocketConnectedRef = useRef<boolean | null>(null);
  const refreshOnReconnectRef = useRef(false);

  const clearMovementSelection = useCallback(() => {
    pendingMoveRef.current = null;
    setSelectedPlayerId(null);
    toast.dismiss(MOVE_PROMPT_TOAST_ID);
  }, []);

  const selectPlayerForMovement = useCallback((token: PlayerToken) => {
    if (!canControlPlayer(token)) {
      toast.error('You do not have permission to move this token.');
      return;
    }

    pendingMoveRef.current = { playerId: token.playerId, playerName: token.name };
    setSelectedPlayerId(token.playerId);
    overlayRef.current?.setPosition(undefined);
    setPopupContent(null);
    toast.info(`Selected ${token.name}. Click the map to choose a destination.`, {
      id: MOVE_PROMPT_TOAST_ID,
    });
  }, [canControlPlayer]);

  const removeTrailFeature = useCallback((playerId: string, options?: { retainCache?: boolean }) => {
    const layer = playerTrailLayerRef.current;
    if (!layer) return;
    const source = layer.getSource();
    if (!source) return;
    source.getFeatures().forEach((feature) => {
      if (feature.get('playerId') === playerId) {
        source.removeFeature(feature);
      }
    });
    if (!options?.retainCache) {
      playerTrailCacheRef.current.delete(playerId);
    }
  }, []);

  const addTrailFeature = useCallback((playerId: string, feature: Feature) => {
    const layer = playerTrailLayerRef.current;
    if (!layer) return;
    const source = layer.getSource();
    if (!source) return;
    removeTrailFeature(playerId, { retainCache: true });
    feature.set('playerId', playerId);
    source.addFeature(feature);
    playerTrailCacheRef.current.set(playerId, {
      feature: feature as Feature<LineString>,
      fetchedAt: Date.now(),
    });
  }, [removeTrailFeature]);

  const refreshTrailForPlayer = useCallback(async (playerId: string) => {
    if (!activeCampaignId) {
      return { success: false, hidden: false, message: 'No active campaign selected.' };
    }

    try {
      const radiusQuery = typeof playerVisibilityRadius === 'number'
        ? `?radius=${encodeURIComponent(playerVisibilityRadius)}`
        : '';
      const response = await apiFetch(`/api/campaigns/${activeCampaignId}/players/${playerId}/trail${radiusQuery}`);

      if (response.status === 403) {
        const message = await readErrorMessage(response, 'Trail hidden by campaign settings.');
        return { success: false, hidden: true, message };
      }

      if (!response.ok) {
        const message = await readErrorMessage(response, 'Failed to load player trail');
        return { success: false, hidden: false, message };
      }

      const payload = await readJsonBody<{ geometry?: unknown }>(response);
      if (!payload?.geometry) {
        return { success: false, hidden: false, message: 'Trail geometry is unavailable.' };
      }

      const feature = geoJsonFormat.readFeature({
        type: 'Feature',
        geometry: payload.geometry as any,
        properties: { playerId },
      });

      addTrailFeature(playerId, feature);
      return { success: true, hidden: false };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load player trail';
      return { success: false, hidden: false, message };
    }
  }, [activeCampaignId, addTrailFeature, geoJsonFormat, playerVisibilityRadius]);

  const handleTrailToggle = useCallback(async (player: PlayerToken, enabled: boolean) => {
    const playerId = player.playerId;

    if (!enabled) {
      setTrailSelections((prev) => ({ ...prev, [playerId]: false }));
      setTrailErrors((prev) => ({ ...prev, [playerId]: null }));
      removeTrailFeature(playerId, { retainCache: true });
      return;
    }

    setTrailSelections((prev) => ({ ...prev, [playerId]: true }));
    setTrailErrors((prev) => ({ ...prev, [playerId]: null }));

    if (!layerVisibility.playerTrails) {
      setLayerVisibility((prev) => ({ ...prev, playerTrails: true }));
    }

    const cached = playerTrailCacheRef.current.get(playerId);
    if (cached && Date.now() - cached.fetchedAt <= TRAIL_CACHE_TTL_MS) {
      addTrailFeature(playerId, cached.feature);
      return;
    }

    const result = await refreshTrailForPlayer(playerId);

    if (!result.success) {
      setTrailSelections((prev) => ({ ...prev, [playerId]: false }));
      removeTrailFeature(playerId);
      if (result.hidden) {
        const message = result.message ?? 'Trail is hidden for this player.';
        setTrailErrors((prev) => ({ ...prev, [playerId]: message }));
        toast.info(message);
      } else {
        const message = result.message ?? 'Failed to load player trail';
        setTrailErrors((prev) => ({ ...prev, [playerId]: message }));
        toast.error(message);
      }
    }
  }, [layerVisibility.playerTrails, refreshTrailForPlayer, removeTrailFeature, setLayerVisibility]);

  const focusOnPlayer = useCallback((token: PlayerToken) => {
    const view = mapInstanceRef.current?.getView();
    if (!view) return;
    const targetZoom = Math.max(view.getZoom() ?? 0, 6);
    view.animate({ center: token.coordinates, duration: 300, zoom: targetZoom });
  }, []);


  const applyTileSetConstraints = useCallback((tileSet: TileSetConfig | null) => {
    const view = mapInstanceRef.current?.getView();
    if (!view) return;

    const minZoom = typeof tileSet?.min_zoom === 'number' ? tileSet.min_zoom : 0;
    const maxZoom = typeof tileSet?.max_zoom === 'number' ? tileSet.max_zoom : 20;

    tileSetMinZoomRef.current = minZoom;
    view.setMinZoom(minZoom);
    view.setMaxZoom(maxZoom);

    const currentZoom = view.getZoom();
    if (typeof currentZoom === 'number') {
      if (currentZoom < minZoom) {
        view.setZoom(minZoom);
      } else if (currentZoom > maxZoom) {
        view.setZoom(maxZoom);
      }
    }
  }, []);

  const updateViewExtent = useCallback((bounds?: WorldMapBounds | null) => {
    const map = mapInstanceRef.current;
    const view = map?.getView();
    if (!map || !view) return;

    currentWorldBoundsRef.current = bounds ?? null;
    const extent = updateProjectionExtent(bounds ?? null);

    // OpenLayers View does not expose a setter, so update the optional property directly
    view.setProperties({ extent });

    const targetCenter: [number, number] = [
      (extent[0] + extent[2]) / 2,
      (extent[1] + extent[3]) / 2
    ];
    view.setCenter(targetCenter);

    const size = map.getSize();
    if (!size || size[0] === 0 || size[1] === 0) {
      requestAnimationFrame(() => updateViewExtent(bounds ?? null));
      return;
    }

    const width = extent[2] - extent[0];
    const height = extent[3] - extent[1];
    const requiredResolution = Math.max(width / size[0], height / size[1]);
    const extentZoom = view.getZoomForResolution(requiredResolution);

    if (typeof extentZoom === 'number' && Number.isFinite(extentZoom)) {
      const enforcedMinZoom = Math.max(tileSetMinZoomRef.current, extentZoom);
      enforcedMinZoomRef.current = enforcedMinZoom;
      view.setMinZoom(enforcedMinZoom);

      const currentZoom = view.getZoom();
      if (typeof currentZoom !== 'number' || currentZoom < enforcedMinZoom) {
        view.setZoom(enforcedMinZoom);
      }
    }

    map.renderSync();
  }, []);

  const getZoomForResolution = useCallback((resolution: number) => {
    const view = mapInstanceRef.current?.getView();
    if (!view) return currentZoomRef.current;
    const zoom = view.getZoomForResolution(resolution);
    return typeof zoom === 'number' && Number.isFinite(zoom) ? zoom : currentZoomRef.current;
  }, []);

  // Layer references
  const baseLayerRef = useRef<TileLayer | null>(null);
  const burgsLayerRef = useRef<VectorLayer | null>(null);
  const routesLayerRef = useRef<VectorLayer | null>(null);
  const riversLayerRef = useRef<VectorLayer | null>(null);
  const cellsLayerRef = useRef<VectorLayer | null>(null);
  const markersLayerRef = useRef<VectorLayer | null>(null);
  const campaignLayerRef = useRef<VectorLayer | null>(null);
  const playerLayerRef = useRef<VectorLayer | null>(null);
  const playerTrailLayerRef = useRef<VectorLayer | null>(null);
  const encounterLayerRef = useRef<VectorLayer | null>(null);
  const playerTrailCacheRef = useRef<Map<string, PlayerTrailMeta>>(new Map());
  const rosterByCharacterRef = useRef<Map<string, any>>(new Map());
  const rosterByPlayerRef = useRef<Map<string, any>>(new Map());
  const rosterLoadedForCampaignRef = useRef<string | null>(null);
  const burgStyleCacheRef = useRef<Record<string, Style>>({});
  const markerIconCacheRef = useRef<Record<string, Style>>({});

  const getFeatureType = useCallback((feature: Feature, data?: any) => {
    const rawType = data?.type ?? feature.get('type');
    return typeof rawType === 'string' ? rawType.toLowerCase() : '';
  }, []);

  const buildPopupDetails = useCallback((feature: Feature) => {
    const data = feature.get('data') ?? feature.getProperties();
    const featureType = getFeatureType(feature, data);

    const baseTitle = data?.name ?? feature.get('name') ?? (featureType ? featureType.charAt(0).toUpperCase() + featureType.slice(1) : 'Feature');

    const toText = (value: unknown): string => {
      if (value === null || value === undefined) {
        return '—';
      }
      if (typeof value === 'number') {
        return Number.isFinite(value) ? value.toLocaleString() : '—';
      }
      const stringValue = String(value).trim();
      return stringValue.length > 0 ? stringValue : '—';
    };

    const formatElevation = (value: unknown): string => {
      if (value === null || value === undefined) {
        return '—';
      }
      if (typeof value === 'number' && Number.isFinite(value)) {
        return `${value.toLocaleString()} m`;
      }
      const numeric = Number(value);
      if (!Number.isNaN(numeric)) {
        return `${numeric.toLocaleString()} m`;
      }
      const stringValue = String(value).trim();
      return stringValue.length > 0 ? stringValue : '—';
    };

    let title = baseTitle;
    let rows: Array<{ label: string; value: string }> | null = null;

    if (featureType === 'burg') {
      const populationValue = data?.population ?? data?.populationraw ?? data?.populationRaw;
      const elevationValue = data?.elevation ?? data?.height ?? data?.elevationm;

      rows = [
        { label: 'Culture', value: toText(data?.culture) },
        { label: 'Population', value: toText(populationValue) },
        { label: 'Elevation', value: formatElevation(elevationValue) }
      ];
    } else if (featureType === 'marker') {
      const markerName = data?.name ?? feature.get('name') ?? data?.type ?? 'Marker';
      title = markerName;
      rows = [
        { label: 'Name', value: toText(markerName) },
        { label: 'Note', value: toText(data?.note) }
      ];
    } else if (featureType === 'player') {
      const token = data as PlayerToken | undefined;
      title = token?.name ?? baseTitle;
      const hp = token?.hitPoints;
      const hpLabel = hp ? `${hp.current}/${hp.max}` : '—';
      rows = [
        { label: 'Role', value: toText(token?.role ?? 'player') },
        { label: 'Visibility', value: toText(token?.visibilityState ?? 'visible') },
        { label: 'HP', value: hpLabel },
        { label: 'Conditions', value: token?.conditions?.length ? token.conditions.join(', ') : 'None' },
        token?.lastLocatedAt
          ? { label: 'Last updated', value: new Date(token.lastLocatedAt).toLocaleString() }
          : { label: 'Last updated', value: '—' }
      ];
    }

    return {
      data,
      feature,
      featureType,
      title,
      rows
    };
  }, [getFeatureType]);

  const getBurgStyle = useCallback((feature: Feature, resolution: number) => {
    const data = feature.get('data');
    const zoom = getZoomForResolution(resolution);
    if (!Number.isFinite(zoom)) return null;

    const effectiveZoom = Math.floor(zoom);
    const population = Number(
      data?.population ?? data?.populationraw ?? data?.populationRaw ?? 0
    );
    const minPopulation = getMinPopulationForZoom(effectiveZoom);

    if (population < minPopulation || effectiveZoom < 3) {
      return null;
    }

    const category = getBurgCategory(population);
    const cacheKey = `${category}-${data?.capital ? 'capital' : 'standard'}`;
    const showLabel = effectiveZoom >= LABEL_VISIBILITY.burgs;
    let style = burgStyleCacheRef.current[cacheKey];

    if (!style) {
      const config = BURG_STYLE_CONFIG[category];

      const radius = config.radius + (data?.capital ? 2 : 0);

      style = new Style({
        image: new CircleStyle({
          radius,
          fill: new Fill({ color: data?.capital ? '#FFD700' : config.fill }),
          stroke: new Stroke({ color: config.stroke, width: 2 })
        }),
        text: new Text({
          offsetY: -radius - 10,
          font: config.font,
          fill: new Fill({ color: '#1f2933' }),
          stroke: new Stroke({ color: '#ffffff', width: 3 }),
          placement: 'point'
        })
      });

      burgStyleCacheRef.current[cacheKey] = style;
    }

    const text = style.getText();
    if (text) {
      text.setText(showLabel ? data?.name || feature.get('name') || '' : '');
    }

    return style;
  }, [getZoomForResolution]);

  const getRouteStyle = useCallback((feature: Feature, resolution: number) => {
    const data = feature.get('data') ?? feature.getProperties();
    const zoom = getZoomForResolution(resolution);

    if (!Number.isFinite(zoom)) {
      return null;
    }

    const routeType = String(data?.type ?? feature.get('type') ?? '');
    const config = ROUTE_STYLE_CONFIG[routeType];

    if (config) {
      if ((zoom as number) < config.minZoom) {
        return null;
      }
      return config.styles;
    }

    return (zoom as number) >= 3 ? DEFAULT_ROUTE_STYLES : null;
  }, [getZoomForResolution]);

  const getMarkerStyle = useCallback((feature: Feature, resolution: number) => {
    const data = feature.get('data') ?? feature.getProperties();
    const zoom = getZoomForResolution(resolution);

    if (!Number.isFinite(zoom) || (zoom as number) < LABEL_VISIBILITY.markers) {
      return null;
    }

    const type = String(data?.type ?? feature.get('type') ?? '');
    const icon = MARKER_TYPE_ICONS[type] ?? '?';

    let iconStyle = markerIconCacheRef.current[type];
    if (!iconStyle) {
      iconStyle = new Style({
        text: new Text({
          text: icon,
          font: '20px sans-serif',
          textBaseline: 'middle',
          textAlign: 'center',
          fill: new Fill({ color: '#000' }),
          stroke: new Stroke({ color: '#FFF', width: 3 }),
          placement: 'point'
        })
      });
      markerIconCacheRef.current[type] = iconStyle;
    }

    const showLabel = (zoom as number) >= LABEL_VISIBILITY.markers;
    const labelText = showLabel ? data?.name || '' : '';
    if (!labelText) {
      return iconStyle;
    }

    const labelStyle = new Style({
      text: new Text({
        text: labelText,
        offsetY: -24,
        font: '10px sans-serif',
        fill: new Fill({ color: '#111827' }),
        stroke: new Stroke({ color: '#FFF', width: 3 }),
        textAlign: 'center',
        textBaseline: 'bottom',
        placement: 'point'
      })
    });

    return [iconStyle, labelStyle];
  }, [getZoomForResolution]);

  const getCampaignLocationStyle = useCallback((feature: Feature, resolution: number) => {
    const data = feature.get('data') ?? feature.getProperties();
    const zoom = getZoomForResolution(resolution);
    const showLabel = zoom >= LABEL_VISIBILITY.campaignLocations;

    return new Style({
      image: new CircleStyle({
        radius: 8,
        fill: new Fill({ color: '#9B59B6' }),
        stroke: new Stroke({ color: '#FFF', width: 2 })
      }),
      text: new Text({
        text: showLabel ? data?.name || '' : '',
        offsetY: -18,
        font: 'bold 12px sans-serif',
        fill: new Fill({ color: '#000' }),
        stroke: new Stroke({ color: '#FFF', width: 2 })
      })
    });
  }, [getZoomForResolution]);

  const getPlayerTokenStyle = useCallback((feature: Feature, resolution: number) => {
    const data = feature.get('data') as PlayerToken | undefined;
    const zoom = getZoomForResolution(resolution);
    const showLabel = zoom >= LABEL_VISIBILITY.pins;
    const isSelected = feature.get('id') === selectedPlayerId;

    const visibilityState = data?.visibilityState ?? 'visible';
    const fillColor = visibilityState === 'hidden'
      ? 'rgba(148, 163, 184, 0.65)'
      : visibilityState === 'stealthed'
        ? 'rgba(59, 130, 246, 0.65)'
        : '#2563eb';
    const strokeColor = isSelected ? '#f59e0b' : '#ffffff';
    const radius = isSelected ? 11 : 9;

    const hp = data?.hitPoints;
    const hpPercent = hp && hp.max > 0
      ? Math.max(0, Math.min(100, Math.round((hp.current / hp.max) * 100)))
      : null;
    const statusParts: string[] = [];
    if (hpPercent !== null) {
      statusParts.push(`${hpPercent}% HP`);
    }
    if (data?.conditions.length) {
      statusParts.push(data.conditions.slice(0, 2).join(', '));
    }
    if (visibilityState === 'stealthed') {
      statusParts.push('Stealth');
    }

    const statusLabel = statusParts.join(' • ');

    const textLines: string[] = [];
    textLines.push(data?.initials ?? (data?.name ? data.name.charAt(0).toUpperCase() : '?'));
    if (showLabel && data?.name) {
      textLines.push(data.name);
    }
    if (showLabel && statusLabel) {
      textLines.push(statusLabel);
    }

    const textValue = textLines.filter(Boolean).join('\n');

    return new Style({
      image: new CircleStyle({
        radius,
        fill: new Fill({ color: fillColor }),
        stroke: new Stroke({ color: strokeColor, width: isSelected ? 3 : 2 })
      }),
      text: new Text({
        text: textValue,
        offsetY: -radius - 6,
        font: '12px "Inter", sans-serif',
        fill: new Fill({ color: '#111827' }),
        stroke: new Stroke({ color: '#FFF', width: 3 }),
        textAlign: 'center',
      })
    });
  }, [getZoomForResolution, selectedPlayerId]);

  const layerRefMap = useMemo<Record<keyof LayerVisibility, RefObject<VectorLayer | null>>>(() => ({
    burgs: burgsLayerRef,
    routes: routesLayerRef,
    rivers: riversLayerRef,
    cells: cellsLayerRef,
    markers: markersLayerRef,
    campaignLocations: campaignLayerRef,
    playerTokens: playerLayerRef,
    playerTrails: playerTrailLayerRef,
  }), []);

  const toggleLayer = useCallback((layerName: keyof LayerVisibility, value?: boolean) => {
    setLayerVisibility(prev => {
      const nextValue = typeof value === 'boolean' ? value : !prev[layerName];

      if (!nextValue) {
        const layer = layerRefMap[layerName].current;
        layer?.getSource()?.clear();
      }

      return {
        ...prev,
        [layerName]: nextValue
      };
    });
  }, [layerRefMap]);

  const loadInitialData = useCallback(async () => {
    const [worldMapsData, tileSetsData] = await Promise.all([
      mapDataLoader.loadWorldMaps(),
      mapDataLoader.loadTileSets()
    ]);

    const normalizedWorldMaps: WorldMapSummary[] = (worldMapsData || [])
      .map((map: any) => {
        if (!map?.id || !map?.bounds) {
          return null;
        }
        return {
          id: String(map.id),
          name: typeof map.name === 'string' && map.name.trim() ? map.name : 'World Map',
          bounds: map.bounds as WorldMapBounds,
        } as WorldMapSummary;
      })
      .filter((map): map is WorldMapSummary => Boolean(map));

    setWorldMaps(normalizedWorldMaps);

    const dbTileSets: TileSetConfig[] = (tileSetsData || [])
      .filter((ts: any) => ts && ts.id && ts.base_url)
      .map((ts: any) => ({
        id: String(ts.id),
        name: typeof ts.name === 'string' && ts.name.trim() ? ts.name : String(ts.id),
        base_url: ts.base_url,
        attribution: ts.attribution ?? undefined,
        min_zoom: Number.isFinite(ts.min_zoom) ? Number(ts.min_zoom) : undefined,
        max_zoom: Number.isFinite(ts.max_zoom) ? Number(ts.max_zoom) : undefined,
        tile_size: Number.isFinite(ts.tile_size) ? Number(ts.tile_size) : undefined,
        wrapX: ts.wrapX ?? false,
      }));

    setTileSets(dbTileSets);

    const initialWorldMap = normalizedWorldMaps[0] ?? null;
    if (initialWorldMap) {
      setSelectedWorldMap((prev) => (prev ? prev : initialWorldMap.id));
      updateViewExtent(initialWorldMap.bounds);
    } else {
      setSelectedWorldMap('');
      updateViewExtent(null);
    }

    if (dbTileSets.length === 0) {
      setSelectedTileSetId('');
      if (baseLayerRef.current) {
        baseLayerRef.current.setSource(null);
      }
      applyTileSetConstraints(null);
      toast.error('No active tile sets are configured in the database.');
    }
  }, [applyTileSetConstraints, updateViewExtent]);

  const applyTileSetConstraintsRef = useRef(applyTileSetConstraints);
  useEffect(() => {
    applyTileSetConstraintsRef.current = applyTileSetConstraints;
  }, [applyTileSetConstraints]);

  const updateViewExtentRef = useRef(updateViewExtent);
  useEffect(() => {
    updateViewExtentRef.current = updateViewExtent;
  }, [updateViewExtent]);

  const loadInitialDataRef = useRef(loadInitialData);
  useEffect(() => {
    loadInitialDataRef.current = loadInitialData;
  }, [loadInitialData]);

  const getBurgStyleRef = useRef(getBurgStyle);
  useEffect(() => {
    getBurgStyleRef.current = getBurgStyle;
    if (burgsLayerRef.current) {
      burgsLayerRef.current.changed();
    }
  }, [getBurgStyle]);

  const getRouteStyleRef = useRef(getRouteStyle);
  useEffect(() => {
    getRouteStyleRef.current = getRouteStyle;
    if (routesLayerRef.current) {
      routesLayerRef.current.changed();
    }
  }, [getRouteStyle]);

  const getMarkerStyleRef = useRef(getMarkerStyle);
  useEffect(() => {
    getMarkerStyleRef.current = getMarkerStyle;
    if (markersLayerRef.current) {
      markersLayerRef.current.changed();
    }
  }, [getMarkerStyle]);

  const getCampaignLocationStyleRef = useRef(getCampaignLocationStyle);
  useEffect(() => {
    getCampaignLocationStyleRef.current = getCampaignLocationStyle;
    if (campaignLayerRef.current) {
      campaignLayerRef.current.changed();
    }
  }, [getCampaignLocationStyle]);

  const getPlayerTokenStyleRef = useRef(getPlayerTokenStyle);
  useEffect(() => {
    getPlayerTokenStyleRef.current = getPlayerTokenStyle;
    if (playerLayerRef.current) {
      playerLayerRef.current.changed();
    }
  }, [getPlayerTokenStyle]);

  const layerVisibilityRef = useRef(layerVisibility);
  useEffect(() => {
    layerVisibilityRef.current = layerVisibility;
  }, [layerVisibility]);

  const mapModeRef = useRef(mapMode);
  useEffect(() => {
    mapModeRef.current = mapMode;
  }, [mapMode]);

  // Initialize OpenLayers map

  // Update tile source with current world bounds
  const updateTileSource = useCallback((tileSet: TileSetConfig | null) => {
    if (!baseLayerRef.current) return;

    const currentWorldMap = worldMaps.find(m => m.id === selectedWorldMap);
    const worldBounds = currentWorldMap?.bounds ?? null;

    if (!tileSet) {
      baseLayerRef.current.setSource(null);
      updateViewExtent(worldBounds);
      applyTileSetConstraints(null);
      return;
    }

    const newSource = createGeographicTileSource(tileSet, worldBounds);
    baseLayerRef.current.setSource(newSource);
    updateViewExtent(worldBounds);
    applyTileSetConstraints(tileSet);
  }, [worldMaps, selectedWorldMap, applyTileSetConstraints, updateViewExtent]);

  const loadCampaignRoster = useCallback(async (campaignId: string) => {
    try {
      const rows = await fetchJson<CampaignCharacterRow[]>(
        `/api/campaigns/${campaignId}/characters`,
        undefined,
        'Failed to load campaign roster'
      );

      if (!rows) {
        rosterByCharacterRef.current.clear();
        rosterByPlayerRef.current.clear();
        rosterLoadedForCampaignRef.current = campaignId;
        return;
      }

      const byCharacter = new Map<string, any>();
      const byPlayer = new Map<string, any>();

      rows.forEach((row) => {
        const hitPointsRaw = parseJsonValue(row.hit_points, { current: 0, max: 0, temporary: 0 }) as {
          current?: number;
          max?: number;
          temporary?: number;
        };
        const hitPoints = {
          current: Number.isFinite(hitPointsRaw.current) ? Number(hitPointsRaw.current) : 0,
          max: Number.isFinite(hitPointsRaw.max) ? Number(hitPointsRaw.max) : 0,
          temporary: Number.isFinite(hitPointsRaw.temporary) ? Number(hitPointsRaw.temporary) : 0,
        };

        const metadata = {
          characterId: row.id,
          name: row.name,
          avatarUrl: row.avatar_url ?? null,
          userId: row.campaign_user_id ?? row.user_id ?? '',
          role: row.role ?? 'player',
          status: row.status ?? 'active',
          visibilityState: (row.visibility_state ?? 'visible') as PlayerToken['visibilityState'],
          hitPoints,
          conditions: normalizeConditions(row.conditions),
          lastLocatedAt: row.last_located_at ?? null,
        };

        byCharacter.set(row.id, metadata);
        if (row.campaign_player_id) {
          byPlayer.set(row.campaign_player_id, metadata);
        }
      });

      rosterByCharacterRef.current = byCharacter;
      rosterByPlayerRef.current = byPlayer;
      rosterLoadedForCampaignRef.current = campaignId;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load campaign roster';
      setPlayerError((prev) => {
        if (prev !== message) {
          toast.error(message);
        }
        return message;
      });
    }
  }, []);

  const loadVisiblePlayers = useCallback(async (campaignId: string) => {
    if (!campaignId) {
      setPlayerTokens([]);
      setPlayerLoading(false);
      setPlayerError(null);
      return;
    }

    if (rosterLoadedForCampaignRef.current !== campaignId) {
      await loadCampaignRoster(campaignId);
    }

    setPlayerLoading(true);
    setPlayerError(null);

    try {
      const radiusQuery = typeof playerVisibilityRadius === 'number'
        ? `?radius=${encodeURIComponent(playerVisibilityRadius)}`
        : '';
      const response = await fetchJson<{
        type: string;
        features: Array<{ geometry: { type: string; coordinates: number[] }; properties: Record<string, any> }>;
        metadata?: { radius?: number; viewerRole?: string };
      }>(
        `/api/campaigns/${campaignId}/players/visible${radiusQuery}`,
        undefined,
        'Failed to load player positions'
      );

      const features = Array.isArray(response?.features) ? response.features : [];
      const tokens: PlayerToken[] = [];

      features.forEach((feature) => {
        if (!feature || !feature.geometry || feature.geometry.type !== 'Point') {
          return;
        }

        const coords = feature.geometry.coordinates;
        if (!Array.isArray(coords) || coords.length < 2) {
          return;
        }

        const properties = feature.properties ?? {};
        const playerId: string | undefined = properties.playerId ?? properties.player_id;
        if (!playerId) return;

        const characterId: string | undefined = properties.characterId ?? properties.character_id;
        const rosterEntry = rosterByPlayerRef.current.get(playerId)
          ?? (characterId ? rosterByCharacterRef.current.get(characterId) : undefined)
          ?? null;

        const name = rosterEntry?.name ?? properties.name ?? `Player ${playerId.slice(0, 6)}`;
        const visibilityState = (properties.visibilityState ?? properties.visibility_state ?? rosterEntry?.visibilityState ?? 'visible') as PlayerToken['visibilityState'];
        const token: PlayerToken = {
          playerId,
          userId: rosterEntry?.userId ?? properties.userId ?? properties.user_id ?? '',
          characterId: characterId ?? rosterEntry?.characterId,
          coordinates: [Number(coords[0]), Number(coords[1])],
          name,
          initials: computeInitials(name),
          avatarUrl: rosterEntry?.avatarUrl ?? properties.avatarUrl ?? properties.avatar_url ?? null,
          visibilityState,
          role: properties.role ?? properties.playerRole ?? rosterEntry?.role ?? 'player',
          canViewHistory: Boolean(properties.canViewHistory ?? properties.can_view_history),
          lastLocatedAt: properties.lastLocatedAt ?? properties.last_located_at ?? rosterEntry?.lastLocatedAt ?? null,
          hitPoints: rosterEntry?.hitPoints,
          conditions: rosterEntry?.conditions ?? [],
        };

        tokens.push(token);
      });

      setPlayerTokens(tokens);
      setPlayerLoading(false);
      if (response?.metadata) {
        updateVisibilityMetadata({
          radius: typeof response.metadata.radius === 'number' ? response.metadata.radius : undefined,
          viewerRole: typeof response.metadata.viewerRole === 'string' ? response.metadata.viewerRole : undefined,
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load player positions';
      setPlayerError((prev) => {
        if (prev !== message) {
          toast.error(message);
        }
        return message;
      });
      setPlayerLoading(false);
    }
  }, [loadCampaignRoster, playerVisibilityRadius, updateVisibilityMetadata]);

  const handleConfirmMove = useCallback(async () => {
    if (!movementDialog || !activeCampaignId) {
      return;
    }

    const { playerId, playerName, coordinate } = movementDialog;

    try {
      await fetchJson(
        `/api/campaigns/${activeCampaignId}/players/${playerId}/move`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            target: { x: Number(coordinate[0]), y: Number(coordinate[1]) },
            mode: moveMode,
          }),
        },
        'Failed to move player token'
      );

      toast.success(`${playerName} moved successfully.`);
      setPlayerError(null);
      clearMovementSelection();
      setMovementDialog(null);
      await loadVisiblePlayers(activeCampaignId);
      if (trailSelections[playerId]) {
        await refreshTrailForPlayer(playerId);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to move player token';
      setPlayerError(message);
      toast.error(message);
    }
  }, [
    activeCampaignId,
    clearMovementSelection,
    loadVisiblePlayers,
    moveMode,
    movementDialog,
    refreshTrailForPlayer,
    trailSelections,
  ]);

  const handleMapClick = useCallback((event: any) => {
    const map = mapInstanceRef.current;
    if (!map) return;

    const features = map.getFeaturesAtPixel(event.pixel) as Feature[];

    if (selectedTool === 'move') {
      const playerFeature = features.find((feature) => {
        const data = feature.get('data') ?? feature.getProperties();
        return getFeatureType(feature, data) === 'player';
      });

      if (playerFeature) {
        const data = playerFeature.get('data') ?? playerFeature.getProperties();
        const playerId = data?.playerId ?? playerFeature.get('playerId');
        if (typeof playerId === 'string') {
          const token = playerTokens.find((p) => p.playerId === playerId);
          if (token) {
            selectPlayerForMovement(token);
          }
        }
        return;
      }

      if (pendingMoveRef.current?.playerId) {
        const pending = pendingMoveRef.current;
        const token = playerTokens.find((p) => p.playerId === pending.playerId);
        if (token) {
          setMovementDialog({
            playerId: pending.playerId,
            playerName: pending.playerName,
            coordinate: event.coordinate as [number, number],
            currentPosition: token.coordinates,
          });
        }
        return;
      }
    }

    if (features.length > 0) {
      const interactiveFeature = features.find((feature) => {
        const data = feature.get('data') ?? feature.getProperties();
        const type = getFeatureType(feature, data);
        return INTERACTIVE_FEATURE_TYPES.has(type);
      });

      if (interactiveFeature) {
        const details = buildPopupDetails(interactiveFeature);
        const featureId = interactiveFeature.get('id') ?? details.data?.id ?? null;
        hoveredFeatureIdRef.current = featureId;
        setPopupContent({
          ...details,
          coordinates: event.coordinate
        });
        overlayRef.current?.setPosition(event.coordinate);
        return;
      }
    }

    if (selectedTool === 'info' && features.length > 0) {
      const feature = features[0];
      const details = buildPopupDetails(feature);
      const featureId = feature.get('id') ?? details.data?.id ?? null;
      hoveredFeatureIdRef.current = featureId;
      setPopupContent({
        ...details,
        coordinates: event.coordinate
      });
      overlayRef.current?.setPosition(event.coordinate);
    } else {
      overlayRef.current?.setPosition(undefined);
      setPopupContent(null);
      hoveredFeatureIdRef.current = null;
    }
  }, [buildPopupDetails, getFeatureType, playerTokens, selectPlayerForMovement, selectedTool]);

  const handleZoomChange = useCallback(() => {
    const view = mapInstanceRef.current?.getView();
    if (view) {
      const zoom = view.getZoom() || 0;
      setCurrentZoom(Math.round(zoom));
      currentZoomRef.current = zoom;

      const minZoom = enforcedMinZoomRef.current || tileSetMinZoomRef.current;
      if (zoom < minZoom) {
        view.setZoom(minZoom);
        setCurrentZoom(Math.round(minZoom));
        return;
      }

      // Auto-enable/disable cells layer based on zoom
      if (zoom >= 10 && !layerVisibility.cells) {
        toggleLayer('cells', true);
      } else if (zoom < 8 && layerVisibility.cells) {
        toggleLayer('cells', false);
      }

      burgsLayerRef.current?.changed();
    }
  }, [layerVisibility.cells, toggleLayer]);

  const handleZoomChangeRef = useRef(handleZoomChange);
  useEffect(() => {
    handleZoomChangeRef.current = handleZoomChange;
  }, [handleZoomChange]);

  const handlePointerMove = useCallback((event: any) => {
    const map = mapInstanceRef.current;
    if (!map) return;

    const targetElement = map.getTargetElement();
    if (!targetElement) return;

    const features = map.getFeaturesAtPixel(event.pixel) as Feature[];
    const hasInteractiveFeature = features.some((feature) => {
      const data = feature.get('data') ?? feature.getProperties();
      const type = getFeatureType(feature, data);
      return INTERACTIVE_FEATURE_TYPES.has(type);
    });

    const shouldShowPointer = hasInteractiveFeature || (selectedTool === 'info' && features.length > 0);
    targetElement.style.cursor = shouldShowPointer ? 'pointer' : '';

    if (selectedTool !== 'info') return;

    if (features.length > 0) {
      const feature = features[0];
      const details = buildPopupDetails(feature);
      const featureId = feature.get('id') ?? details.data?.id ?? null;
      if (hoveredFeatureIdRef.current === featureId) {
        overlayRef.current?.setPosition(event.coordinate);
        return;
      }

      hoveredFeatureIdRef.current = featureId;
      setPopupContent({
        ...details,
        coordinates: event.coordinate
      });
      overlayRef.current?.setPosition(event.coordinate);
    } else if (hoveredFeatureIdRef.current !== null) {
      hoveredFeatureIdRef.current = null;
      overlayRef.current?.setPosition(undefined);
      setPopupContent(null);
    }
  }, [buildPopupDetails, getFeatureType, selectedTool]);

  const handlePointerMoveRef = useRef(handlePointerMove);
  useEffect(() => {
    handlePointerMoveRef.current = handlePointerMove;
  }, [handlePointerMove]);

  const handleMapClickRef = useRef(handleMapClick);
  useEffect(() => {
    handleMapClickRef.current = handleMapClick;
  }, [handleMapClick]);

  const loadWorldMapData = useCallback(async () => {
    if (!selectedWorldMap || mapMode !== 'world') return;

    setLoading(true);
    try {
      const view = mapInstanceRef.current?.getView();
      if (!view) return;

      const extent = view.calculateExtent();
      const bounds = mapDataLoader.getBoundsFromExtent(extent);

      const zoom = view.getZoom() || 0;
      const dataTypes = mapDataLoader.getDataTypesForZoom(zoom);

      // Load real data from PostGIS
      const promises: Promise<Feature[]>[] = [];

      if (dataTypes.includes('burgs') && layerVisibility.burgs) {
        promises.push(mapDataLoader.loadBurgs(selectedWorldMap, bounds));
      }
      if (dataTypes.includes('routes') && layerVisibility.routes) {
        promises.push(mapDataLoader.loadRoutes(selectedWorldMap, bounds));
      }
      if (dataTypes.includes('rivers') && layerVisibility.rivers) {
        promises.push(mapDataLoader.loadRivers(selectedWorldMap, bounds));
      }
      if (dataTypes.includes('cells') && layerVisibility.cells) {
        promises.push(mapDataLoader.loadCells(selectedWorldMap, bounds));
      }
      if (dataTypes.includes('markers') && layerVisibility.markers) {
        promises.push(mapDataLoader.loadMarkers(selectedWorldMap, bounds));
      }

      const results = await Promise.all(promises);

      // Update layers with real data
      let index = 0;
      if (dataTypes.includes('burgs') && layerVisibility.burgs) {
        burgsLayerRef.current?.getSource()?.clear();
        burgsLayerRef.current?.getSource()?.addFeatures(results[index++] || []);
      }
      if (dataTypes.includes('routes') && layerVisibility.routes) {
        routesLayerRef.current?.getSource()?.clear();
        routesLayerRef.current?.getSource()?.addFeatures(results[index++] || []);
      }
      if (dataTypes.includes('rivers') && layerVisibility.rivers) {
        riversLayerRef.current?.getSource()?.clear();
        riversLayerRef.current?.getSource()?.addFeatures(results[index++] || []);
      }
      if (dataTypes.includes('cells') && layerVisibility.cells) {
        cellsLayerRef.current?.getSource()?.clear();
        cellsLayerRef.current?.getSource()?.addFeatures(results[index++] || []);
      }
      if (dataTypes.includes('markers') && layerVisibility.markers) {
        markersLayerRef.current?.getSource()?.clear();
        markersLayerRef.current?.getSource()?.addFeatures(results[index++] || []);
      }

    } catch (error) {
      console.error('Error loading world map data:', error);
      throw error;
    } finally {
      setLoading(false);
    }
  }, [selectedWorldMap, layerVisibility, mapMode]);

  const handleMapMoveEnd = useCallback(() => {
    if (mapMode === 'world') {
      loadWorldMapData();
    }
  }, [loadWorldMapData, mapMode]);

  const handleMapMoveEndRef = useRef(handleMapMoveEnd);
  useEffect(() => {
    handleMapMoveEndRef.current = handleMapMoveEnd;
  }, [handleMapMoveEnd]);

  useEffect(() => {
    if (!mapRef.current || mapInstanceRef.current) return;

    const initialVisibility = layerVisibilityRef.current;
    const initialMode = mapModeRef.current;

    // Base tile layer; source assigned after database tile sets load
    const baseLayer = new TileLayer({
      preload: 2
    });
    baseLayerRef.current = baseLayer;

    // Vector layers for different data types
    const burgsLayer = new VectorLayer({
      source: new VectorSource({ wrapX: false }),
      style: (feature, resolution) => getBurgStyleRef.current(feature, resolution),
      visible: initialVisibility.burgs
    });
    burgsLayerRef.current = burgsLayer;

    const routesLayer = new VectorLayer({
      source: new VectorSource({ wrapX: false }),
      style: (feature, resolution) => getRouteStyleRef.current(feature, resolution),
      visible: initialVisibility.routes
    });
    routesLayerRef.current = routesLayer;

    const riversLayer = new VectorLayer({
      source: new VectorSource({ wrapX: false }),
      style: getRiverStyle,
      visible: initialVisibility.rivers
    });
    riversLayerRef.current = riversLayer;

    const cellsLayer = new VectorLayer({
      source: new VectorSource({ wrapX: false }),
      style: getCellStyle,
      visible: initialVisibility.cells
    });
    cellsLayerRef.current = cellsLayer;

    const markersLayer = new VectorLayer({
      source: new VectorSource({ wrapX: false }),
      style: (feature, resolution) => getMarkerStyleRef.current(feature, resolution),
      visible: initialVisibility.markers
    });
    markersLayerRef.current = markersLayer;

    const campaignLayer = new VectorLayer({
      source: new VectorSource({ wrapX: false }),
      style: (feature, resolution) => getCampaignLocationStyleRef.current(feature, resolution),
      visible: initialVisibility.campaignLocations
    });
    campaignLayerRef.current = campaignLayer;

    const playerTrailLayer = new VectorLayer({
      source: new VectorSource({ wrapX: false }),
      style: getPlayerTrailStyle,
      visible: initialVisibility.playerTrails
    });
    playerTrailLayerRef.current = playerTrailLayer;

    const playerLayer = new VectorLayer({
      source: new VectorSource({ wrapX: false }),
      style: (feature, resolution) => getPlayerTokenStyleRef.current(feature, resolution),
      visible: initialVisibility.playerTokens
    });
    playerLayerRef.current = playerLayer;

    const encounterLayer = new VectorLayer({
      source: new VectorSource({ wrapX: false }),
      style: getEncounterStyle,
      visible: initialMode === 'encounter'
    });
    encounterLayerRef.current = encounterLayer;

    // Create popup overlay
    const overlay = new Overlay({
      element: popupRef.current!,
      autoPan: {
        animation: {
          duration: 250,
        },
      },
    });
    overlayRef.current = overlay;

    // Create map
    const map = new Map({
      target: mapRef.current,
      layers: [
        baseLayer,
        cellsLayer,      // Bottom layer
        riversLayer,
        routesLayer,
        burgsLayer,
        markersLayer,
        campaignLayer,
        playerTrailLayer,
        playerLayer,
        encounterLayer,
      ],
      overlays: [overlay],
      view: new View({
        projection: questablesProjection,
        center: [
          (DEFAULT_PIXEL_EXTENT[0] + DEFAULT_PIXEL_EXTENT[2]) / 2,
          (DEFAULT_PIXEL_EXTENT[1] + DEFAULT_PIXEL_EXTENT[3]) / 2
        ],
        zoom: 2,
        minZoom: 0,
        maxZoom: 20,
        enableRotation: false,
        extent: DEFAULT_PIXEL_EXTENT,
        constrainOnlyCenter: true
      }),
      controls: defaultControls({
        zoom: false,
        attribution: true
      })
    });

    mapInstanceRef.current = map;
    applyTileSetConstraintsRef.current?.(null);

    if (process.env.NODE_ENV === 'test') {
      const globalObject = globalThis as Record<string, unknown>;
      const currentCount = typeof globalObject.__questablesMapInitCount === 'number'
        ? globalObject.__questablesMapInitCount
        : 0;
      globalObject.__questablesMapInitCount = currentCount + 1;
    }

    // Event handlers
    const view = map.getView();
    const mapClickListener = (event: any) => {
      const handler = handleMapClickRef.current;
      if (handler) handler(event);
    };
    const mapMoveEndListener = () => {
      const handler = handleMapMoveEndRef.current;
      if (handler) handler();
    };
    const pointerMoveListener = (event: any) => {
      const handler = handlePointerMoveRef.current;
      if (handler) handler(event);
    };
    const zoomChangeListener = () => {
      const handler = handleZoomChangeRef.current;
      if (handler) handler();
    };

    map.on('click', mapClickListener);
    map.on('moveend', mapMoveEndListener);
    map.on('pointermove', pointerMoveListener);
    view.on('change:resolution', zoomChangeListener);

    // Load initial data
    loadInitialDataRef.current?.();

    return () => {
      map.un('click', mapClickListener);
      map.un('moveend', mapMoveEndListener);
      map.un('pointermove', pointerMoveListener);
      view.un('change:resolution', zoomChangeListener);
      map.dispose();
      mapInstanceRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (tileSets.length === 0) {
      if (selectedTileSetId) {
        setSelectedTileSetId('');
      }
      return;
    }

    if (!tileSets.some((ts) => ts.id === selectedTileSetId)) {
      setSelectedTileSetId(tileSets[0].id);
    }
  }, [tileSets, selectedTileSetId]);

  useEffect(() => {
    const activeTileSet = tileSets.find(ts => ts.id === selectedTileSetId) ?? null;
    applyTileSetConstraints(activeTileSet);
  }, [selectedTileSetId, tileSets, applyTileSetConstraints]);

  // Update tile source when world map or tileset changes
  useEffect(() => {
    if (!selectedWorldMap || worldMaps.length === 0) return;

    const activeTileSet = tileSets.find(ts => ts.id === selectedTileSetId) ?? null;
    updateTileSource(activeTileSet);
  }, [selectedWorldMap, worldMaps, updateTileSource, selectedTileSetId, tileSets]);

  // Handle map mode changes
  useEffect(() => {
    if (!mapInstanceRef.current) return;

    const worldLayers = [
      burgsLayerRef.current,
      routesLayerRef.current,
      riversLayerRef.current,
      cellsLayerRef.current,
      markersLayerRef.current,
      campaignLayerRef.current
    ];

    const encounterLayer = encounterLayerRef.current;

    worldLayers.forEach(layer => {
      if (layer) layer.setVisible(mapMode === 'world');
    });

    if (encounterLayer) {
      encounterLayer.setVisible(mapMode === 'encounter');
    }

    if (mapMode === 'encounter') {
      const view = mapInstanceRef.current?.getView();
      if (view) {
        const maxZoom = view.getMaxZoom();
        view.setZoom(Math.min(15, typeof maxZoom === 'number' ? maxZoom : 15));
      }
      loadEncounterData();
    } else {
      loadWorldMapData();
      if (activeCampaignId) {
        void loadVisiblePlayers(activeCampaignId);
      }
    }
  }, [activeCampaignId, loadVisiblePlayers, loadWorldMapData, mapMode]);

  useEffect(() => {
    if (!activeCampaignId) {
      setPlayerTokens([]);
      rosterByCharacterRef.current.clear();
      rosterByPlayerRef.current.clear();
      rosterLoadedForCampaignRef.current = null;
      return;
    }

    void loadCampaignRoster(activeCampaignId).then(() => loadVisiblePlayers(activeCampaignId));
  }, [activeCampaignId, loadCampaignRoster, loadVisiblePlayers]);

  // Handle layer visibility changes
  useEffect(() => {
    burgsLayerRef.current?.setVisible(layerVisibility.burgs && mapMode === 'world');
    routesLayerRef.current?.setVisible(layerVisibility.routes && mapMode === 'world');
    riversLayerRef.current?.setVisible(layerVisibility.rivers && mapMode === 'world');
    cellsLayerRef.current?.setVisible(layerVisibility.cells && mapMode === 'world');
    markersLayerRef.current?.setVisible(layerVisibility.markers && mapMode === 'world');
    campaignLayerRef.current?.setVisible(layerVisibility.campaignLocations && mapMode === 'world');
    playerTrailLayerRef.current?.setVisible(layerVisibility.playerTrails && mapMode === 'world');
    playerLayerRef.current?.setVisible(layerVisibility.playerTokens && mapMode === 'world');
  }, [layerVisibility, mapMode]);



  useEffect(() => {
    if (mapMode === 'world') {
      loadWorldMapData();
    }
  }, [layerVisibility, mapMode, loadWorldMapData]);

  useEffect(() => {
    const handleResize = () => {
      if (currentWorldBoundsRef.current) {
        updateViewExtent(currentWorldBoundsRef.current);
      }
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [updateViewExtent]);

  useEffect(() => {
    if (selectedTool !== 'info') {
      overlayRef.current?.setPosition(undefined);
      setPopupContent(null);
      hoveredFeatureIdRef.current = null;
    }
  }, [selectedTool]);

  useEffect(() => {
    if (selectedTool !== 'move') {
      clearMovementSelection();
    }
  }, [clearMovementSelection, selectedTool]);

  // Load encounter data
  const loadEncounterData = useCallback(async () => {
    if (!encounterLayerRef.current) return;

    // For encounter mode, you would load tactical battle map data
    // This is a placeholder - in real implementation, load from campaign encounter data
    const source = encounterLayerRef.current.getSource();
    if (source) {
      source.clear();
      // Add encounter-specific features here
    }
  }, []);

  // Update player layer with live tokens
  useEffect(() => {
    if (!playerLayerRef.current) return;
    const source = playerLayerRef.current.getSource();
    if (!source) return;

    const features = playerTokens.map((token) => {
      const feature = new Feature({
        geometry: new Point(token.coordinates),
        id: token.playerId,
      });
      feature.set('type', 'player');
      feature.set('playerId', token.playerId);
      feature.set('data', token);
      return feature;
    });

    source.clear();
    if (features.length > 0) {
      source.addFeatures(features);
    }
  }, [playerTokens]);

  useEffect(() => {
    if (!selectedPlayerId) return;
    const stillVisible = playerTokens.some((token) => token.playerId === selectedPlayerId);
    if (!stillVisible) {
      clearMovementSelection();
    }
  }, [clearMovementSelection, playerTokens, selectedPlayerId]);

  useEffect(() => {
    const visibleIds = new Set(playerTokens.map((token) => token.playerId));
    setTrailSelections((prev) => {
      const next: Record<string, boolean> = {};
      Object.entries(prev).forEach(([playerId, enabled]) => {
        if (visibleIds.has(playerId)) {
          next[playerId] = enabled;
        } else if (enabled) {
          removeTrailFeature(playerId);
        }
      });
      return next;
    });
  }, [playerTokens, removeTrailFeature]);

  useEffect(() => {
    if (!movementDialog || availableMoveModes.length === 0) {
      return;
    }
    setMoveMode((prev) => (
      availableMoveModes.includes(prev as typeof MOVE_MODES[number])
        ? prev
        : availableMoveModes[0]
    ));
  }, [availableMoveModes, movementDialog]);

  useEffect(() => {
    if (!socketMessages.length || !activeCampaignId) {
      return;
    }

    const movementEvents = getMessagesByType('player-moved');
    const teleportEvents = getMessagesByType('player-teleported');
    const spawnEvents = getMessagesByType('spawn-updated');
    const spawnDeleted = getMessagesByType('spawn-deleted');

    if (movementEvents.length || teleportEvents.length || spawnEvents.length || spawnDeleted.length) {
      void loadVisiblePlayers(activeCampaignId);
      const affectedPlayerIds = new Set<string>();
      [...movementEvents, ...teleportEvents].forEach((event) => {
        const playerId = event?.data?.playerId ?? event?.data?.player_id;
        if (typeof playerId === 'string') {
          affectedPlayerIds.add(playerId);
        }
      });

      affectedPlayerIds.forEach((playerId) => {
        if (trailSelections[playerId]) {
          void refreshTrailForPlayer(playerId);
        }
      });
    }

    clearSocketMessages();
  }, [activeCampaignId, clearSocketMessages, getMessagesByType, loadVisiblePlayers, refreshTrailForPlayer, socketMessages, trailSelections]);

  useEffect(() => {
    const previous = wasSocketConnectedRef.current;

    if (socketConnected) {
      if ((previous === false || refreshOnReconnectRef.current) && activeCampaignId) {
        void loadVisiblePlayers(activeCampaignId);
        Object.entries(trailSelections).forEach(([playerId, enabled]) => {
          if (enabled) {
            void refreshTrailForPlayer(playerId);
          }
        });
      }
      refreshOnReconnectRef.current = false;
    } else if (previous) {
      refreshOnReconnectRef.current = true;
    }

    wasSocketConnectedRef.current = socketConnected;
  }, [
    socketConnected,
    activeCampaignId,
    loadVisiblePlayers,
    refreshTrailForPlayer,
    trailSelections
  ]);

  // Zoom functions
  const zoomIn = () => {
    const view = mapInstanceRef.current?.getView();
    if (view) {
      view.animate({ zoom: (view.getZoom() || 0) + 1, duration: 250 });
    }
  };

  const zoomOut = () => {
    const view = mapInstanceRef.current?.getView();
    if (view) {
      const current = view.getZoom() || 0;
      const minZoom = enforcedMinZoomRef.current || tileSetMinZoomRef.current;
      const nextZoom = current - 1;
      view.animate({ zoom: nextZoom < minZoom ? minZoom : nextZoom, duration: 250 });
    }
  };

  // Change tile set
  const changeTileSet = (tileSetId: string) => {
    const tileSet = tileSets.find(ts => ts.id === tileSetId) ?? null;
    if (!tileSet) {
      setSelectedTileSetId('');
      updateTileSource(null);
      return;
    }

    setSelectedTileSetId(tileSetId);
    updateTileSource(tileSet);
  };

  const tools: Array<{ id: 'move' | 'measure' | 'info'; name: string; icon: ReactNode }> = [
    { id: 'move', name: 'Move Token', icon: <Move className="w-4 h-4" /> },
    { id: 'measure', name: 'Measure', icon: <Navigation className="w-4 h-4" /> },
    { id: 'info', name: 'Info', icon: <Info className="w-4 h-4" /> }
  ];

  const popupTypeLabel = popupContent
    ? formatTypeLabel(popupContent.featureType ?? popupContent.feature?.get('type'))
    : 'Feature';

  return (
    <Card className="h-full rounded-none border-0 border-r">
      <CardHeader className="pb-3">
        <div className="flex justify-between items-center">
          <CardTitle className="flex items-center gap-2">
            {mapMode === 'world' ? <Globe className="w-5 h-5" /> : <Crosshair className="w-5 h-5" />}
            {mapMode === 'world' ? 'World Map' : 'Encounter Map'}
            {loading && <Badge variant="secondary" className="ml-2">Loading...</Badge>}
          </CardTitle>

          <div className="flex items-center gap-2">
            {/* Map Mode Toggle */}
            <Tabs value={mapMode} onValueChange={(value) => setMapMode(value as 'world' | 'encounter')}>
              <TabsList className="h-8">
                <TabsTrigger value="world" className="h-6 px-2 text-xs">
                  <Globe className="w-3 h-3 mr-1" />
                  World
                </TabsTrigger>
                <TabsTrigger value="encounter" className="h-6 px-2 text-xs">
                  <Crosshair className="w-3 h-3 mr-1" />
                  Encounter
                </TabsTrigger>
              </TabsList>
            </Tabs>

            {/* World Map Selector */}
            {mapMode === 'world' && (
              <Select value={selectedWorldMap} onValueChange={setSelectedWorldMap}>
                <SelectTrigger className="h-8 w-32">
                  <SelectValue placeholder="Select Map" />
                </SelectTrigger>
                <SelectContent>
                  {worldMaps.map(map => (
                    <SelectItem key={map.id} value={map.id}>
                      {map.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}

            {/* Tile Set Selector */}
            {mapMode === 'world' && (
              tileSets.length > 0 ? (
                <Select value={selectedTileSetId} onValueChange={changeTileSet}>
                  <SelectTrigger className="h-8 w-36">
                    <SelectValue placeholder="Select Tiles" />
                  </SelectTrigger>
                  <SelectContent>
                    {tileSets.map((tileSet) => (
                      <SelectItem key={tileSet.id} value={tileSet.id}>
                        {tileSet.name || tileSet.id}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Button variant="outline" size="sm" className="h-8 w-36" disabled>
                  No tilesets
                </Button>
              )
            )}

            {/* Tools */}
            <div className="flex items-center gap-1 border-l pl-2">
              {tools.map((tool) => (
                <Button
                  key={tool.id}
                  variant={selectedTool === tool.id ? "default" : "outline"}
                  size="sm"
                  onClick={() => setSelectedTool(tool.id as any)}
                  className="h-8 px-2"
                  title={tool.name}
                >
                  {tool.icon}
                </Button>
              ))}
            </div>

            {/* Zoom Controls */}
            <div className="flex items-center gap-1 border-l pl-2">
              <Button
                variant="outline"
                size="sm"
                onClick={zoomOut}
                className="h-8 px-2"
              >
                <ZoomOut className="w-3 h-3" />
              </Button>
              <span className="text-xs font-medium w-8 text-center">{currentZoom}</span>
              <Button
                variant="outline"
                size="sm"
                onClick={zoomIn}
                className="h-8 px-2"
              >
                <ZoomIn className="w-3 h-3" />
              </Button>
            </div>
          </div>
        </div>
      </CardHeader>

      <CardContent className="p-0 relative">
        <div
          ref={mapRef}
          className="w-full bg-blue-50"
          style={{ height: 'calc(100vh - 200px)' }}
        />

        {/* Popup */}
        <div ref={popupRef} className="ol-popup">
          {popupContent && (
            <Card className="min-w-64">
              <CardHeader className="pb-2">
                <div className="flex justify-between items-start">
                  <CardTitle className="text-sm">
                    {popupContent.title || popupContent.feature?.get('name') || 'Feature'}
                  </CardTitle>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      overlayRef.current?.setPosition(undefined);
                      setPopupContent(null);
                    }}
                    className="h-6 w-6 p-0"
                  >
                    ×
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="text-xs space-y-2">
                  <div className="text-muted-foreground">Type: {popupTypeLabel}</div>
                  {popupContent.rows ? (
                    <div className="space-y-2">
                      {popupContent.rows.map((row) => (
                        <div key={row.label} className="flex flex-col gap-1">
                          <span className="font-semibold text-foreground">{row.label}</span>
                          <span className="whitespace-pre-wrap break-words text-foreground">
                            {row.value}
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : popupContent.data ? (
                    <div>
                      <pre className="whitespace-pre-wrap break-words">
                        {JSON.stringify(popupContent.data, null, 2)}
                      </pre>
                    </div>
                  ) : null}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </CardContent>
      {mapMode === 'world' && (
        <div className="border-t bg-muted/20 px-4 py-3 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold text-foreground">
                Visible Players ({sortedPlayerTokens.length})
              </h3>
              {playerLoading && <Badge variant="secondary">Refreshing...</Badge>}
            </div>
            <div className="flex items-center gap-2">
              {playerError && (
                <Badge variant="destructive" className="text-xs">{playerError}</Badge>
              )}
              {activeCampaignId && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs"
                  onClick={() => void loadVisiblePlayers(activeCampaignId)}
                >
                  Refresh
                </Button>
              )}
            </div>
          </div>

          <div className="space-y-2">
            {sortedPlayerTokens.length === 0 && !playerLoading ? (
              <p className="text-xs text-muted-foreground">
                No player tokens are currently visible.
              </p>
            ) : null}

            {sortedPlayerTokens.map((token) => {
              const hp = token.hitPoints;
              const hpLabel = hp ? `${hp.current}/${hp.max}` : '—';
              const hpPercent = hp && hp.max > 0 ? Math.round((hp.current / hp.max) * 100) : null;
              const conditionsLabel = token.conditions.length
                ? token.conditions.slice(0, 3).join(', ')
                : 'No conditions';
              const trailEnabled = trailSelections[token.playerId] ?? false;

              return (
                <div
                  key={token.playerId}
                  className="flex flex-col gap-2 rounded-md border bg-background/60 p-3 shadow-sm sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="flex items-start gap-3">
                    <Avatar className="h-9 w-9 border">
                      {token.avatarUrl ? (
                        <AvatarImage src={token.avatarUrl} alt={token.name} />
                      ) : null}
                      <AvatarFallback>{token.initials}</AvatarFallback>
                    </Avatar>
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-foreground">{token.name}</span>
                        <Badge variant="outline" className="text-[10px] uppercase tracking-wide">
                          {token.role}
                        </Badge>
                        {token.visibilityState !== 'visible' && (
                          <Badge variant="secondary" className="text-[10px] uppercase tracking-wide">
                            {token.visibilityState}
                          </Badge>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground space-x-3">
                        <span>HP: {hpLabel}{hpPercent !== null ? ` (${hpPercent}%)` : ''}</span>
                        <span>Conditions: {conditionsLabel}</span>
                        {token.lastLocatedAt && (
                          <span>Updated: {new Date(token.lastLocatedAt).toLocaleTimeString()}</span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <div className="flex items-center gap-2">
                      <Switch
                        checked={trailEnabled}
                        onCheckedChange={(checked) => {
                          if (checked === 'indeterminate') return;
                          void handleTrailToggle(token, checked === true);
                        }}
                        disabled={!token.canViewHistory && !canControlPlayer(token)}
                      />
                      <span className="text-xs text-muted-foreground">Trail</span>
                    </div>
                    {trailErrors[token.playerId] && (
                      <span className="text-[11px] text-destructive">
                        {trailErrors[token.playerId]}
                      </span>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7"
                      onClick={() => focusOnPlayer(token)}
                    >
                      Focus
                    </Button>
                    {canControlPlayer(token) && (
                      <Button
                        variant={selectedPlayerId === token.playerId ? 'default' : 'outline'}
                        size="sm"
                        className="h-7"
                        onClick={() => {
                          setSelectedTool('move');
                          selectPlayerForMovement(token);
                        }}
                      >
                        Move
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Map Controls Panel */}
      <div className="border-t p-3 bg-muted/30">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4 text-xs text-muted-foreground">
            <span>Zoom: {currentZoom}</span>
            <span>Players: {playerTokens.length}</span>
            <span>Mode: {mapMode === 'world' ? 'Exploration' : 'Tactical'}</span>
          </div>
          <div className="flex gap-1">
            {mapMode === 'world' && (
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2 text-xs"
                  >
                    <Layers className="w-3 h-3 mr-1" />
                    Layers
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="end" className="w-52 p-3">
                  <div className="flex flex-col gap-1 text-xs">
                    {TOGGLEABLE_LAYER_OPTIONS.map((option) => (
                      <div
                        key={option.key}
                        role="button"
                        tabIndex={0}
                        className="flex items-center justify-between gap-2 rounded-md px-2 py-2 transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        onClick={() => toggleLayer(option.key)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            toggleLayer(option.key);
                          }
                        }}
                      >
                        <span className="flex items-center gap-2 font-medium text-foreground">
                          {option.icon}
                          {option.label}
                        </span>
                        <Checkbox
                          checked={layerVisibility[option.key]}
                          onCheckedChange={(checked) => {
                            if (checked === 'indeterminate') return;
                            toggleLayer(option.key, checked === true);
                          }}
                          onClick={(event) => event.stopPropagation()}
                        />
                      </div>
                    ))}
                  </div>
                </PopoverContent>
              </Popover>
            )}
            <Button variant="ghost" size="sm" className="h-6 px-2 text-xs">
              <Search className="w-3 h-3 mr-1" />
              Search
            </Button>
          </div>
      </div>
    </div>
      <Dialog
        open={Boolean(movementDialog)}
        onOpenChange={(open) => {
          if (!open) {
            setMovementDialog(null);
            clearMovementSelection();
          }
        }}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Confirm Movement</DialogTitle>
            <DialogDescription>
              Approve the new destination for this player token.
            </DialogDescription>
          </DialogHeader>
          {movementDialog ? (
            <div className="space-y-4 text-sm">
              <div className="text-muted-foreground">
                Moving <span className="font-semibold text-foreground">{movementDialog.playerName}</span>
              </div>
              <div className="grid gap-2">
                <div className="flex justify-between">
                  <span>Current position</span>
                  <span>
                    {movementDialog.currentPosition[0].toFixed(2)}, {movementDialog.currentPosition[1].toFixed(2)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Target position</span>
                  <span>
                    {movementDialog.coordinate[0].toFixed(2)}, {movementDialog.coordinate[1].toFixed(2)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Distance</span>
                  <span>{movementDistance.toFixed(2)} units (SRID-0)</span>
                </div>
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium text-foreground">Movement mode</label>
                <Select value={moveMode} onValueChange={setMoveMode}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select mode" />
                  </SelectTrigger>
                  <SelectContent>
                    {availableMoveModes.map((mode) => (
                      <SelectItem key={mode} value={mode}>
                        {mode.charAt(0).toUpperCase() + mode.slice(1)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          ) : null}
          <DialogFooter className="flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setMovementDialog(null);
                clearMovementSelection();
              }}
            >
              Cancel
            </Button>
            <Button onClick={handleConfirmMove} disabled={!movementDialog}>
              Move token
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function getRiverStyle(feature: Feature) {
  const data = feature.get('data');
  return new Style({
    stroke: new Stroke({
      color: '#4FC3F7',
      width: Math.max(2, (data?.width || 1) * 2)
    })
  });
}

function getCellStyle(feature: Feature) {
  const data = feature.get('data');
  return new Style({
    fill: new Fill({
      color: getBiomeColor(data?.biome)
    }),
    stroke: new Stroke({
      color: 'rgba(0,0,0,0.1)',
      width: 0.5
    })
  });
}

function getEncounterStyle(): Style {
  return new Style({
    fill: new Fill({ color: 'rgba(128,128,128,0.7)' }),
    stroke: new Stroke({ color: '#666', width: 2 })
  });
}

function getBiomeColor(biome: number): string {
  switch (biome) {
    case 1: return 'rgba(34,139,34,0.3)';
    case 2: return 'rgba(218,165,32,0.3)';
    case 3: return 'rgba(70,130,180,0.3)';
    case 4: return 'rgba(128,128,128,0.3)';
    default: return 'rgba(144,238,144,0.3)';
  }
}

function getPlayerTrailStyle(): Style {
  const color = '#f97316';
  return new Style({
    stroke: new Stroke({
      color,
      width: 3,
      lineDash: [6, 6],
      lineCap: 'round',
      lineJoin: 'round',
    })
  });
}
