import { useEffect, useRef } from 'react';
import OLMap from 'ol/Map';
import View from 'ol/View';
import TileLayer from 'ol/layer/Tile';
import VectorLayer from 'ol/layer/Vector';
import VectorSource from 'ol/source/Vector';
import Feature from 'ol/Feature';
import Point from 'ol/geom/Point';
import { Style, Fill, Stroke, Circle as CircleStyle } from 'ol/style';
import { createSettlementTileSource } from './settlement-tile-source';
import { questablesProjection } from '../map-projection';
import { getApiBaseUrl } from '../../utils/api-client';
import type { VisiblePlayer } from '../../hooks/useVisiblePlayers';

export interface SettlementSidecar {
  world_id: string;
  meters_per_unit: number;
  max_zoom: number;
  local_bounds: { min_x: number; min_y: number; max_x: number; max_y: number };
  svg_viewbox: { x: number; y: number; width: number; height: number };
}

interface Props {
  burgId: string;
  worldId: string;
  sidecar: SettlementSidecar;
  players: VisiblePlayer[];
  onDismiss: () => void;
}

export function SettlementMap({ burgId, worldId, sidecar, players, onDismiss }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<OLMap | null>(null);
  const playerLayerRef = useRef<VectorSource | null>(null);
  const entranceLayerRef = useRef<VectorSource | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const source = createSettlementTileSource(burgId, sidecar.max_zoom);
    const tileLayer = new TileLayer({ source });

    const playerSource = new VectorSource();
    playerLayerRef.current = playerSource;
    const playerLayer = new VectorLayer({
      source: playerSource,
      style: new Style({
        image: new CircleStyle({
          radius: 6,
          fill: new Fill({ color: '#2563eb' }),
          stroke: new Stroke({ color: '#fff', width: 2 }),
        }),
      }),
    });

    const entranceSource = new VectorSource();
    entranceLayerRef.current = entranceSource;
    const entranceLayer = new VectorLayer({
      source: entranceSource,
      style: new Style({
        image: new CircleStyle({
          radius: 4,
          fill: new Fill({ color: '#f59e0b' }),
          stroke: new Stroke({ color: '#78350f', width: 1 }),
        }),
      }),
    });

    const extent: [number, number, number, number] = [
      sidecar.local_bounds.min_x,
      sidecar.local_bounds.min_y,
      sidecar.local_bounds.max_x,
      sidecar.local_bounds.max_y,
    ];
    const view = new View({
      projection: questablesProjection,
      center: [
        (extent[0] + extent[2]) / 2,
        (extent[1] + extent[3]) / 2,
      ],
      maxZoom: sidecar.max_zoom,
    });

    const map = new OLMap({
      target: containerRef.current,
      layers: [tileLayer, entranceLayer, playerLayer],
      view,
    });
    mapRef.current = map;

    view.fit(extent, { maxZoom: sidecar.max_zoom });

    // Fetch entrances for this burg; arrival_local gives the settlement-local position.
    // NOTE: the current /:worldId/burg-entrances endpoint does not expose arrival_local
    // in its response properties — only x_px/y_px (world-map coords). A follow-up task
    // should either add a per-burg endpoint or extend the route to include arrival_local.
    // The try/catch means this failure is silent and entrance paint is skipped gracefully.
    void (async () => {
      try {
        const res = await fetch(
          `${getApiBaseUrl()}/api/maps/${worldId}/burg-entrances?burgId=${burgId}`,
          { credentials: 'include' },
        );
        if (!res.ok) return;
        const fc = (await res.json()) as {
          features: Array<{
            properties: {
              burgId: string;
              arrival_local?: [number, number] | null;
            };
          }>;
        };
        for (const f of fc.features) {
          if (f.properties.burgId !== burgId) continue;
          if (!Array.isArray(f.properties.arrival_local)) continue;
          const pt: [number, number] = [
            f.properties.arrival_local[0],
            f.properties.arrival_local[1],
          ];
          entranceSource.addFeature(new Feature(new Point(pt)));
        }
      } catch {
        /* ignore; entrance paint is nice-to-have */
      }
    })();

    return () => {
      map.setTarget(undefined);
      mapRef.current = null;
    };
  }, [burgId, worldId, sidecar.local_bounds.max_x, sidecar.local_bounds.max_y, sidecar.local_bounds.min_x, sidecar.local_bounds.min_y, sidecar.max_zoom]);

  // Player tokens — re-run on players change
  useEffect(() => {
    const src = playerLayerRef.current;
    if (!src) return;
    src.clear();
    for (const p of players) {
      if (p.insideBurgId !== burgId) continue;
      if (!p.settlementLocal) continue;
      src.addFeature(new Feature(new Point([p.settlementLocal.x, p.settlementLocal.y])));
    }
  }, [players, burgId]);

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
      <button
        type="button"
        onClick={onDismiss}
        style={{ position: 'absolute', top: 8, right: 8, zIndex: 10 }}
      >
        View world
      </button>
    </div>
  );
}
