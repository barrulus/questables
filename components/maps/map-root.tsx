import { useEffect, useMemo, useRef, useState } from 'react';
import { SettlementMap, type SettlementSidecar } from './settlement-map';
import { OpenLayersMap } from '../openlayers-map';
import { useVisiblePlayers } from '../../hooks/useVisiblePlayers';
import { getApiBaseUrl } from '../../utils/api-client';

interface Props {
  activeCampaignId: string | null;
  activeCharacterId: string | null;
}

export function MapRoot({ activeCampaignId, activeCharacterId }: Props) {
  const { players } = useVisiblePlayers(activeCampaignId);
  const [manualWorldOverride, setManualWorldOverride] = useState(false);
  const [sidecar, setSidecar] = useState<SettlementSidecar | null>(null);

  const followed = useMemo(
    () => players.find((p) => p.characterId === activeCharacterId) ?? null,
    [players, activeCharacterId],
  );
  const currentBurgId = followed?.insideBurgId ?? null;

  const prevBurgRef = useRef<string | null>(null);
  useEffect(() => {
    if (prevBurgRef.current !== currentBurgId) {
      setManualWorldOverride(false);
      prevBurgRef.current = currentBurgId;
    }
  }, [currentBurgId]);

  useEffect(() => {
    if (!currentBurgId) {
      setSidecar(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(
          `${getApiBaseUrl()}/api/maps/burgs/${currentBurgId}/settlement`,
          { credentials: 'include' },
        );
        if (!res.ok) {
          if (!cancelled) setSidecar(null);
          return;
        }
        const body = (await res.json()) as SettlementSidecar;
        if (!cancelled) setSidecar(body);
      } catch {
        if (!cancelled) setSidecar(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [currentBurgId]);

  const showSettlement =
    currentBurgId != null &&
    !manualWorldOverride &&
    sidecar != null &&
    followed?.settlementLocal != null;

  if (showSettlement && currentBurgId && sidecar) {
    return (
      <SettlementMap
        burgId={currentBurgId}
        worldId={sidecar.world_id}
        sidecar={sidecar}
        players={players}
        onDismiss={() => setManualWorldOverride(true)}
      />
    );
  }

  return <OpenLayersMap />;
}

export default MapRoot;
