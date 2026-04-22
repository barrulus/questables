import { useEffect, useMemo, useRef, useState } from 'react';
import { SettlementMap, type SettlementSidecar } from './settlement-map';
import { OpenLayersMap } from '../openlayers-map';
import { useVisiblePlayers } from '../../hooks/useVisiblePlayers';
import { useGameSession } from '../../contexts/GameSessionContext';
import { useMyCharacter } from '../../hooks/useMyCharacter';
import { getApiBaseUrl } from '../../utils/api-client';

export function MapRoot() {
  const { activeCampaignId } = useGameSession();
  const myCharacter = useMyCharacter();
  const activeCharacterId = myCharacter?.id ?? null;
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
