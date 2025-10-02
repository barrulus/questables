import { createContext, ReactNode, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { fetchJson, getCampaign } from '../utils/api-client';
import type { CampaignRecord } from '../utils/api-client';
import { useUser } from './UserContext';

const ACTIVE_CAMPAIGN_STORAGE_KEY = 'dnd-active-campaign';

interface LevelRange {
  min: number;
  max: number;
}

interface CampaignMetadata {
  id: string;
  name: string;
  status: string;
  system: string;
  setting?: string;
  dmUserId: string;
  dmUsername?: string;
  levelRange?: LevelRange;
  maxPlayers?: number;
  currentPlayers?: number;
  allowSpectators?: boolean;
  autoApproveJoinRequests?: boolean;
  lastActivity?: string;
  visibilityRadius?: number;
}

interface SessionMetadata {
  id: string;
  sessionNumber: number;
  title: string;
  status: string;
  scheduledAt?: string;
  startedAt?: string;
  endedAt?: string;
  durationMinutes?: number;
}

interface GameSessionContextValue {
  activeCampaignId: string | null;
  activeCampaign: CampaignMetadata | null;
  latestSession: SessionMetadata | null;
  loading: boolean;
  error: string | null;
  selectCampaign: (_campaignId: string | null) => Promise<void>;
  refreshActiveCampaign: () => Promise<void>;
  playerVisibilityRadius: number | null;
  viewerRole: string | null;
  updateVisibilityMetadata: (_metadata: { radius?: number | null; viewerRole?: string | null } | null) => void;
}

type RawCampaignRow = CampaignRecord;

interface RawSessionRow {
  id: string;
  campaign_id: string;
  session_number: number;
  title: string;
  summary?: string | null;
  dm_notes?: string | null;
  scheduled_at?: string | null;
  started_at?: string | null;
  ended_at?: string | null;
  duration?: number | null;
  experience_awarded?: number | null;
  status: string;
  created_at?: string | null;
  updated_at?: string | null;
  participant_count?: number | null;
}

type GameSessionState = {
  activeCampaignId: string | null;
  activeCampaign: CampaignMetadata | null;
  latestSession: SessionMetadata | null;
  loading: boolean;
  error: string | null;
  visibilityRadius: number | null;
  viewerRole: string | null;
};

const initialState: GameSessionState = {
  activeCampaignId: null,
  activeCampaign: null,
  latestSession: null,
  loading: false,
  error: null,
  visibilityRadius: null,
  viewerRole: null,
};

const GameSessionContext = createContext<GameSessionContextValue | undefined>(undefined);

function parseJsonField<T>(value: unknown, field: string): T | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }

  if (typeof value === 'object') {
    return value as T;
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) {
      return undefined;
    }

    try {
      return JSON.parse(trimmed) as T;
    } catch (error) {
      throw new Error(`[GameSession] Failed to parse ${field}: ${(error as Error).message}`);
    }
  }

  throw new Error(`[GameSession] ${field} has unsupported type ${typeof value}`);
}

function normalizeCampaign(row: RawCampaignRow): CampaignMetadata {
  if (!row || typeof row !== 'object') {
    throw new Error('[GameSession] Invalid campaign payload received');
  }

  const levelRange = parseJsonField<LevelRange>(row.level_range, 'campaign.level_range');

  return {
    id: row.id,
    name: row.name,
    status: row.status,
    system: row.system ?? 'Unknown system',
    setting: row.setting ?? undefined,
    dmUserId: row.dm_user_id,
    dmUsername: row.dm_username ?? undefined,
    levelRange: levelRange ?? undefined,
    maxPlayers: row.max_players ?? undefined,
    currentPlayers: undefined,
    allowSpectators: row.allow_spectators ?? undefined,
    autoApproveJoinRequests: row.auto_approve_join_requests ?? undefined,
    lastActivity: row.last_activity ?? undefined,
    visibilityRadius: typeof row.visibility_radius === 'number' ? row.visibility_radius : undefined,
  };
}

function normalizeSession(row: RawSessionRow): SessionMetadata {
  if (!row || typeof row !== 'object') {
    throw new Error('[GameSession] Invalid session payload received');
  }

  return {
    id: row.id,
    sessionNumber: row.session_number,
    title: row.title,
    status: row.status,
    scheduledAt: row.scheduled_at ?? undefined,
    startedAt: row.started_at ?? undefined,
    endedAt: row.ended_at ?? undefined,
    durationMinutes: row.duration ?? undefined,
  };
}

function chooseSessionForHeader(rows: RawSessionRow[]): RawSessionRow | undefined {
  if (!Array.isArray(rows) || rows.length === 0) {
    return undefined;
  }

  const activeSession = rows.find((session) => session.status === 'active');
  if (activeSession) {
    return activeSession;
  }

  const upcomingSessions = rows
    .filter((session) => session.status === 'scheduled')
    .sort((a, b) => {
      const aTime = a.scheduled_at ? new Date(a.scheduled_at).getTime() : Number.POSITIVE_INFINITY;
      const bTime = b.scheduled_at ? new Date(b.scheduled_at).getTime() : Number.POSITIVE_INFINITY;
      return aTime - bTime;
    });

  if (upcomingSessions.length > 0) {
    return upcomingSessions[0];
  }

  return rows[0];
}

