import { useEffect, useRef, useState } from 'react';
import OLMap from 'ol/Map';
import View from 'ol/View';
import TileLayer from 'ol/layer/Tile';
import VectorLayer from 'ol/layer/Vector';
import VectorSource from 'ol/source/Vector';
import Feature from 'ol/Feature';
import Point from 'ol/geom/Point';
import { Style, Fill, Stroke, Circle as CircleStyle } from 'ol/style';
import { Building2, ArrowLeft } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { createSettlementTileSource, squareViewBox } from './settlement-tile-source';
import { questablesProjection } from '../map-projection';
import { getApiBaseUrl } from '../../utils/api-client';
import type { VisiblePlayer } from '../../hooks/useVisiblePlayers';

export interface SettlementSidecar {
  world_id: string;
  burg_name?: string | null;
  population?: number | null;
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
  const [playerSource, setPlayerSource] = useState<VectorSource | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const source = createSettlementTileSource(burgId, sidecar.max_zoom, sidecar.svg_viewbox);
    const tileLayer = new TileLayer({ source });

    const nextPlayerSource = new VectorSource();
    const playerLayer = new VectorLayer({
      source: nextPlayerSource,
      style: new Style({
        image: new CircleStyle({
          radius: 6,
          fill: new Fill({ color: '#2563eb' }),
          stroke: new Stroke({ color: '#fff', width: 2 }),
        }),
      }),
    });

    const nextEntranceSource = new VectorSource();
    const entranceLayer = new VectorLayer({
      source: nextEntranceSource,
      style: new Style({
        image: new CircleStyle({
          radius: 4,
          fill: new Fill({ color: '#f59e0b' }),
          stroke: new Stroke({ color: '#78350f', width: 1 }),
        }),
      }),
    });

    // Tile grid / view coords: features are Y-DOWN settlement-local; OL is
    // Y-up. We negate y on the way in. The tile grid already bakes in the
    // flip via squareViewBox.
    const sq = squareViewBox(sidecar.svg_viewbox);
    const tileExtent: [number, number, number, number] = [
      sq.x,
      -(sq.y + sq.height),
      sq.x + sq.width,
      -sq.y,
    ];

    // View resolutions must match the tile grid's (else OL picks resolutions
    // from the global questablesProjection's 20M-pixel world extent and the
    // town ends up 1 screen-pixel wide). Append extra finer levels so the
    // user can zoom in past native tile resolution — tiles just upscale.
    const tileSize = 256;
    const baseResolutions = Array.from(
      { length: sidecar.max_zoom + 1 },
      (_, z) => sq.width / tileSize / Math.pow(2, z),
    );
    const OVERZOOM_LEVELS = 4;
    const finest = baseResolutions[baseResolutions.length - 1];
    const overzoom = Array.from(
      { length: OVERZOOM_LEVELS },
      (_, i) => finest / Math.pow(2, i + 1),
    );
    const viewResolutions = [...baseResolutions, ...overzoom];

    // Fit the ACTUAL town footprint (local_bounds) rather than the padded
    // square viewBox — the square padding around the town is empty space,
    // so fitting it makes the town tiny.
    const fitExtent: [number, number, number, number] = [
      sidecar.local_bounds.min_x,
      -sidecar.local_bounds.max_y,
      sidecar.local_bounds.max_x,
      -sidecar.local_bounds.min_y,
    ];

    const view = new View({
      projection: questablesProjection,
      extent: tileExtent,
      resolutions: viewResolutions,
      constrainOnlyCenter: true,
      enableRotation: false,
    });

    const map = new OLMap({
      target: containerRef.current,
      layers: [tileLayer, entranceLayer, playerLayer],
      view,
    });
    mapRef.current = map;
    setPlayerSource(nextPlayerSource);

    view.fit(fitExtent, { padding: [24, 24, 24, 24] });

    // Fetch entrances for this burg. The endpoint returns every entrance in
    // the world — we filter by burgId below. `arrival_local` is a pair of
    // settlement-local coords (Y-down); OL is Y-up, so we negate y.
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
          // Flip Y: arrival_local is Y-down settlement-local, OL is Y-up.
          const pt: [number, number] = [
            f.properties.arrival_local[0],
            -f.properties.arrival_local[1],
          ];
          nextEntranceSource.addFeature(new Feature(new Point(pt)));
        }
      } catch {
        /* ignore; entrance paint is nice-to-have */
      }
    })();

    return () => {
      map.setTarget(undefined);
      mapRef.current = null;
      setPlayerSource(null);
    };
  }, [burgId, worldId, sidecar.local_bounds.max_x, sidecar.local_bounds.max_y, sidecar.local_bounds.min_x, sidecar.local_bounds.min_y, sidecar.max_zoom]);

  // Player tokens — re-run on players change OR when a fresh map/source is created.
  useEffect(() => {
    if (!playerSource) return;
    playerSource.clear();
    for (const p of players) {
      if (p.insideBurgId !== burgId) continue;
      if (!p.settlementLocal) continue;
      // Flip Y: settlementLocal is Y-down, OL is Y-up.
      playerSource.addFeature(new Feature(new Point([p.settlementLocal.x, -p.settlementLocal.y])));
    }
  }, [players, burgId, playerSource]);

  const title = sidecar.burg_name ?? 'Settlement';
  const population = sidecar.population ?? null;

  return (
    <Card className="h-full rounded-none border-0 border-r">
      <CardHeader className="pb-3">
        <div className="flex justify-between items-center">
          <CardTitle className="flex items-center gap-2">
            <Building2 className="w-5 h-5" />
            {title}
            {population != null && (
              <Badge variant="secondary" className="ml-1 text-xs">
                Pop. {population.toLocaleString()}
              </Badge>
            )}
          </CardTitle>
          <Button
            variant="outline"
            size="sm"
            className="h-8 px-3 text-xs"
            onClick={onDismiss}
          >
            <ArrowLeft className="w-3 h-3 mr-1" />
            View world
          </Button>
        </div>
      </CardHeader>
      <CardContent className="flex-1 min-h-0 p-0 relative">
        <div ref={containerRef} className="h-full w-full bg-blue-50" />
      </CardContent>
    </Card>
  );
}
