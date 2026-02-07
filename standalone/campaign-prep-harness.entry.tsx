import React, { useMemo, useState } from 'react';
import ReactDOM from 'react-dom/client';
import '../styles/globals.css';

import { CampaignPrepMap } from '../components/campaign-prep-map';
import { ObjectivesPanel } from '../components/objectives-panel';
import { CampaignPrep } from '../components/campaign-prep';
import type { Campaign } from '../components/campaign-shared';
import SessionManager from '../components/session-manager';
import { listWorldMaps } from '../utils/api/maps';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { UserProvider } from '../contexts/UserContext';
import { GameSessionProvider } from '../contexts/GameSessionContext';
import { ErrorBoundary } from '../components/error-boundary';

type Bounds = { west: number; south: number; east: number; north: number };

type WorldRecord = Record<string, unknown> & {
  id?: string;
  name?: string;
  bounds?: Bounds;
};

function useWorld() {
  const [state, setState] = React.useState<{
    loading: boolean;
    error: string | null;
    world: WorldRecord | null;
  }>({ loading: true, error: null, world: null });

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setState({ loading: true, error: null, world: null });
        const url = new URL(window.location.href);
        const targetWorldId = url.searchParams.get('worldId');
        const maps = await listWorldMaps();
        if (cancelled) return;
        const items = Array.isArray(maps) ? (maps as WorldRecord[]) : [];
        const byId = items.find((m) => m && typeof m.id === 'string' && m.id === targetWorldId);
        const first = byId ?? items[0] ?? null;
        if (!first || typeof first.id !== 'string' || !first.bounds) {
          setState({ loading: false, error: 'No world maps available or bounds missing.', world: null });
        } else {
          setState({ loading: false, error: null, world: first });
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to load world maps';
        setState({ loading: false, error: message, world: null });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}

type ControlsState = {
  useGrid: boolean;
  wrapInCard: boolean;
  addObjectivesPanel: boolean;
  useProviders: boolean;
  addSessionManager: boolean;
  useCampaignPrep: boolean;
  dmActions: boolean;
  debugOverlays?: boolean;
};

function Controls({
  state,
  onChange,
}: {
  state: ControlsState;
  onChange: (_partial: Partial<ControlsState>) => void;
}) {
  return (
    <div style={{ padding: 12, borderBottom: '1px solid var(--border, #e5e7eb)', display: 'flex', gap: 16, flexWrap: 'wrap' }}>
      <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <input
          type="checkbox"
          checked={state.useGrid}
          onChange={(e) => onChange({ useGrid: e.target.checked })}
        />
        Use grid layout (like editor)
      </label>
      <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <input
          type="checkbox"
          checked={state.wrapInCard}
          onChange={(e) => onChange({ wrapInCard: e.target.checked })}
        />
        Wrap map in Card
      </label>
      <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <input
          type="checkbox"
          checked={state.addObjectivesPanel}
          onChange={(e) => {
            const add = e.target.checked;
            onChange({ addObjectivesPanel: add, useProviders: add || state.useProviders });
          }}
        />
        Add ObjectivesPanel (requires providers)
      </label>
      <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <input
          type="checkbox"
          checked={state.addSessionManager}
          onChange={(e) => {
            const add = e.target.checked;
            onChange({ addSessionManager: add, useProviders: add || state.useProviders });
          }}
        />
        Add SessionManager (requires providers + ?campaignId=)
      </label>
      <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <input
          type="checkbox"
          checked={state.useCampaignPrep}
          onChange={(e) => {
            const add = e.target.checked;
            onChange({ useCampaignPrep: add, useProviders: add || state.useProviders });
          }}
        />
        Use full CampaignPrep (left + right)
      </label>
      <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <input
          type="checkbox"
          checked={state.dmActions}
          onChange={(e) => onChange({ dmActions: e.target.checked })}
        />
        Enable DM actions
      </label>
      <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <input
          type="checkbox"
          checked={Boolean(state.debugOverlays)}
          onChange={(e) => onChange({ debugOverlays: e.target.checked })}
        />
        Debug overlays
      </label>
      <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <input
          type="checkbox"
          checked={state.useProviders}
          onChange={(e) => onChange({ useProviders: e.target.checked })}
        />
        Wrap with User + GameSession providers
      </label>
    </div>
  );
}

function MapOnly({ worldMap }: { worldMap: { id: string; name: string; bounds: Bounds } }) {
  return (
    <CampaignPrepMap
      worldMap={worldMap}
      spawn={null}
      editingSpawn={false}
      canEditSpawn={false}
      regions={[]}
      highlightPoint={null}
      className="h-[70vh]"
    />
  );
}

function GridHarness({
  worldMap,
  addObjectivesPanel,
  useProviders,
  wrapInCard,
  addSessionManager,
  dmActions,
}: {
  worldMap: { id: string; name: string; bounds: Bounds };
  addObjectivesPanel: boolean;
  useProviders: boolean;
  wrapInCard: boolean;
  addSessionManager: boolean;
  dmActions: boolean;
}) {
  const url = new URL(window.location.href);
  const campaignId = url.searchParams.get('campaignId') || '';
  const dmParam = url.searchParams.get('dm') === '1';
  const isDm = dmActions || dmParam;
  const left = (
    wrapInCard ? (
      <Card>
        <CardHeader>
          <CardTitle>Campaign Prep Map (Harness)</CardTitle>
        </CardHeader>
        <CardContent>
          <MapOnly worldMap={worldMap} />
        </CardContent>
      </Card>
    ) : (
      <MapOnly worldMap={worldMap} />
    )
  );

  const right = addObjectivesPanel ? (
    <div className="flex h-full flex-col overflow-hidden">
      <ObjectivesPanel
        campaign={null}
        canEdit={false}
        worldMap={worldMap}
        worldMapLoading={false}
        worldMapError={null}
        regions={[]}
      />
    </div>
  ) : null;

  const content = (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,4fr)_minmax(0,2.3fr)] xl:items-start">
      <div className="space-y-4">
        {left}
        {addSessionManager ? (
          campaignId ? (
            <SessionManager campaignId={campaignId} isDM={isDm} />
          ) : (
            <Card>
              <CardHeader>
                <CardTitle>SessionManager requires a campaignId</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-sm text-muted-foreground">
                  Append <code>?campaignId=&lt;uuid&gt;</code> to the URL to load sessions. Use the "Enable DM actions" toggle above (or add <code>&dm=1</code>) to allow DM operations.
                </div>
              </CardContent>
            </Card>
          )
        ) : null}
      </div>
      {right}
    </div>
  );

  if (!useProviders) return content;
  return (
    <UserProvider>
      <GameSessionProvider>{content}</GameSessionProvider>
    </UserProvider>
  );
}