export function GameSessionProvider({ children }: { children: ReactNode }) {
  const { user } = useUser();
  const [state, setState] = useState<GameSessionState>(initialState);
  const activeRequest = useRef<AbortController | null>(null);

  const loadCampaignMetadata = useCallback(async (campaignId: string) => {
    if (!campaignId) {
      setState(initialState);
      return;
    }

    if (activeRequest.current) {
      activeRequest.current.abort();
    }

    const controller = new AbortController();
    activeRequest.current = controller;

    setState((previous) => ({
      ...previous,
      activeCampaignId: campaignId,
      loading: true,
      error: null,
    }));

    try {
      const [campaignRow, sessionsPayload] = await Promise.all([
        getCampaign(campaignId, { signal: controller.signal }),
        fetchJson<RawSessionRow[]>(
          `/api/campaigns/${campaignId}/sessions`,
          { signal: controller.signal },
          'Failed to load campaign sessions'
        ).catch((error) => {
          // If sessions endpoint fails, log error but continue with campaign metadata.
          console.error('[GameSession] Failed to load sessions:', error);
          return [] as RawSessionRow[];
        }),
      ]);

      if (controller.signal.aborted) {
        return;
      }

      const normalizedCampaign = normalizeCampaign(campaignRow);
      const sessionsArray = Array.isArray(sessionsPayload) ? sessionsPayload : [];
      const sessionForHeader = chooseSessionForHeader(sessionsArray);
      const normalizedSession = sessionForHeader ? normalizeSession(sessionForHeader) : null;

      if (typeof window !== 'undefined') {
        window.localStorage.setItem(ACTIVE_CAMPAIGN_STORAGE_KEY, campaignId);
      }

      setState({
        activeCampaignId: campaignId,
        activeCampaign: normalizedCampaign,
        latestSession: normalizedSession,
        loading: false,
        error: null,
        visibilityRadius: normalizedCampaign.visibilityRadius ?? null,
        viewerRole: null,
      });
    } catch (error) {
      if (controller.signal.aborted) {
        return;
      }

      const message = error instanceof Error ? error.message : 'Failed to load campaign metadata';
      console.error('[GameSession] Campaign metadata load failed:', error);

      setState({
        activeCampaignId: campaignId,
        activeCampaign: null,
        latestSession: null,
        loading: false,
        error: message,
        visibilityRadius: null,
        viewerRole: null,
      });
    }
  }, []);

  const selectCampaign = useCallback(async (campaignId: string | null) => {
    if (!campaignId) {
      if (activeRequest.current) {
        activeRequest.current.abort();
        activeRequest.current = null;
      }

      if (typeof window !== 'undefined') {
        window.localStorage.removeItem(ACTIVE_CAMPAIGN_STORAGE_KEY);
      }

      setState(initialState);
      return;
    }

    await loadCampaignMetadata(campaignId);
  }, [loadCampaignMetadata]);

  const refreshActiveCampaign = useCallback(async () => {
    if (state.activeCampaignId) {
      await loadCampaignMetadata(state.activeCampaignId);
    }
  }, [loadCampaignMetadata, state.activeCampaignId]);

  const updateVisibilityMetadata = useCallback((metadata: { radius?: number | null; viewerRole?: string | null } | null) => {
    setState((prev) => {
      const hasRadius = metadata ? Object.prototype.hasOwnProperty.call(metadata, 'radius') : false;
      const hasViewerRole = metadata ? Object.prototype.hasOwnProperty.call(metadata, 'viewerRole') : false;
      return {
        ...prev,
        visibilityRadius: hasRadius ? (metadata?.radius ?? null) : prev.visibilityRadius,
        viewerRole: hasViewerRole ? (metadata?.viewerRole ?? null) : prev.viewerRole,
      };
    });
  }, []);

  useEffect(() => {
    return () => {
      if (activeRequest.current) {
        activeRequest.current.abort();
        activeRequest.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!user) {
      if (activeRequest.current) {
        activeRequest.current.abort();
        activeRequest.current = null;
      }

      if (typeof window !== 'undefined') {
        window.localStorage.removeItem(ACTIVE_CAMPAIGN_STORAGE_KEY);
      }

      setState(initialState);
      return;
    }

    if (typeof window === 'undefined') {
      return;
    }

    const storedCampaignId = window.localStorage.getItem(ACTIVE_CAMPAIGN_STORAGE_KEY);
    if (storedCampaignId) {
      void loadCampaignMetadata(storedCampaignId);
    } else {
      setState((previous) => ({
        ...previous,
        activeCampaignId: null,
        activeCampaign: null,
        latestSession: null,
        error: null,
      }));
    }
  }, [user, loadCampaignMetadata]);

  const value: GameSessionContextValue = {
    activeCampaignId: state.activeCampaignId,
    activeCampaign: state.activeCampaign,
    latestSession: state.latestSession,
    loading: state.loading,
    error: state.error,
    selectCampaign,
    refreshActiveCampaign,
    playerVisibilityRadius: state.visibilityRadius,
    viewerRole: state.viewerRole,
    updateVisibilityMetadata,
  };

  return (
    <GameSessionContext.Provider value={value}>
      {children}
    </GameSessionContext.Provider>
  );
}

export function useGameSession(): GameSessionContextValue {
  const context = useContext(GameSessionContext);
  if (!context) {
    throw new Error('useGameSession must be used within a GameSessionProvider');
  }
  return context;
}
