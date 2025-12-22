import React, { useEffect, useMemo, useState } from 'react';
import ReactDOM from 'react-dom/client';
import '../styles/globals.css';

import { CampaignPrepMap } from '../components/campaign-prep-map';
import { listWorldMaps } from '../utils/api/maps';

type Bounds = { west: number; south: number; east: number; north: number };

type WorldRecord = Record<string, unknown> & {
  id?: string;
  name?: string;
  bounds?: Bounds;
};

function useFirstWorldMap() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [world, setWorld] = useState<WorldRecord | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);

        // Optional: allow selecting a specific world via ?worldId=
        const url = new URL(window.location.href);
        const targetWorldId = url.searchParams.get('worldId');

        const maps = await listWorldMaps();
        if (cancelled) return;

        const items = Array.isArray(maps) ? maps : [];
        const byId = (items as WorldRecord[]).find((m) => m && typeof m.id === 'string' && m.id === targetWorldId);
        const first = byId ?? (items[0] as WorldRecord | undefined) ?? null;

        if (!first || typeof first.id !== 'string' || !first.bounds) {
          setError('No world maps available or bounds missing. Ensure the backend is running and at least one world map is loaded.');
          setWorld(null);
        } else {
          setWorld(first);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to load world maps';
        setError(message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return { loading, error, world };
}

function StandaloneCampaignPrepMap() {
  const { loading, error, world } = useFirstWorldMap();

  const worldMap = useMemo(() => {
    if (!world) return null;
    return {
      id: String(world.id),
      name: typeof world.name === 'string' ? world.name : 'World',
      bounds: world.bounds as Bounds,
    };
  }, [world]);

  if (loading) {
    return <div style={{ padding: 16, color: 'var(--muted-foreground, #666)' }}>Loading world map…</div>;
  }

  if (error) {
    return (
      <div style={{ padding: 16, color: 'var(--destructive, #b91c1c)' }}>
        {error}
      </div>
    );
  }

  if (!worldMap) {
    return (
      <div style={{ padding: 16 }}>
        No world map found. Try importing one via the Map Manager and refresh this page.
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', width: '100vw' }}>
      <CampaignPrepMap
        worldMap={worldMap}
        spawn={null}
        editingSpawn={false}
        canEditSpawn={false}
        regions={[]}
        highlightPoint={null}
        className="h-screen"
      />
    </div>
  );
}

const root = document.getElementById('root');
if (!root) {
  throw new Error('Missing #root element');
}

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <StandaloneCampaignPrepMap />
  </React.StrictMode>,
);