function buildHarnessCampaign(
  worldMap: { id: string; name: string; bounds: Bounds },
  campaignId: string | null,
): Campaign {
  const now = new Date().toISOString();
  return {
    id: campaignId || 'harness-campaign',
    name: 'Harness Campaign',
    description: null,
    dm_user_id: 'harness-dm',
    system: 'D&D 5e',
    setting: 'Demo',
    status: 'active',
    max_players: 6,
    level_range: { min: 1, max: 20 },
    is_public: false,
    world_map_id: worldMap.id,
    created_at: now,
    updated_at: now,
  } as Campaign;
}

function Harness() {
  const { loading, error, world } = useWorld();
  const worldMap = useMemo(() => {
    if (!world) return null;
    return {
      id: String(world.id),
      name: typeof world.name === 'string' ? world.name : 'World',
      bounds: world.bounds as Bounds,
    };
  }, [world]);

  const [state, setState] = useState({
    useGrid: false,
    wrapInCard: false,
    addObjectivesPanel: false,
    useProviders: false,
    addSessionManager: false,
    useCampaignPrep: false,
    dmActions: false,
    debugOverlays: false,
  });

  if (loading) return <div style={{ padding: 16 }}>Loading…</div>;
  if (error) return <div style={{ padding: 16, color: 'var(--destructive, #b91c1c)' }}>{error}</div>;
  if (!worldMap) return <div style={{ padding: 16 }}>No world map available.</div>;

  return (
    <div className="min-h-screen bg-background">
      <Controls state={state} onChange={(next) => setState((s) => ({ ...s, ...next }))} />
      <ErrorBoundary>
        <div className="p-4">
          {state.useCampaignPrep ? (
            state.useProviders ? (
              <UserProvider>
                <GameSessionProvider>
                  <CampaignPrep
                    campaign={buildHarnessCampaign(worldMap, new URL(window.location.href).searchParams.get('campaignId'))}
                    viewerOverride={state.dmActions ? { id: 'harness-dm', roles: ['dm'] } : { id: 'harness-user', roles: ['player'] }}
                    worldMapOverride={worldMap}
                    spawnOverride={new URL(window.location.href).searchParams.get('campaignId') ? undefined : null}
                    mapComponent={(props) => (
                      <CampaignPrepMap
                        {...props}
                        className={`${props.className ? props.className + ' ' : ''}h-[70vh]`}
                      />
                    )}
                  />
                </GameSessionProvider>
              </UserProvider>
            ) : (
              <div className="rounded-md border p-4 text-sm text-muted-foreground">
                CampaignPrep requires providers. Enable "Wrap with User + GameSession providers".
              </div>
            )
          ) : state.useGrid ? (
            <GridHarness
              worldMap={worldMap}
              addObjectivesPanel={state.addObjectivesPanel}
              useProviders={state.useProviders}
              wrapInCard={state.wrapInCard}
              addSessionManager={state.addSessionManager}
              dmActions={state.dmActions}
            />
          ) : (
            <MapOnly worldMap={worldMap} />
          )}
          {state.debugOverlays ? <OverlayDebugger /> : null}
        </div>
      </ErrorBoundary>
    </div>
  );
}

