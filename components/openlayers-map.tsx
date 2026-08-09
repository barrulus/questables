import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import type { ReactNode } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Button } from "./ui/button";
// Tabs removed — settlement mode is entered via burg popup, not a tab
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { Badge } from "./ui/badge";
import { Popover, PopoverTrigger, PopoverContent } from "./ui/popover";
import { Checkbox } from "./ui/checkbox";
import { MapPlayerMovementDialog, type MoveMode } from "./map-player-movement-dialog";
import { MapVisiblePlayersPanel, type PlayerToken } from "./map-visible-players-panel";
import {
  MapPin,
  ZoomIn,
  ZoomOut,
  Move,
  Flag,
  Users,
  Crown,
  Globe,
  Layers,
  Navigation,
  Info,
  Search,
  Building2,
  ArrowLeft,
  Landmark,
  Map as MapIcon,
  Palette,
  Church,
  TriangleAlert,
  Swords,
} from "lucide-react";

// OpenLayers imports
import OLMap from 'ol/Map';
import View from 'ol/View';
import TileLayer from 'ol/layer/Tile';
import VectorLayer from 'ol/layer/Vector';
import VectorSource from 'ol/source/Vector';
import Feature from 'ol/Feature';
import type { FeatureLike } from 'ol/Feature';
import Point from 'ol/geom/Point';
import LineString from 'ol/geom/LineString';
import type Geometry from 'ol/geom/Geometry';
import GeoJSON from 'ol/format/GeoJSON';
import type { GeoJSONFeature } from 'ol/format/GeoJSON';
import { Style, Fill, Icon, Stroke, Circle as CircleStyle, Text } from 'ol/style';
import 'ol/ol.css';
import { defaults as defaultControls } from 'ol/control';
import { Overlay } from 'ol';
import type MapBrowserEvent from 'ol/MapBrowserEvent';
import { mapDataLoader, type WorldMapBounds } from './map-data-loader';
import { DEFAULT_PIXEL_EXTENT, questablesProjection, updateProjectionExtent, PIXEL_PROJECTION_CODE } from './map-projection';
import {
  LABEL_VISIBILITY,
  createBurgStyleFactory,
  createBurgEntranceStyleFactory,
  createMarkerStyleFactory,
  createRouteStyleFactory,
  getRiverStyle,
  getCellStyle,
} from './maps/questables-style-factory';
import {
  createStatesLayer,
  createProvincesLayer,
  createCulturesLayer,
  createReligionsLayer,
  createZonesLayer,
  createRegimentsLayer,
} from './layers';
import { createQuestablesTileSource, type TileSetConfig } from './maps/questables-tile-source';
import { createSettlementTileSource } from './maps/settlement-tile-source';
import { buildHoverTooltipInfo, getFeatureTypeFromProperties } from './maps/feature-tooltip';
import { useGameSession } from "../contexts/GameSessionContext";
import { useUser } from "../contexts/UserContext";
import { useWebSocket, useWsEvent } from "../contexts/WebSocketContext";
import { useVisiblePlayers } from "../hooks/useVisiblePlayers";
import { apiFetch, fetchJson, getApiBaseUrl, readErrorMessage, readJsonBody } from "../utils/api-client";
import { toast } from "sonner";
import { TokenAnimator, type Waypoint } from './player-token-animator';

const ANIMATION_DURATION_MS = 2500;

// PlayerToken type imported from map-visible-players-panel

