import { useCallback, useEffect, useRef, useState } from 'react';
import { useWebSocket } from './useWebSocket';
import { apiFetch } from '../utils/api-client';

export interface VisiblePlayer {
  playerId: string;
  userId: string;
  characterId: string;
  role: string;
  visibilityState: string;
  canViewHistory: boolean;
  geometry: { type: 'Point'; coordinates: [number, number] } | null;
  insideBurgId: string | null;
  mapLevel: 'world' | 'settlement';
  settlementLocal: { x: number; y: number } | null;
}

interface Response {
  type: 'FeatureCollection';
  features: Array<{
    type: 'Feature';
    geometry: VisiblePlayer['geometry'];
    properties: Omit<VisiblePlayer, 'geometry'>;
  }>;
  metadata: { radius: number; viewerRole: string };
}

export function useVisiblePlayers(campaignId: string | null, radiusOverride?: number | null) {
  const [players, setPlayers] = useState<VisiblePlayer[]>([]);
  const [loading, setLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const refresh = useCallback(async () => {
    if (!campaignId) return;
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setLoading(true);
    try {
      const radiusQuery = radiusOverride != null ? `?radius=${radiusOverride}` : '';
      const res = await apiFetch(
        `/api/campaigns/${campaignId}/players/visible${radiusQuery}`,
        { signal: ctrl.signal },
      );
      if (!res.ok) throw new Error(`visible-players ${res.status}`);
      const body = (await res.json()) as Response;
      const next: VisiblePlayer[] = body.features.map((f) => ({
        ...f.properties,
        geometry: f.geometry,
      } as VisiblePlayer));
      setPlayers(next);
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        // eslint-disable-next-line no-console
        console.warn('useVisiblePlayers refresh failed', err);
      }
    } finally {
      setLoading(false);
    }
  }, [campaignId, radiusOverride]);

  useEffect(() => { void refresh(); }, [refresh]);

  // Re-fetch when any player in this campaign moves/teleports so MapRoot's
  // decision to swap to SettlementMap picks up the new inside_burg_id.
  const { messages } = useWebSocket(campaignId ?? '');
  const lastMoveCountRef = useRef(0);
  useEffect(() => {
    const count = messages.filter(
      (m) => m.type === 'player-moved' || m.type === 'player-teleported',
    ).length;
    if (count > lastMoveCountRef.current) {
      lastMoveCountRef.current = count;
      void refresh();
    }
  }, [messages, refresh]);

  return { players, loading, refresh };
}