function OverlayDebugger() {
  const [snap, setSnap] = React.useState<Array<{ selector: string; slot?: string | null; state?: string | null; z: string; pe: string; bg: string; rect: string }>>([]);

  React.useEffect(() => {
    const selectors = [
      '[data-slot="dialog-overlay"]',
      '[data-slot="alert-dialog-overlay"]',
      '[data-slot="drawer-overlay"]',
    ];

    const highlight = () => {
      const overlayNodes = Array.from(document.querySelectorAll<HTMLElement>(selectors.join(',')));
      const all = Array.from(document.body.querySelectorAll<HTMLElement>('*'));
      const fixedCandidates = all.filter((el) => {
        const cs = window.getComputedStyle(el);
        if (cs.position !== 'fixed') return false;
        const r = el.getBoundingClientRect();
        const area = Math.max(0, r.width) * Math.max(0, r.height);
        const viewportArea = window.innerWidth * window.innerHeight;
        return area > viewportArea * 0.5;
      });

      const nodes = Array.from(new Set([...overlayNodes, ...fixedCandidates]));
      const items = nodes.map((el) => {
        const r = el.getBoundingClientRect();
        const cs = window.getComputedStyle(el);
        el.style.outline = '2px dashed #f59e0b';
        el.style.outlineOffset = '-2px';
        return {
          selector: el.tagName.toLowerCase() + (el.id ? `#${el.id}` : '') + (el.className ? `.${String(el.className).split(' ').filter(Boolean).slice(0,3).join('.')}` : ''),
          slot: el.getAttribute('data-slot'),
          state: el.getAttribute('data-state'),
          z: cs.zIndex,
          pe: cs.pointerEvents,
          bg: cs.backgroundColor,
          rect: `${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.width)}x${Math.round(r.height)}`,
        };
      });
      setSnap(items);
      console.debug('[Harness] Overlay snapshot:', items);
    };

    const interval = window.setInterval(highlight, 500);
    highlight();
    return () => {
      window.clearInterval(interval);
      const nodes = Array.from(document.querySelectorAll<HTMLElement>(selectors.join(',')));
      nodes.forEach((el) => {
        el.style.outline = '';
        el.style.outlineOffset = '' as unknown as string;
      });
    };
  }, []);

  return (
    <div style={{ position: 'fixed', right: 12, bottom: 12, zIndex: 99999, pointerEvents: 'none' }}>
      <div style={{ background: 'rgba(15,23,42,0.9)', color: 'white', padding: '8px 10px', borderRadius: 6, minWidth: 260 }}>
        <div style={{ fontWeight: 600, fontSize: 12, marginBottom: 6 }}>Overlay Debugger</div>
        {snap.length === 0 ? (
          <div style={{ fontSize: 12, opacity: 0.8 }}>No overlays detected</div>
        ) : (
          <div style={{ display: 'grid', gap: 4 }}>
            {snap.map((o, i) => (
              <div key={i} style={{ fontSize: 12 }}>
                <span style={{ opacity: 0.8 }}>{o.selector}</span>
                {o.slot ? <span style={{ marginLeft: 6 }}>[{o.slot}]</span> : null}
                {o.state ? <span style={{ marginLeft: 6 }}>state: <b>{o.state}</b></span> : null}
                <span style={{ marginLeft: 6 }}>z:{o.z || 'auto'}</span>
                <span style={{ marginLeft: 6 }}>pe:{o.pe}</span>
                <span style={{ marginLeft: 6 }}>{o.bg}</span>
                <span style={{ marginLeft: 6, opacity: 0.8 }}>{o.rect}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <Harness />
  </React.StrictMode>,
);