interface PlayerTrailMeta {
  feature: TrailFeature;
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

interface CampaignRosterEntry {
  characterId: string;
  name: string;
  avatarUrl: string | null;
  userId: string;
  role: string;
  status: string;
  visibilityState: PlayerToken['visibilityState'];
  hitPoints: { current: number; max: number; temporary: number };
  conditions: string[];
  lastLocatedAt: string | null;
}

interface WorldMapSummary {
  id: string;
  name: string;
  bounds: WorldMapBounds;
  width_pixels?: number | null;
  height_pixels?: number | null;
  meters_per_pixel?: number | null;
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
  burgEntrances: boolean;
  routes: boolean;
  rivers: boolean;
  cells: boolean;
  markers: boolean;
  campaignLocations: boolean;
  playerTokens: boolean;
  playerTrails: boolean;
  states: boolean;
  provinces: boolean;
  cultures: boolean;
  religions: boolean;
  zones: boolean;
  regiments: boolean;
}

/** Layers backed by the world-wide (non bounds-scoped) FMG full-JSON endpoints. */
type PolityLayerKey = 'states' | 'provinces' | 'cultures' | 'religions' | 'zones' | 'regiments';

const POLITY_LAYER_KEYS: PolityLayerKey[] = [
  'states',
  'provinces',
  'cultures',
  'religions',
  'zones',
  'regiments',
];

const isPolityLayerKey = (key: keyof LayerVisibility): key is PolityLayerKey =>
  (POLITY_LAYER_KEYS as string[]).includes(key);

const INTERACTIVE_FEATURE_TYPES = new Set(['burg', 'marker', 'player']);
const MOVE_PROMPT_TOAST_ID = 'player-move-selection';
const MOVE_MODES = ['walk', 'ride', 'boat', 'fly', 'teleport', 'gm'] as const;
const TRAIL_CACHE_TTL_MS = 60_000;
const GATE_PULSE_DURATION_MS = 1000;
const GATE_PULSE_ICON_DATA_URI =
  `data:image/svg+xml;utf8,` +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="-8 -8 16 16">` +
    `<polygon points="0,-6 5,5 -5,5" fill="#ffdc73" stroke="#000" stroke-width="1"/>` +
    `</svg>`,
  );

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const extractPlayerId = (event: unknown): string | null => {
  if (!isPlainObject(event)) {
    return null;
  }

  const data = isPlainObject(event.data) ? event.data : null;
  if (!data) {
    return null;
  }

  const candidate = data.playerId ?? data.player_id;
  return typeof candidate === 'string' && candidate.trim().length > 0 ? candidate : null;
};

type GeometryFeature = Feature<Geometry>;
type GeometrySource = VectorSource<GeometryFeature>;
type GeometryLayer = VectorLayer<GeometrySource>;
type TrailFeature = Feature<LineString>;
type TrailSource = VectorSource<TrailFeature>;
type TrailLayer = VectorLayer<TrailSource>;

const asGeometryFeature = (feature: FeatureLike): GeometryFeature => feature as GeometryFeature;

const formatTypeLabel = (type: unknown): string => {
  if (typeof type !== 'string' || type.length === 0) {
    return 'Feature';
  }
  const cleaned = type.replace(/_/g, ' ');
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
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
  { key: 'states', label: 'States', icon: <Landmark className="w-3 h-3" /> },
  { key: 'provinces', label: 'Provinces', icon: <MapIcon className="w-3 h-3" /> },
  { key: 'cultures', label: 'Cultures', icon: <Palette className="w-3 h-3" /> },
  { key: 'religions', label: 'Religions', icon: <Church className="w-3 h-3" /> },
  { key: 'zones', label: 'Zones', icon: <TriangleAlert className="w-3 h-3" /> },
  { key: 'regiments', label: 'Regiments', icon: <Swords className="w-3 h-3" /> },
];

const normalizeTileSetRows = (rows: Record<string, unknown>[]): TileSetConfig[] =>
  (rows || [])
    .filter((ts) => ts && ts.id && typeof ts.base_url === 'string')
    .map((ts) => ({
      id: String(ts.id),
      name: typeof ts.name === 'string' && ts.name.trim() ? ts.name : String(ts.id),
      base_url: String(ts.base_url),
      attribution: typeof ts.attribution === 'string' ? ts.attribution : undefined,
      min_zoom: typeof ts.min_zoom === 'number' && Number.isFinite(ts.min_zoom) ? ts.min_zoom : undefined,
      max_zoom: typeof ts.max_zoom === 'number' && Number.isFinite(ts.max_zoom) ? ts.max_zoom : undefined,
      tile_size: typeof ts.tile_size === 'number' && Number.isFinite(ts.tile_size) ? ts.tile_size : undefined,
      wrapX: Boolean(ts.wrapX),
    }));

export function OpenLayersMap() {
  const mapRef = useRef<HTMLDivElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<OLMap | null>(null);
  const overlayRef = useRef<Overlay | null>(null);
  const tileSetMinZoomRef = useRef<number>(0);
  const enforcedMinZoomRef = useRef<number>(0);
  const currentWorldBoundsRef = useRef<WorldMapBounds | null>(null);
  const currentZoomRef = useRef<number>(0);
  const hoveredFeatureIdRef = useRef<string | null>(null);
  const popupPinnedRef = useRef(false);

  // State
  const [mapMode, setMapMode] = useState<'world' | 'settlement'>('world');
  const [settlementInfo, setSettlementInfo] = useState<{
    burgId: string;
    name: string;
    population: number;
    maxZoom: number;
    localBounds: { min_x: number; min_y: number; max_x: number; max_y: number } | null;
    svgViewBox: { x: number; y: number; width: number; height: number } | null;
  } | null>(null);
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
  const [moveMode, setMoveMode] = useState<MoveMode>('walk');
  const [selectedPlayerId, setSelectedPlayerId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [currentZoom, setCurrentZoom] = useState(0);
  const [layerVisibility, setLayerVisibility] = useState<LayerVisibility>({
    burgs: false,
    burgEntrances: true,
    routes: false,
    rivers: false,
    cells: false,
    markers: false,
    campaignLocations: true,
    playerTokens: true,
    playerTrails: false,
    states: true,
    provinces: false,
    cultures: false,
    religions: false,
    zones: false,
    regiments: false
  });
  const [popupContent, setPopupContent] = useState<PopupDetails | null>(null);
  const [hoverInfo, setHoverInfo] = useState<{
    title: string;
    subtitle: string | null;
    details: string[] | null;
    screenX: number;
    screenY: number;
  } | null>(null);

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
  const { connected: socketConnected } = useWebSocket();

  // Hook coexists with the inline loadVisiblePlayers below.
  // The hook owns a parallel fetch and exposes raw VisiblePlayer[] for downstream
  // consumers (SettlementMap / MapRoot in Tasks 11-12) that need insideBurgId.
  // The component's existing PlayerToken[] state (enriched with roster data) is
  // still populated by loadVisiblePlayers — no callsites are changed here.
  const { players: visiblePlayersFromHook, refresh: refreshVisiblePlayersHook } = useVisiblePlayers(
    activeCampaignId ?? null,
    typeof playerVisibilityRadius === 'number' ? playerVisibilityRadius : null,
  );
  // Suppress unused-var until Tasks 11-12 consume visiblePlayersFromHook / refreshVisiblePlayersHook.
  void visiblePlayersFromHook;
  void refreshVisiblePlayersHook;

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

  const availableMoveModes = useMemo<MoveMode[]>(
    () => (
      canTeleport
        ? [...MOVE_MODES]
        : MOVE_MODES.filter((mode): mode is MoveMode => mode !== 'teleport' && mode !== 'gm')
    ),
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
    popupPinnedRef.current = false;
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

  const addTrailFeature = useCallback((playerId: string, feature: TrailFeature) => {
    const layer = playerTrailLayerRef.current;
    if (!layer) return;
    const source = layer.getSource();
    if (!source) return;
    removeTrailFeature(playerId, { retainCache: true });
    feature.set('playerId', playerId);
    source.addFeature(feature);
    playerTrailCacheRef.current.set(playerId, {
      feature,
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

      const geoJsonFeature: GeoJSONFeature = {
        type: 'Feature',
        geometry: payload.geometry as unknown,
        properties: { playerId },
      };

      const rawFeature = geoJsonFormat.readFeature(geoJsonFeature) as GeometryFeature;
      const geometry = rawFeature.getGeometry();
      if (!(geometry instanceof LineString)) {
        return { success: false, hidden: false, message: 'Trail geometry is unsupported.' };
      }

      const feature = rawFeature as TrailFeature;
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
  const burgsLayerRef = useRef<GeometryLayer | null>(null);
  const burgEntrancesLayerRef = useRef<GeometryLayer | null>(null);
  const routesLayerRef = useRef<GeometryLayer | null>(null);
  const riversLayerRef = useRef<GeometryLayer | null>(null);
  const cellsLayerRef = useRef<GeometryLayer | null>(null);
  const markersLayerRef = useRef<GeometryLayer | null>(null);
  const campaignLayerRef = useRef<GeometryLayer | null>(null);
  const playerLayerRef = useRef<GeometryLayer | null>(null);
  const playerTrailLayerRef = useRef<TrailLayer | null>(null);
  const statesLayerRef = useRef<GeometryLayer | null>(null);
  const provincesLayerRef = useRef<GeometryLayer | null>(null);
  const culturesLayerRef = useRef<GeometryLayer | null>(null);
  const religionsLayerRef = useRef<GeometryLayer | null>(null);
  const zonesLayerRef = useRef<GeometryLayer | null>(null);
  const regimentsLayerRef = useRef<GeometryLayer | null>(null);
  // Which world map each polity/military layer currently holds features for.
  // These endpoints are world-wide (no bounds), so once a layer is populated
  // for a world there is nothing to re-fetch on pan/zoom — this keeps
  // `loadWorldMapData` from re-downloading and re-rendering the largest
  // payloads in the app on every `moveend`.
  const polityLoadedWorldRef = useRef<Partial<Record<PolityLayerKey, string>>>({});
  const settlementLayerRef = useRef<TileLayer | null>(null);
  const settlementEntrancesLayerRef = useRef<VectorLayer<VectorSource> | null>(null);
  const savedWorldViewRef = useRef<View | null>(null);
  const playerTrailCacheRef = useRef<Map<string, PlayerTrailMeta>>(new Map());
  const rosterByCharacterRef = useRef<Map<string, CampaignRosterEntry>>(new Map());
  const rosterByPlayerRef = useRef<Map<string, CampaignRosterEntry>>(new Map());
  const rosterLoadedForCampaignRef = useRef<string | null>(null);

  const animatorRef = useRef<TokenAnimator | null>(null);
  if (!animatorRef.current) animatorRef.current = new TokenAnimator();

  const [interruptBadge, setInterruptBadge] = useState<
    { playerId: string; day: number; at?: { x: number; y: number } } | null
  >(null);

  const getFeatureType = useCallback((feature: Feature, data?: Record<string, unknown>) => {
    const rawType = feature.get('type') ?? data?.type;
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
        { label: 'Religion', value: toText(data?.religion) },
        { label: 'Population', value: toText(populationValue) },
        { label: 'Elevation', value: formatElevation(elevationValue) },
        { label: 'Temperature', value: toText(data?.temperature) },
      ];
    } else if (featureType === 'marker') {
      const markerSubtype = typeof data?.type === 'string' ? data.type : null;
      const markerName = data?.name ?? feature.get('name') ?? markerSubtype ?? 'Marker';
      title = markerName;
      rows = [
        { label: 'Name', value: toText(markerName) },
        { label: 'Note', value: toText(data?.note) }
      ];
    } else if (featureType === 'route') {
      const routeName = data?.name ?? feature.get('name') ?? 'Route';
      title = String(routeName);
      const routeSubtype = typeof data?.type === 'string' ? data.type : null;
      rows = [
        { label: 'Name', value: toText(routeName) },
        { label: 'Type', value: toText(routeSubtype) },
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

  const getBurgStyle = useMemo(
    () => createBurgStyleFactory(getZoomForResolution),
    [getZoomForResolution]
  );

  const getBurgEntranceStyle = useMemo(
    () => createBurgEntranceStyleFactory(getZoomForResolution),
    [getZoomForResolution]
  );

  const getRouteStyle = useMemo(
    () => createRouteStyleFactory(getZoomForResolution),
    [getZoomForResolution]
  );

  const getMarkerStyle = useMemo(
    () => createMarkerStyleFactory(getZoomForResolution),
    [getZoomForResolution]
  );

  const getCampaignLocationStyle = useCallback((featureLike: FeatureLike, resolution: number) => {
    const feature = asGeometryFeature(featureLike);
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

  const getPlayerTokenStyle = useCallback((featureLike: FeatureLike, resolution: number) => {
    const feature = asGeometryFeature(featureLike);
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

  const layerRefMap = useMemo(() => ({
    burgs: burgsLayerRef,
    burgEntrances: burgEntrancesLayerRef,
    routes: routesLayerRef,
    rivers: riversLayerRef,
    cells: cellsLayerRef,
    markers: markersLayerRef,
    campaignLocations: campaignLayerRef,
    playerTokens: playerLayerRef,
    playerTrails: playerTrailLayerRef,
    states: statesLayerRef,
    provinces: provincesLayerRef,
    cultures: culturesLayerRef,
    religions: religionsLayerRef,
    zones: zonesLayerRef,
    regiments: regimentsLayerRef,
  }), []);

  const toggleLayer = useCallback((layerName: keyof LayerVisibility, value?: boolean) => {
    setLayerVisibility(prev => {
      const nextValue = typeof value === 'boolean' ? value : !prev[layerName];

      if (!nextValue) {
        const layer = layerRefMap[layerName].current;
        layer?.getSource()?.clear();
        // The source was just emptied, so forget that it held this world's
        // data — toggling the layer back on must repopulate it.
        if (isPolityLayerKey(layerName)) {
          delete polityLoadedWorldRef.current[layerName];
        }
      }

      return {
        ...prev,
        [layerName]: nextValue
      };
    });
  }, [layerRefMap]);

  const loadInitialData = useCallback(async () => {
    const worldMapsData = await mapDataLoader.loadWorldMaps();

    const normalizedWorldMaps: WorldMapSummary[] = (worldMapsData || [])
      .map((map: Record<string, unknown>) => {
        if (!map?.id || !map?.bounds) {
          return null;
        }
        const wp = Number(map.width_pixels);
        const hp = Number(map.height_pixels);
        const mpp = Number(map.meters_per_pixel);
        return {
          id: String(map.id),
          name: typeof map.name === 'string' && map.name.trim() ? map.name : 'World Map',
          bounds: map.bounds as WorldMapBounds,
          width_pixels: Number.isFinite(wp) && wp > 0 ? wp : null,
          height_pixels: Number.isFinite(hp) && hp > 0 ? hp : null,
          meters_per_pixel: Number.isFinite(mpp) && mpp > 0 ? mpp : null,
        } as WorldMapSummary;
      })
      .filter((map): map is WorldMapSummary => Boolean(map));

    setWorldMaps(normalizedWorldMaps);

    const initialWorldMap = normalizedWorldMaps[0] ?? null;
    if (initialWorldMap) {
      setSelectedWorldMap((prev) => (prev ? prev : initialWorldMap.id));
      updateViewExtent(initialWorldMap.bounds);
    } else {
      setSelectedWorldMap('');
      updateViewExtent(null);
    }
  }, [updateViewExtent]);

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

  const getBurgEntranceStyleRef = useRef(getBurgEntranceStyle);
  useEffect(() => {
    getBurgEntranceStyleRef.current = getBurgEntranceStyle;
    if (burgEntrancesLayerRef.current) {
      burgEntrancesLayerRef.current.changed();
    }
  }, [getBurgEntranceStyle]);

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

    const pixelDims =
      currentWorldMap?.width_pixels && currentWorldMap?.height_pixels && currentWorldMap?.meters_per_pixel
        ? {
            widthPixels: currentWorldMap.width_pixels,
            heightPixels: currentWorldMap.height_pixels,
            metersPerPixel: currentWorldMap.meters_per_pixel,
          }
        : null;

    const newSource = createQuestablesTileSource(tileSet, worldBounds, pixelDims);
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

      const byCharacter = new Map<string, CampaignRosterEntry>();
      const byPlayer = new Map<string, CampaignRosterEntry>();

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

        const metadata: CampaignRosterEntry = {
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
        features: Array<{ geometry: { type: string; coordinates: number[] }; properties: Record<string, unknown> }>;
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
        const str = (v: unknown): string | undefined => typeof v === 'string' && v.trim() ? v : undefined;
        const playerId = str(properties.playerId) ?? str(properties.player_id);
        if (!playerId) return;

        const characterId = str(properties.characterId) ?? str(properties.character_id);
        const rosterEntry = rosterByPlayerRef.current.get(playerId)
          ?? (characterId ? rosterByCharacterRef.current.get(characterId) : undefined)
          ?? null;

        const name = rosterEntry?.name ?? str(properties.name) ?? `Player ${playerId.slice(0, 6)}`;
        const visibilityState = (str(properties.visibilityState) ?? str(properties.visibility_state) ?? rosterEntry?.visibilityState ?? 'visible') as PlayerToken['visibilityState'];
        const token: PlayerToken = {
          playerId,
          userId: rosterEntry?.userId ?? str(properties.userId) ?? str(properties.user_id) ?? '',
          characterId: characterId ?? rosterEntry?.characterId,
          coordinates: [Number(coords[0]), Number(coords[1])],
          name,
          initials: computeInitials(name),
          avatarUrl: rosterEntry?.avatarUrl ?? str(properties.avatarUrl) ?? str(properties.avatar_url) ?? null,
          visibilityState,
          role: str(properties.role) ?? str(properties.playerRole) ?? rosterEntry?.role ?? 'player',
          canViewHistory: Boolean(properties.canViewHistory ?? properties.can_view_history),
          lastLocatedAt: str(properties.lastLocatedAt) ?? str(properties.last_located_at) ?? rosterEntry?.lastLocatedAt ?? null,
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

  const handleMapClick = useCallback((event: MapBrowserEvent) => {
    const map = mapInstanceRef.current;
    if (!map) return;

    const features = map.getFeaturesAtPixel(event.pixel) as Feature[];

    if (selectedTool === 'move') {
      // Identify feature types once — used for both selection and snap-to-target.
      const pendingPlayerId = pendingMoveRef.current?.playerId ?? null;
      const burgFeature = features.find((f) => getFeatureTypeFromProperties(f) === 'burg');
      const playerFeature = features.find((f) => getFeatureTypeFromProperties(f) === 'player');
      const playerFeatureId = (() => {
        if (!playerFeature) return null;
        const data = playerFeature.get('data') ?? playerFeature.getProperties();
        const pid = data?.playerId ?? playerFeature.get('playerId');
        return typeof pid === 'string' ? pid : null;
      })();

      // No pending move: clicking a player selects them.
      if (!pendingPlayerId && playerFeatureId) {
        const token = playerTokens.find((p) => p.playerId === playerFeatureId);
        if (token) selectPlayerForMovement(token);
        return;
      }

      if (pendingPlayerId) {
        const pending = pendingMoveRef.current!;
        const token = playerTokens.find((p) => p.playerId === pending.playerId);
        if (token) {
          // Snap priority: burg under cursor > another player under cursor >
          // raw click location. "Clicking a town" or "another player" should
          // move onto that target, not to the pixel beside it.
          const snapTarget = burgFeature
            ?? (playerFeatureId && playerFeatureId !== pending.playerId ? playerFeature : null);
          let coordinate = event.coordinate as [number, number];
          if (snapTarget) {
            const geom = snapTarget.getGeometry();
            if (geom instanceof Point) {
              coordinate = geom.getCoordinates() as [number, number];
            }
          }
          setMovementDialog({
            playerId: pending.playerId,
            playerName: pending.playerName,
            coordinate,
            currentPosition: token.coordinates,
          });
        }
        return;
      }
    }

    if (features.length > 0) {
      const interactiveFeature = features.find((feature) => {
        const featureType = getFeatureTypeFromProperties(feature);
        return featureType !== null && INTERACTIVE_FEATURE_TYPES.has(featureType);
      });

      if (interactiveFeature) {
        const details = buildPopupDetails(interactiveFeature);
        const featureId = interactiveFeature.get('id') ?? (details.data as Record<string, unknown> | null)?.id ?? null;
        hoveredFeatureIdRef.current = featureId;
        popupPinnedRef.current = true;
        setPopupContent({
          ...details,
          coordinates: event.coordinate as [number, number]
        });
        overlayRef.current?.setPosition(event.coordinate);
        return;
      }
    }

    if (selectedTool === 'info' && features.length > 0) {
      const feature = features[0];
      const details = buildPopupDetails(feature);
      const featureId = feature.get('id') ?? (details.data as Record<string, unknown> | null)?.id ?? null;
      hoveredFeatureIdRef.current = featureId;
      popupPinnedRef.current = true;
      setPopupContent({
        ...details,
        coordinates: event.coordinate as [number, number]
      });
      overlayRef.current?.setPosition(event.coordinate);
    } else {
      overlayRef.current?.setPosition(undefined);
      setPopupContent(null);
      hoveredFeatureIdRef.current = null;
      popupPinnedRef.current = false;
    }
  }, [buildPopupDetails, playerTokens, selectPlayerForMovement, selectedTool]);

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
      const vis = layerVisibilityRef.current;
      if (zoom >= 10 && !vis.cells) {
        toggleLayer('cells', true);
      } else if (zoom < 8 && vis.cells) {
        toggleLayer('cells', false);
      }

      burgsLayerRef.current?.changed();
      burgEntrancesLayerRef.current?.changed();
      routesLayerRef.current?.changed();
      markersLayerRef.current?.changed();
    }
  }, [toggleLayer]);

  const handleZoomChangeRef = useRef(handleZoomChange);
  useEffect(() => {
    handleZoomChangeRef.current = handleZoomChange;
  }, [handleZoomChange]);

  const handlePointerMove = useCallback((event: MapBrowserEvent) => {
    const map = mapInstanceRef.current;
    if (!map) return;

    const targetElement = map.getTargetElement();
    if (!targetElement) return;

    const features = map.getFeaturesAtPixel(event.pixel) as Feature[];
    const hasInteractiveFeature = features.some((feature) => {
      const featureType = getFeatureTypeFromProperties(feature);
      return featureType !== null && INTERACTIVE_FEATURE_TYPES.has(featureType);
    });

    const hasAnyFeature = features.length > 0;
    const shouldShowPointer = hasInteractiveFeature || (selectedTool === 'info' && hasAnyFeature);
    targetElement.style.cursor = shouldShowPointer ? 'pointer' : '';

    // Always build hover tooltip for any feature under the cursor. States
    // default to visible and blanket the whole world, so `features[0]`
    // (the topmost hit) is very often a polity polygon even when a burg,
    // marker, or player token sits at the same pixel. Prefer the most
    // specific interactive feature when one is present; fall back to the
    // topmost hit (which may be a polity/regiment feature) otherwise.
    if (hasAnyFeature) {
      const preferredInteractive = features.find((f) => {
        const featureType = getFeatureTypeFromProperties(f);
        return featureType !== null && INTERACTIVE_FEATURE_TYPES.has(featureType);
      });
      const feature = preferredInteractive ?? features[0];
      const tooltip = buildHoverTooltipInfo(feature);

      setHoverInfo({
        title: tooltip.title,
        subtitle: tooltip.subtitle,
        details: tooltip.details,
        screenX: event.pixel[0],
        screenY: event.pixel[1],
      });
    } else {
      setHoverInfo(null);
    }

    // When popup is pinned by a click, pointer-move should not dismiss it
    if (popupPinnedRef.current) return;
  }, [selectedTool]);

  const handlePointerMoveRef = useRef(handlePointerMove);
  useEffect(() => {
    handlePointerMoveRef.current = handlePointerMove;
  }, [handlePointerMove]);

  const handleMapClickRef = useRef(handleMapClick);
  useEffect(() => {
    handleMapClickRef.current = handleMapClick;
  }, [handleMapClick]);

  const loadWorldMapData = useCallback(async () => {
    if (!selectedWorldMap || mapModeRef.current !== 'world') return;

    const vis = layerVisibilityRef.current;
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

      if (dataTypes.includes('burgs') && vis.burgs) {
        promises.push(mapDataLoader.loadBurgs(selectedWorldMap, bounds));
      }
      if (dataTypes.includes('burgEntrances') && vis.burgEntrances) {
        promises.push(mapDataLoader.loadBurgEntrances(selectedWorldMap));
      }
      if (dataTypes.includes('routes') && vis.routes) {
        promises.push(mapDataLoader.loadRoutes(selectedWorldMap, bounds));
      }
      if (dataTypes.includes('rivers') && vis.rivers) {
        promises.push(mapDataLoader.loadRivers(selectedWorldMap, bounds));
      }
      if (dataTypes.includes('cells') && vis.cells) {
        promises.push(mapDataLoader.loadCells(selectedWorldMap, bounds));
      }
      if (dataTypes.includes('markers') && vis.markers) {
        promises.push(mapDataLoader.loadMarkers(selectedWorldMap, bounds));
      }
      // Polity / zone / regiment layers are world-wide (not bounds- or
      // zoom-scoped) and are empty for worlds imported before the full FMG
      // JSON pipeline existed. They are loaded once per world: a pan or zoom
      // cannot reveal anything new, so re-fetching (and clearing + re-adding
      // every polygon, which flickers) is pure waste. They are kept out of
      // `promises` because `loadPolity` resolves `Feature[] | null`, where
      // `null` means "the request failed" as opposed to "this world has none".
      const polityLoaded = polityLoadedWorldRef.current;
      const polityLayerRefs: Record<PolityLayerKey, { current: GeometryLayer | null }> = {
        states: statesLayerRef,
        provinces: provincesLayerRef,
        cultures: culturesLayerRef,
        religions: religionsLayerRef,
        zones: zonesLayerRef,
        regiments: regimentsLayerRef,
      };
      const polityRequests = POLITY_LAYER_KEYS
        .filter((key) => vis[key] && polityLoaded[key] !== selectedWorldMap)
        .map((key) => ({ key, request: mapDataLoader.loadPolity(selectedWorldMap, key) }));

      const [results, polityResults] = await Promise.all([
        Promise.all(promises),
        Promise.all(polityRequests.map((entry) => entry.request)),
      ]);

      // Update layers with real data
      let index = 0;
      if (dataTypes.includes('burgs') && vis.burgs) {
        burgsLayerRef.current?.getSource()?.clear();
        burgsLayerRef.current?.getSource()?.addFeatures(results[index++] || []);
      }
      if (dataTypes.includes('burgEntrances') && vis.burgEntrances) {
        burgEntrancesLayerRef.current?.getSource()?.clear();
        burgEntrancesLayerRef.current?.getSource()?.addFeatures(results[index++] || []);
      }
      if (dataTypes.includes('routes') && vis.routes) {
        routesLayerRef.current?.getSource()?.clear();
        routesLayerRef.current?.getSource()?.addFeatures(results[index++] || []);
      }
      if (dataTypes.includes('rivers') && vis.rivers) {
        riversLayerRef.current?.getSource()?.clear();
        riversLayerRef.current?.getSource()?.addFeatures(results[index++] || []);
      }
      if (dataTypes.includes('cells') && vis.cells) {
        cellsLayerRef.current?.getSource()?.clear();
        cellsLayerRef.current?.getSource()?.addFeatures(results[index++] || []);
      }
      if (dataTypes.includes('markers') && vis.markers) {
        markersLayerRef.current?.getSource()?.clear();
        markersLayerRef.current?.getSource()?.addFeatures(results[index++] || []);
      }
      polityRequests.forEach(({ key }, polityIndex) => {
        const features = polityResults[polityIndex];
        // null => the request failed. Leave whatever the layer already shows
        // alone and do NOT stamp it as loaded, so the next map move retries.
        if (features === null) return;
        const source = polityLayerRefs[key].current?.getSource();
        if (!source) return;
        source.clear();
        source.addFeatures(features);
        polityLoadedWorldRef.current[key] = selectedWorldMap;
      });

    } catch (error) {
      console.error('Error loading world map data:', error);
      throw error;
    } finally {
      setLoading(false);
    }
  }, [selectedWorldMap]);

  const loadWorldMapDataRef = useRef(loadWorldMapData);
  useEffect(() => {
    loadWorldMapDataRef.current = loadWorldMapData;
  }, [loadWorldMapData]);

  const handleMapMoveEnd = useCallback(() => {
    if (mapModeRef.current === 'world') {
      loadWorldMapDataRef.current();
    }
  }, []);

  const handleMapMoveEndRef = useRef(handleMapMoveEnd);
  useEffect(() => {
    handleMapMoveEndRef.current = handleMapMoveEnd;
  }, [handleMapMoveEnd]);

  useEffect(() => {
    if (!mapRef.current || mapInstanceRef.current) return;

    const initialVisibility = layerVisibilityRef.current;

    // Base tile layer; source assigned after database tile sets load
    const baseLayer = new TileLayer({
      preload: 2
    });
    baseLayerRef.current = baseLayer;

    // Vector layers for different data types
    const burgsLayer = new VectorLayer<GeometrySource>({
      source: new VectorSource<GeometryFeature>({ wrapX: false }),
      style: (feature, resolution) => getBurgStyleRef.current(asGeometryFeature(feature), resolution),
      visible: initialVisibility.burgs
    });
    burgsLayerRef.current = burgsLayer;

    const burgEntrancesLayer = new VectorLayer<GeometrySource>({
      source: new VectorSource<GeometryFeature>({ wrapX: false }),
      style: (feature, resolution) => getBurgEntranceStyleRef.current(asGeometryFeature(feature), resolution),
      visible: initialVisibility.burgEntrances
    });
    burgEntrancesLayerRef.current = burgEntrancesLayer;

    const routesLayer = new VectorLayer<GeometrySource>({
      source: new VectorSource<GeometryFeature>({ wrapX: false }),
      style: (feature, resolution) => getRouteStyleRef.current(asGeometryFeature(feature), resolution),
      visible: initialVisibility.routes
    });
    routesLayerRef.current = routesLayer;

    const riversLayer = new VectorLayer<GeometrySource>({
      source: new VectorSource<GeometryFeature>({ wrapX: false }),
      style: (feature) => getRiverStyle(asGeometryFeature(feature)),
      visible: initialVisibility.rivers
    });
    riversLayerRef.current = riversLayer;

    const cellsLayer = new VectorLayer<GeometrySource>({
      source: new VectorSource<GeometryFeature>({ wrapX: false }),
      style: (feature) => getCellStyle(asGeometryFeature(feature)),
      visible: initialVisibility.cells
    });
    cellsLayerRef.current = cellsLayer;

    const markersLayer = new VectorLayer<GeometrySource>({
      source: new VectorSource<GeometryFeature>({ wrapX: false }),
      style: (feature, resolution) => getMarkerStyleRef.current(asGeometryFeature(feature), resolution),
      visible: initialVisibility.markers
    });
    markersLayerRef.current = markersLayer;

    // Polity / zone polygons + regiment markers (FMG full-JSON import).
    const statesLayer = createStatesLayer({ visible: initialVisibility.states });
    statesLayerRef.current = statesLayer;

    const provincesLayer = createProvincesLayer({ visible: initialVisibility.provinces });
    provincesLayerRef.current = provincesLayer;

    const culturesLayer = createCulturesLayer({ visible: initialVisibility.cultures });
    culturesLayerRef.current = culturesLayer;

    const religionsLayer = createReligionsLayer({ visible: initialVisibility.religions });
    religionsLayerRef.current = religionsLayer;

    const zonesLayer = createZonesLayer({ visible: initialVisibility.zones });
    zonesLayerRef.current = zonesLayer;

    const regimentsLayer = createRegimentsLayer({ visible: initialVisibility.regiments });
    regimentsLayerRef.current = regimentsLayer;

    const campaignLayer = new VectorLayer<GeometrySource>({
      source: new VectorSource<GeometryFeature>({ wrapX: false }),
      style: (feature, resolution) => getCampaignLocationStyleRef.current(feature, resolution),
      visible: initialVisibility.campaignLocations
    });
    campaignLayerRef.current = campaignLayer;

    const playerTrailLayer = new VectorLayer<TrailSource>({
      source: new VectorSource<TrailFeature>({ wrapX: false }),
      style: getPlayerTrailStyle,
      visible: initialVisibility.playerTrails
    });
    playerTrailLayerRef.current = playerTrailLayer;

    const playerLayer = new VectorLayer<GeometrySource>({
      source: new VectorSource<GeometryFeature>({ wrapX: false }),
      style: (feature, resolution) => getPlayerTokenStyleRef.current(feature, resolution),
      visible: initialVisibility.playerTokens
    });
    playerLayerRef.current = playerLayer;

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
    const map = new OLMap({
      target: mapRef.current,
      layers: [
        baseLayer,
        cellsLayer,      // Bottom layer
        // Polity polygons sit above the terrain/base tiles but below every
        // line + label layer, so state/culture fills never occlude burg icons.
        statesLayer,
        provincesLayer,
        culturesLayer,
        religionsLayer,
        zonesLayer,
        riversLayer,
        routesLayer,
        burgsLayer,
        burgEntrancesLayer,
        markersLayer,
        regimentsLayer,  // text labels — must render above the polygon fills
        campaignLayer,
        playerTrailLayer,
        playerLayer,
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
    const mapClickListener = (event: MapBrowserEvent) => {
      const handler = handleMapClickRef.current;
      if (handler) handler(event);
    };
    const mapMoveEndListener = () => {
      const handler = handleMapMoveEndRef.current;
      if (handler) handler();
    };
    const pointerMoveListener = (event: MapBrowserEvent) => {
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

    // Re-measure the canvas whenever the container resizes (column flex
    // changes, panel toggles, window resize, etc.). Without this, switching
    // from a fixed pixel height to a flex-grown height leaves OL stuck at
    // its initial size.
    const resizeObserver = typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(() => map.updateSize())
      : null;
    if (resizeObserver && mapRef.current) {
      resizeObserver.observe(mapRef.current);
    }

    // Load initial data
    loadInitialDataRef.current?.();

    return () => {
      map.un('click', mapClickListener);
      map.un('moveend', mapMoveEndListener);
      map.un('pointermove', pointerMoveListener);
      view.un('change:resolution', zoomChangeListener);
      resizeObserver?.disconnect();
      animatorRef.current?.cancelAll();
      map.dispose();
      mapInstanceRef.current = null;
    };
  }, []);

  // Fetch the tileset list for the selected world. The server returns the
  // world's scoped "Base map" row, or legacy global rows for pre-scoped
  // worlds; an empty list = no base map (vector layers over blank bg).
  useEffect(() => {
    if (!selectedWorldMap) {
      setTileSets([]);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const rows = await mapDataLoader.loadTileSets(selectedWorldMap);
        if (!cancelled) setTileSets(normalizeTileSetRows(rows));
      } catch {
        if (!cancelled) setTileSets([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedWorldMap]);

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
    const map = mapInstanceRef.current;
    if (!map) return;

    const worldLayers = [
      burgsLayerRef.current,
      burgEntrancesLayerRef.current,
      routesLayerRef.current,
      riversLayerRef.current,
      cellsLayerRef.current,
      markersLayerRef.current,
      campaignLayerRef.current,
      statesLayerRef.current,
      provincesLayerRef.current,
      culturesLayerRef.current,
      religionsLayerRef.current,
      zonesLayerRef.current,
      regimentsLayerRef.current
    ];

    const baseLayer = baseLayerRef.current;

    if (mapMode === 'settlement' && settlementInfo) {
      // Hide world layers + base tile layer
      worldLayers.forEach(layer => { if (layer) layer.setVisible(false); });
      playerTrailLayerRef.current?.setVisible(false);
      playerLayerRef.current?.setVisible(false);
      if (baseLayer) baseLayer.setVisible(false);

      // Save the current world view so we can restore it later
      savedWorldViewRef.current = map.getView();

      // Remove any existing settlement layer
      if (settlementLayerRef.current) {
        map.removeLayer(settlementLayerRef.current);
        settlementLayerRef.current = null;
      }

      // Create settlement tile layer. Pass the real SVG viewBox so the tile
      // grid is in the same settlement-local (Y-up negated) coord frame as
      // the view — without it, the source falls back to a positive-Y grid
      // that is disjoint from the view's extent and tiles silently refuse
      // to line up.
      const tileSource = createSettlementTileSource(
        settlementInfo.burgId,
        settlementInfo.maxZoom,
        settlementInfo.svgViewBox ?? undefined,
      );
      const tileLayer = new TileLayer({ source: tileSource, preload: 2 });
      settlementLayerRef.current = tileLayer;
      map.addLayer(tileLayer);

      // Entrance overlay — orange dots at arrival_local. Whole-world fetch
      // filtered by burgId client-side (matches SettlementMap's approach).
      // Unwalled burgs have no visible gate-notches in the SVG, so this
      // overlay is the only way to see their entrances.
      if (settlementEntrancesLayerRef.current) {
        map.removeLayer(settlementEntrancesLayerRef.current);
        settlementEntrancesLayerRef.current = null;
      }
      const entranceSource = new VectorSource();
      const entranceLayer = new VectorLayer({
        source: entranceSource,
        style: new Style({
          image: new CircleStyle({
            radius: 6,
            fill: new Fill({ color: '#f59e0b' }),
            stroke: new Stroke({ color: '#78350f', width: 1.5 }),
          }),
        }),
      });
      settlementEntrancesLayerRef.current = entranceLayer;
      map.addLayer(entranceLayer);

      const burgId = settlementInfo.burgId;
      void (async () => {
        try {
          const res = await fetch(
            `${getApiBaseUrl()}/api/maps/${selectedWorldMap}/burg-entrances?burgId=${burgId}`,
            { credentials: 'include' },
          );
          if (!res.ok) return;
          const fc = (await res.json()) as {
            features: Array<{ properties: { burgId: string; arrival_local?: [number, number] | null } }>;
          };
          // Stale-response guard: if the user navigated away already, drop it.
          if (settlementEntrancesLayerRef.current !== entranceLayer) return;
          for (const f of fc.features) {
            if (f.properties.burgId !== burgId) continue;
            if (!Array.isArray(f.properties.arrival_local)) continue;
            entranceSource.addFeature(
              new Feature(new Point([f.properties.arrival_local[0], -f.properties.arrival_local[1]])),
            );
          }
        } catch {
          /* nice-to-have; silent */
        }
      })();

      // View extent + resolutions mirror the tile grid exactly. This is the
      // same math squareViewBox() does inside the tile source — we just
      // need it here too so the view can resolve zoom levels.
      const tileSize = 256;
      const vb = settlementInfo.svgViewBox;
      const squareExtent = vb ? Math.max(vb.width, vb.height) : 256 * Math.pow(2, settlementInfo.maxZoom);
      const squareX = vb ? vb.x - (squareExtent - vb.width) / 2 : 0;
      const squareY = vb ? vb.y - (squareExtent - vb.height) / 2 : -squareExtent;
      // Tile-grid extent in OL (Y-up flipped from SVG Y-down).
      const settlementExtent: [number, number, number, number] = [
        squareX,
        -(squareY + squareExtent),
        squareX + squareExtent,
        -squareY,
      ];
      const settlementResolutions = Array.from(
        { length: settlementInfo.maxZoom + 1 },
        (_, z) => squareExtent / tileSize / Math.pow(2, z),
      );
      const settlementView = new View({
        projection: questablesProjection,
        extent: settlementExtent,
        resolutions: settlementResolutions,
        constrainOnlyCenter: true,
        enableRotation: false,
      });
      map.setView(settlementView);
      const zoomHandler = () => { handleZoomChangeRef.current?.(); };
      settlementView.on('change:resolution', zoomHandler);

      // Fit to the town's actual footprint (localBounds) — mapped into the
      // same flipped-Y frame. This avoids fitting the square-padded extent,
      // which puts small settlements in a corner with empty strips.
      const lb = settlementInfo.localBounds;
      let fitExtent: [number, number, number, number] = settlementExtent;
      if (lb) {
        fitExtent = [
          lb.min_x,
          -lb.max_y,
          lb.max_x,
          -lb.min_y,
        ];
      }
      requestAnimationFrame(() => {
        map.updateSize();
        settlementView.fit(fitExtent, {
          size: map.getSize(),
          padding: [20, 20, 20, 20],
        });
      });
    } else {
      // Switching back to world
      if (settlementLayerRef.current) {
        map.removeLayer(settlementLayerRef.current);
        settlementLayerRef.current = null;
      }
      if (settlementEntrancesLayerRef.current) {
        map.removeLayer(settlementEntrancesLayerRef.current);
        settlementEntrancesLayerRef.current = null;
      }

      // Restore the saved world view
      if (savedWorldViewRef.current) {
        map.setView(savedWorldViewRef.current);
        savedWorldViewRef.current = null;
      }

      // Show base layer + world layers
      if (baseLayer) baseLayer.setVisible(true);
      const vis = layerVisibilityRef.current;
      burgsLayerRef.current?.setVisible(vis.burgs);
      burgEntrancesLayerRef.current?.setVisible(vis.burgEntrances);
      routesLayerRef.current?.setVisible(vis.routes);
      riversLayerRef.current?.setVisible(vis.rivers);
      cellsLayerRef.current?.setVisible(vis.cells);
      markersLayerRef.current?.setVisible(vis.markers);
      campaignLayerRef.current?.setVisible(vis.campaignLocations);
      playerTrailLayerRef.current?.setVisible(vis.playerTrails);
      playerLayerRef.current?.setVisible(vis.playerTokens);
      statesLayerRef.current?.setVisible(vis.states);
      provincesLayerRef.current?.setVisible(vis.provinces);
      culturesLayerRef.current?.setVisible(vis.cultures);
      religionsLayerRef.current?.setVisible(vis.religions);
      zonesLayerRef.current?.setVisible(vis.zones);
      regimentsLayerRef.current?.setVisible(vis.regiments);

      loadWorldMapDataRef.current();
      if (activeCampaignId) {
        void loadVisiblePlayers(activeCampaignId);
      }
    }
  }, [activeCampaignId, loadVisiblePlayers, mapMode, settlementInfo]);

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
    burgEntrancesLayerRef.current?.setVisible(layerVisibility.burgEntrances && mapMode === 'world');
    routesLayerRef.current?.setVisible(layerVisibility.routes && mapMode === 'world');
    riversLayerRef.current?.setVisible(layerVisibility.rivers && mapMode === 'world');
    cellsLayerRef.current?.setVisible(layerVisibility.cells && mapMode === 'world');
    markersLayerRef.current?.setVisible(layerVisibility.markers && mapMode === 'world');
    campaignLayerRef.current?.setVisible(layerVisibility.campaignLocations && mapMode === 'world');
    playerTrailLayerRef.current?.setVisible(layerVisibility.playerTrails && mapMode === 'world');
    playerLayerRef.current?.setVisible(layerVisibility.playerTokens && mapMode === 'world');
    statesLayerRef.current?.setVisible(layerVisibility.states && mapMode === 'world');
    provincesLayerRef.current?.setVisible(layerVisibility.provinces && mapMode === 'world');
    culturesLayerRef.current?.setVisible(layerVisibility.cultures && mapMode === 'world');
    religionsLayerRef.current?.setVisible(layerVisibility.religions && mapMode === 'world');
    zonesLayerRef.current?.setVisible(layerVisibility.zones && mapMode === 'world');
    regimentsLayerRef.current?.setVisible(layerVisibility.regiments && mapMode === 'world');
  }, [layerVisibility, mapMode]);



  useEffect(() => {
    if (mapMode === 'world') {
      loadWorldMapDataRef.current();
    }
  }, [layerVisibility, mapMode]);

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
      popupPinnedRef.current = false;
    }
  }, [selectedTool]);

  useEffect(() => {
    if (selectedTool !== 'move') {
      clearMovementSelection();
    }
  }, [clearMovementSelection, selectedTool]);

  const openSettlement = useCallback(async (burgId: string) => {
    try {
      const info = await fetchJson<{
        burgId: string;
        name: string;
        population: number;
        maxZoom: number;
        tileSize: number;
        localBounds: { min_x: number; min_y: number; max_x: number; max_y: number } | null;
        svgViewBox: { x: number; y: number; width: number; height: number } | null;
      }>(`/api/maps/settlements/${burgId}/info`);
      if (!info) return;
      setSettlementInfo({
        burgId: info.burgId,
        name: info.name,
        population: info.population,
        maxZoom: info.maxZoom,
        localBounds: info.localBounds ?? null,
        svgViewBox: info.svgViewBox ?? null,
      });
      setMapMode('settlement');
    } catch (err) {
      console.error('[OpenLayersMap] Failed to load settlement info', err);
      toast.error('Failed to load settlement map.');
    }
  }, []);

  const closeSettlement = useCallback(() => {
    setSettlementInfo(null);
    setMapMode('world');
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
      availableMoveModes.includes(prev)
        ? prev
        : availableMoveModes[0]
    ));
  }, [availableMoveModes, movementDialog]);

  // ── Per-event handlers for player movement / spawns ────────────────────
  useWsEvent<unknown>("player-moved", (rawEvent) => {
    if (!activeCampaignId) return;

    // The provider strips the outer { type, data } envelope and delivers the
    // raw payload. Keep tolerating both shapes during migration.
    const data = isPlainObject(rawEvent)
      ? (isPlainObject((rawEvent as Record<string, unknown>).data)
          ? ((rawEvent as Record<string, unknown>).data as Record<string, unknown>)
          : (rawEvent as Record<string, unknown>))
      : null;
    if (!data) return;
    const playerId = typeof data.playerId === 'string' ? data.playerId : null;
    if (!playerId) return;

    const path = isPlainObject(data.path) ? data.path : null;
    const rawWaypoints = Array.isArray(path?.waypoints) ? (path!.waypoints as unknown[]) : null;
    const waypoints: Waypoint[] | null =
      rawWaypoints && rawWaypoints.length >= 2
        ? (rawWaypoints.filter(
            (w): w is Waypoint =>
              isPlainObject(w) && typeof w.x === 'number' && typeof w.y === 'number',
          ).length === rawWaypoints.length
            ? (rawWaypoints as Waypoint[])
            : null)
        : null;

    const travel = isPlainObject(data.travel) ? data.travel : null;
    if (travel?.interrupted === true) {
      const lastWp =
        rawWaypoints && rawWaypoints.length > 0
          ? (rawWaypoints[rawWaypoints.length - 1] as unknown)
          : undefined;
      const at =
        isPlainObject(lastWp) && typeof lastWp.x === 'number' && typeof lastWp.y === 'number'
          ? { x: lastWp.x, y: lastWp.y }
          : undefined;
      const daysElapsed = typeof travel.daysElapsed === 'number' ? travel.daysElapsed : 0;
      setInterruptBadge({ playerId, day: daysElapsed, at });
    } else {
      setInterruptBadge((prev) => (prev?.playerId === playerId ? null : prev));
    }

    const arrival = isPlainObject(data.arrival) ? data.arrival : null;
    const arrivalGate = arrival && isPlainObject(arrival.gate) ? arrival.gate : null;
    const arrivalGateId = typeof arrivalGate?.id === 'string' ? arrivalGate.id : null;

    const pulseArrivalGate = () => {
      if (!arrivalGateId) return;
      if (typeof window !== 'undefined'
          && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
      const feature = burgEntrancesLayerRef.current?.getSource()?.getFeatureById(arrivalGateId);
      if (!feature) return;
      const originalStyle = feature.getStyle();
      feature.setStyle(new Style({
        image: new Icon({
          src: GATE_PULSE_ICON_DATA_URI,
          scale: 1.4,
          rotation: (Number(feature.get('bearingDeg') ?? 0) * Math.PI) / 180,
          rotateWithView: false,
        }),
      }));
      window.setTimeout(() => feature.setStyle(originalStyle ?? undefined), GATE_PULSE_DURATION_MS);
    };

    let animated = false;
    if (waypoints && playerLayerRef.current) {
      const source = playerLayerRef.current.getSource();
      const feature = source
        ?.getFeatures()
        .find((f) => f.get('playerId') === playerId) ?? null;
      if (feature) {
        animated = true;
        void animatorRef.current!.animate(
          playerId,
          feature,
          waypoints,
          ANIMATION_DURATION_MS,
        ).then(() => {
          pulseArrivalGate();
          void loadVisiblePlayers(activeCampaignId);
        });
      }
    }

    if (!animated) {
      pulseArrivalGate();
      void loadVisiblePlayers(activeCampaignId);
    }

    if (trailSelections[playerId]) {
      void refreshTrailForPlayer(playerId);
    }
  });

  useWsEvent<unknown>("player-teleported", (rawEvent) => {
    if (!activeCampaignId) return;
    void loadVisiblePlayers(activeCampaignId);
    const playerId = extractPlayerId(rawEvent);
    if (playerId && trailSelections[playerId]) {
      void refreshTrailForPlayer(playerId);
    }
  });

  useWsEvent("spawn-updated", () => {
    if (!activeCampaignId) return;
    void loadVisiblePlayers(activeCampaignId);
  });

  useWsEvent("spawn-deleted", () => {
    if (!activeCampaignId) return;
    void loadVisiblePlayers(activeCampaignId);
  });

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
            {mapMode === 'world' ? <Globe className="w-5 h-5" /> : <Building2 className="w-5 h-5" />}
            {mapMode === 'world' ? 'World Map' : settlementInfo?.name ?? 'Settlement'}
            {mapMode === 'settlement' && settlementInfo && (
              <Badge variant="secondary" className="ml-1 text-xs">
                Pop. {settlementInfo.population.toLocaleString()}
              </Badge>
            )}
            {loading && <Badge variant="secondary" className="ml-2">Loading...</Badge>}
          </CardTitle>

          <div className="flex items-center gap-2">
            {mapMode === 'settlement' && (
              <Button
                variant="outline"
                size="sm"
                className="h-8 px-3 text-xs"
                onClick={closeSettlement}
              >
                <ArrowLeft className="w-3 h-3 mr-1" />
                Back to World Map
              </Button>
            )}

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
                  onClick={() => setSelectedTool(tool.id)}
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

      <CardContent className="flex-1 min-h-0 p-0 relative">
        <div className="relative h-full">
          <div
            ref={mapRef}
            className="h-full w-full bg-blue-50"
          />

          {hoverInfo ? (
            <div
              className="pointer-events-none absolute z-40 rounded-md bg-slate-900/90 px-3 py-1 text-xs text-white shadow"
              style={{ left: hoverInfo.screenX + 16, top: hoverInfo.screenY + 16 }}
            >
              <div className="font-medium">{hoverInfo.title}</div>
              {hoverInfo.subtitle ? <div className="text-[10px] uppercase text-slate-300">{hoverInfo.subtitle}</div> : null}
              {hoverInfo.details ? hoverInfo.details.map((line, i) => (
                <div key={i} className="text-[10px] text-slate-300">{line}</div>
              )) : null}
            </div>
          ) : null}

          {interruptBadge && (
            <div
              style={{
                position: 'absolute',
                top: 16, right: 16,
                padding: '6px 10px',
                background: 'rgba(30,30,30,0.85)',
                color: 'white',
                borderRadius: 6,
                fontSize: 13,
                pointerEvents: 'auto',
                cursor: 'pointer',
                zIndex: 100,
              }}
              onClick={() => setInterruptBadge(null)}
            >
              ⛺ <strong>Day {interruptBadge.day}</strong> — journey interrupted (click to dismiss)
            </div>
          )}
        </div>

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
                      popupPinnedRef.current = false;
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
                  ) : null}
                  {popupContent.featureType === 'burg' && mapMode === 'world' && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full mt-2 h-7 text-xs"
                      onClick={() => {
                        const burgId = (popupContent.data as Record<string, unknown> | null)?.id;
                        if (typeof burgId === 'string') {
                          overlayRef.current?.setPosition(undefined);
                          setPopupContent(null);
                          popupPinnedRef.current = false;
                          void openSettlement(burgId);
                        }
                      }}
                    >
                      <Building2 className="w-3 h-3 mr-1" />
                      View Settlement
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </CardContent>
      {mapMode === 'world' && (
        <MapVisiblePlayersPanel
          tokens={sortedPlayerTokens}
          playerLoading={playerLoading}
          playerError={playerError}
          activeCampaignId={activeCampaignId}
          onRefresh={(id) => void loadVisiblePlayers(id)}
          trailSelections={trailSelections}
          trailErrors={trailErrors}
          onTrailToggle={(token, checked) => void handleTrailToggle(token, checked)}
          canControlPlayer={canControlPlayer}
          selectedPlayerId={selectedPlayerId}
          onFocusPlayer={focusOnPlayer}
          onMovePlayer={(token) => { setSelectedTool('move'); selectPlayerForMovement(token); }}
        />
      )}

      {/* Map Controls Panel */}
      <div className="border-t p-3 bg-muted/30">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4 text-xs text-muted-foreground">
            <span>Zoom: {currentZoom}</span>
            <span>Players: {playerTokens.length}</span>
            <span>Mode: {mapMode === 'world' ? 'Exploration' : 'Settlement'}</span>
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
      <MapPlayerMovementDialog
        dialog={movementDialog}
        onClose={() => { setMovementDialog(null); clearMovementSelection(); }}
        moveMode={moveMode}
        onMoveModeChange={setMoveMode}
        availableMoveModes={availableMoveModes}
        movementDistance={movementDistance}
        onConfirm={handleConfirmMove}
      />
    </Card>
  );
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
