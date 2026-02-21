import { useCallback, useEffect, useMemo, useState } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "./ui/avatar";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
import { Alert, AlertDescription, AlertTitle } from "./ui/alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";
import { Skeleton } from "./ui/skeleton";
import {
  Activity,
  AlertTriangle,
  BarChart3,
  Clock,
  LogOut,
  MapIcon,
  RefreshCw,
  Server,
  TrendingUp,
  Users,
  Sparkles,
  Trash2,
  Zap,
} from "lucide-react";
import { apiFetch, readErrorMessage, readJsonBody } from "../utils/api-client";
import { AdminUserManagement } from "./admin-user-management";
import { AdminModeration } from "./admin-moderation";

interface AdminDashboardProps {
  user: { id: string; username: string; email: string; roles: string[]; role?: string };
  onLogout: () => void;
}

interface AdminMetricsResponse {
  generatedAt: string;
  users: {
    total: number;
    active: number;
    inactive: number;
    banned: number;
    newLastSevenDays: number;
  };
  campaigns: {
    total: number;
    active: number;
    recruiting: number;
    paused: number;
    completed: number;
    newLastSevenDays: number;
  };
  sessions: {
    total: number;
    completed: number;
    scheduled: number;
    active: number;
    cancelled: number;
    averageDurationMinutes: number | null;
  };
}

interface LLMProviderMetric {
  providerName: string | null;
  providerModel: string | null;
  requests: number;
  cacheHits: number;
  cacheMisses: number;
  errors: number;
  averageLatencyMs: number | null;
  averageTimeToFirstByteMs: number | null;
  totalTokens: number;
  lastRequestAt: string | null;
}

interface LLMRecentRequest {
  id: string;
  occurredAt: string;
  providerName: string | null;
  providerModel: string | null;
  type: string | null;
  cacheHit: boolean;
  latencyMs: number | null;
  ttfbMs: number | null;
  totalTokens: number | null;
  error: boolean;
}

interface LLMMetricsResponse {
  generatedAt: string;
  totals: {
    requests: number;
    cacheHits: number;
    cacheMisses: number;
    errors: number;
    cacheEvictions: number;
    cacheSize: number;
    cacheTtlMs: number;
    maxCacheEntries: number;
  };
  providers: LLMProviderMetric[];
  recentRequests: LLMRecentRequest[];
}

interface LLMCacheEntry {
  key: string;
  type: string | null;
  providerName: string | null;
  providerModel: string | null;
  createdAt: string | null;
  lastAccessedAt: string | null;
  expiresAt: string | null;
  ttlRemainingMs: number | null;
}

interface LLMCacheSnapshot {
  generatedAt: string;
  size: number;
  maxEntries: number;
  defaultTtlMs: number;
  entries: LLMCacheEntry[];
}

interface HealthResponse {
  status: string;
  database: string;
  latency: number;
  timestamp: string;
  pool?: {
    totalCount: number;
    idleCount: number;
    waitingCount: number;
  };
}

type LoadState<T> =
  | { status: "idle"; data: T | null; error?: undefined }
  | { status: "loading"; data: T | null; error?: undefined }
  | { status: "loaded"; data: T; error?: undefined }
  | { status: "error"; data: T | null; error: string };

export function AdminDashboard({ user, onLogout }: AdminDashboardProps) {
  const [activeTab, setActiveTab] = useState("overview");
  const [metricsState, setMetricsState] = useState<LoadState<AdminMetricsResponse>>({ status: "idle", data: null });
  const [healthState, setHealthState] = useState<LoadState<HealthResponse>>({ status: "idle", data: null });
  const [llmMetricsState, setLlmMetricsState] = useState<LoadState<LLMMetricsResponse>>({ status: "idle", data: null });
  const [llmCacheState, setLlmCacheState] = useState<LoadState<LLMCacheSnapshot>>({ status: "idle", data: null });
  const [llmCacheMutation, setLlmCacheMutation] = useState<{ status: "idle" | "clearing" | "removing"; cacheKey?: string | null }>({
    status: "idle",
  });

  const loadMetrics = useCallback(async () => {
    setMetricsState((prev) => ({ status: "loading", data: prev.data }));

    try {
      const response = await apiFetch("/api/admin/metrics");
      if (!response.ok) {
        const message = await readErrorMessage(response, "Failed to load admin metrics");
        throw new Error(message);
      }

      const payload = await readJsonBody<AdminMetricsResponse>(response);
      setMetricsState({ status: "loaded", data: payload });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setMetricsState((prev) => ({ status: "error", data: prev.data, error: message }));
    }
  }, []);

  const loadHealth = useCallback(async () => {
    setHealthState((prev) => ({ status: "loading", data: prev.data }));

    try {
      const response = await apiFetch("/api/health");
      if (!response.ok) {
        const message = await readErrorMessage(response, "Health check failed");
        throw new Error(message);
      }

      const payload = await readJsonBody<HealthResponse>(response);
      setHealthState({ status: "loaded", data: payload });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setHealthState((prev) => ({ status: "error", data: prev.data, error: message }));
    }
  }, []);

  const loadLlmMetrics = useCallback(async () => {
    setLlmMetricsState((prev) => ({ status: "loading", data: prev.data }));

    try {
      const response = await apiFetch("/api/admin/llm/metrics");
      if (!response.ok) {
        const message = await readErrorMessage(response, "Failed to load LLM metrics");
        throw new Error(message);
      }
      const payload = await readJsonBody<LLMMetricsResponse>(response);
      setLlmMetricsState({ status: "loaded", data: payload });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setLlmMetricsState((prev) => ({ status: "error", data: prev.data, error: message }));
    }
  }, []);

  const loadLlmCache = useCallback(async () => {
    setLlmCacheState((prev) => ({ status: "loading", data: prev.data }));

    try {
      const response = await apiFetch("/api/admin/llm/cache");
      if (!response.ok) {
        const message = await readErrorMessage(response, "Failed to load LLM cache snapshot");
        throw new Error(message);
      }
      const payload = await readJsonBody<LLMCacheSnapshot>(response);
      setLlmCacheState({ status: "loaded", data: payload });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setLlmCacheState((prev) => ({ status: "error", data: prev.data, error: message }));
    }
  }, []);

  const clearLlmCache = useCallback(async () => {
    if (llmCacheMutation.status !== "idle") {
      return;
    }
    const confirmed = typeof window !== "undefined" ? window.confirm("Clear all cached LLM responses?") : true;
    if (!confirmed) {
      return;
    }

    setLlmCacheMutation({ status: "clearing" });
    try {
      const response = await apiFetch("/api/admin/llm/cache", { method: "DELETE" });
      if (!response.ok) {
        const message = await readErrorMessage(response, "Failed to clear LLM cache");
        throw new Error(message);
      }
      await readJsonBody<Record<string, unknown>>(response);
      await Promise.all([loadLlmCache(), loadLlmMetrics()]);
      setLlmCacheMutation({ status: "idle" });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setLlmCacheMutation({ status: "idle" });
      setLlmCacheState((prev) => ({ status: "error", data: prev.data, error: message }));
    }
  }, [llmCacheMutation.status, loadLlmCache, loadLlmMetrics]);

  const removeCacheEntry = useCallback(
    async (cacheKey: string) => {
      if (llmCacheMutation.status !== "idle") {
        return;
      }

      setLlmCacheMutation({ status: "removing", cacheKey });
      try {
        const response = await apiFetch(`/api/admin/llm/cache/${encodeURIComponent(cacheKey)}`, {
          method: "DELETE",
        });
        if (!response.ok) {
          const message = await readErrorMessage(response, "Failed to remove cache entry");
          throw new Error(message);
        }
        await readJsonBody<Record<string, unknown>>(response);
        await Promise.all([loadLlmCache(), loadLlmMetrics()]);
        setLlmCacheMutation({ status: "idle" });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setLlmCacheMutation({ status: "idle" });
        setLlmCacheState((prev) => ({ status: "error", data: prev.data, error: message }));
      }
    },
    [llmCacheMutation.status, loadLlmCache, loadLlmMetrics],
  );

  useEffect(() => {
    loadMetrics();
    loadHealth();
    loadLlmMetrics();
    loadLlmCache();
  }, [loadMetrics, loadHealth, loadLlmMetrics, loadLlmCache]);

  const healthBadge = useMemo(() => {
    if (healthState.status === "loaded" && healthState.data.status === "healthy") {
      return {
        label: "System healthy",
        className: "text-green-600 border-green-600",
      };
    }

    if (healthState.status === "error") {
      return {
        label: "Health check failed",
        className: "text-red-600 border-red-600",
      };
    }

    if (healthState.status === "loading") {
      return {
        label: "Checking health…",
        className: "text-muted-foreground border-muted-foreground/50",
      };
    }

    return {
      label: "Health unknown",
      className: "text-muted-foreground border-muted-foreground/50",
    };
  }, [healthState]);

  const averageSessionHours = useMemo(() => {
    const minutes = metricsState.data?.sessions.averageDurationMinutes;
    if (typeof minutes !== "number" || Number.isNaN(minutes)) {
      return null;
    }
    return minutes / 60;
  }, [metricsState.data?.sessions.averageDurationMinutes]);

  const formatNumber = (value: number | null | undefined) =>
    typeof value === "number" && Number.isFinite(value) ? value.toLocaleString() : "—";

  const formatMs = (value: number | null | undefined) =>
    typeof value === "number" && Number.isFinite(value) ? `${Math.round(value)} ms` : "—";

  const formatSeconds = (value: number | null | undefined) => {
    if (typeof value !== "number" || Number.isNaN(value)) {
      return "—";
    }
    return `${Math.max(0, Math.round(value / 1000)).toLocaleString()} s`;
  };

  const formatTimestamp = (value: string | null | undefined) =>
    value ? new Date(value).toLocaleString() : "—";

  const providerMetrics = useMemo(() => {
    if (llmMetricsState.status !== "loaded" || !llmMetricsState.data) {
      return [] as LLMProviderMetric[];
    }
    return [...llmMetricsState.data.providers].sort((a, b) => b.requests - a.requests);
  }, [llmMetricsState]);

  const recentRequests = useMemo(() => {
    if (llmMetricsState.status !== "loaded" || !llmMetricsState.data) {
      return [] as LLMRecentRequest[];
    }
    return llmMetricsState.data.recentRequests;
  }, [llmMetricsState]);

  const cacheEntries = useMemo(() => {
    if (llmCacheState.status !== "loaded" || !llmCacheState.data) {
      return [] as LLMCacheEntry[];
    }
    return [...llmCacheState.data.entries].sort((a, b) => {
      const aTime = a.lastAccessedAt || a.createdAt || "";
      const bTime = b.lastAccessedAt || b.createdAt || "";
      return bTime.localeCompare(aTime);
    });
  }, [llmCacheState]);

  const llmTotals = llmMetricsState.status === "loaded" && llmMetricsState.data ? llmMetricsState.data.totals : null;
  const cacheHitRate = useMemo(() => {
    if (!llmTotals || llmTotals.requests === 0) {
      return null;
    }
    return (llmTotals.cacheHits / llmTotals.requests) * 100;
  }, [llmTotals]);

  return (
    <div className="min-h-screen bg-background">
      <div className="border-b bg-card">
        <div className="flex items-center justify-between px-6 py-4">
          <div className="flex items-center gap-4">
            <Avatar className="w-10 h-10">
              <AvatarImage src={`https://avatar.vercel.sh/${user.username}`} />
              <AvatarFallback>{user.username.slice(0, 2).toUpperCase()}</AvatarFallback>
            </Avatar>
            <div>
              <h1 className="font-semibold">System Administrator</h1>
              <p className="text-sm text-muted-foreground">Admin Dashboard • {user.username}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className={healthBadge.className}>
              <Activity className="w-3 h-3 mr-1" />
              {healthBadge.label}
            </Badge>
            <Button variant="ghost" size="sm" onClick={loadHealth} disabled={healthState.status === "loading"}>
              <Server className="w-4 h-4" />
            </Button>
            <Button variant="ghost" size="sm" onClick={onLogout}>
              <LogOut className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </div>

      <div className="p-6">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
          <TabsList>
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="users">Users</TabsTrigger>
            <TabsTrigger value="moderation">Moderation</TabsTrigger>
            <TabsTrigger value="llm">LLM Workloads</TabsTrigger>
            <TabsTrigger value="system">System Health</TabsTrigger>
            <TabsTrigger value="feature-status">Feature Status</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-6">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
              <div>
                <h2 className="text-xl font-semibold">Platform Metrics</h2>
                <p className="text-sm text-muted-foreground">
                  Live counts sourced from `/api/admin/metrics`. Numbers update on demand.
                </p>
              </div>
              <Button onClick={loadMetrics} disabled={metricsState.status === "loading"}>
                {metricsState.status === "loading" ? (
                  <RefreshCw className="w-4 h-4 animate-spin" />
                ) : (
                  <RefreshCw className="w-4 h-4" />
                )}
                <span className="ml-2">Refresh metrics</span>
              </Button>
            </div>

            {metricsState.status === "error" ? (
              <Alert variant="destructive">
                <AlertTriangle className="w-4 h-4" />
                <AlertTitle>Unable to load metrics</AlertTitle>
                <AlertDescription>
                  {metricsState.error}
                </AlertDescription>
              </Alert>
            ) : (
              <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-4">
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Users className="w-5 h-5" />
                      User Accounts
                    </CardTitle>
                    <CardDescription>Totals by status across the platform</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {metricsState.data ? (
                      <>
                        <div className="text-3xl font-bold">
                          {metricsState.data.users.total.toLocaleString()}
                        </div>
                        <p className="text-sm text-muted-foreground">
                          Active: {metricsState.data.users.active.toLocaleString()} • Inactive: {metricsState.data.users.inactive.toLocaleString()} • Banned: {metricsState.data.users.banned.toLocaleString()}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {metricsState.data.users.newLastSevenDays.toLocaleString()} new sign-ups in the last 7 days
                        </p>
                      </>
                    ) : (
                      <Skeleton className="h-24 w-full" />
                    )}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <MapIcon className="w-5 h-5" />
                      Campaigns
                    </CardTitle>
                    <CardDescription>Current campaign inventory and pipeline</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {metricsState.data ? (
                      <>
                        <div className="text-3xl font-bold">
                          {metricsState.data.campaigns.total.toLocaleString()}
                        </div>
                        <p className="text-sm text-muted-foreground">
                          Active: {metricsState.data.campaigns.active.toLocaleString()} • Recruiting: {metricsState.data.campaigns.recruiting.toLocaleString()} • Paused: {metricsState.data.campaigns.paused.toLocaleString()} • Completed: {metricsState.data.campaigns.completed.toLocaleString()}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {metricsState.data.campaigns.newLastSevenDays.toLocaleString()} new campaigns created this week
                        </p>
                      </>
                    ) : (
                      <Skeleton className="h-24 w-full" />
                    )}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <BarChart3 className="w-5 h-5" />
                      Sessions
                    </CardTitle>
                    <CardDescription>Lifecycle of recorded sessions</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {metricsState.data ? (
                      <>
                        <div className="text-3xl font-bold">
                          {metricsState.data.sessions.total.toLocaleString()}
                        </div>
                        <p className="text-sm text-muted-foreground">
                          Completed: {metricsState.data.sessions.completed.toLocaleString()} • Scheduled: {metricsState.data.sessions.scheduled.toLocaleString()} • Active: {metricsState.data.sessions.active.toLocaleString()} • Cancelled: {metricsState.data.sessions.cancelled.toLocaleString()}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Avg duration: {averageSessionHours !== null ? `${averageSessionHours.toFixed(2)}h` : "n/a"}
                        </p>
                      </>
                    ) : (
                      <Skeleton className="h-24 w-full" />
                    )}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Clock className="w-5 h-5" />
                      Data freshness
                    </CardTitle>
                    <CardDescription>Timestamp of the metrics snapshot</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {metricsState.data ? (
                      <>
                        <div className="text-lg font-semibold">
                          {new Date(metricsState.data.generatedAt).toLocaleString()}
                        </div>
                        <p className="text-sm text-muted-foreground">
                          Metrics pulled directly from the PostgreSQL store.
                        </p>
                      </>
                    ) : (
                      <Skeleton className="h-24 w-full" />
                    )}
                  </CardContent>
                </Card>
              </div>
            )}
          </TabsContent>

          <TabsContent value="users" className="space-y-6">
            <AdminUserManagement />
          </TabsContent>

          <TabsContent value="moderation" className="space-y-6">
            <AdminModeration />
          </TabsContent>

          <TabsContent value="llm" className="space-y-6">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <h2 className="text-xl font-semibold">LLM Performance & Cache</h2>
                <p className="text-sm text-muted-foreground">
                  Live telemetry from `/api/admin/llm/metrics` with cache inspection and controls.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" onClick={loadLlmMetrics} disabled={llmMetricsState.status === "loading"}>
                  {llmMetricsState.status === "loading" ? (
                    <RefreshCw className="w-4 h-4 animate-spin" />
                  ) : (
                    <RefreshCw className="w-4 h-4" />
                  )}
                  <span className="ml-2">Refresh metrics</span>
                </Button>
                <Button variant="outline" onClick={loadLlmCache} disabled={llmCacheState.status === "loading"}>
                  {llmCacheState.status === "loading" ? (
                    <Server className="w-4 h-4 animate-spin" />
                  ) : (
                    <Server className="w-4 h-4" />
                  )}
                  <span className="ml-2">Refresh cache</span>
                </Button>
                <Button
                  variant="destructive"
                  onClick={clearLlmCache}
                  disabled={llmCacheMutation.status === "clearing"}
                >
                  {llmCacheMutation.status === "clearing" ? (
                    <Trash2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Trash2 className="w-4 h-4" />
                  )}
                  <span className="ml-2">Clear cache</span>
                </Button>
              </div>
            </div>

            {llmMetricsState.status === "error" && (
              <Alert variant="destructive">
                <AlertTriangle className="w-4 h-4" />
                <AlertTitle>Metrics service unavailable</AlertTitle>
                <AlertDescription>
                  {llmMetricsState.error ?? "Unable to fetch LLM performance metrics."}
                </AlertDescription>
              </Alert>
            )}

            {llmMetricsState.status === "loaded" && llmMetricsState.data ? (
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Sparkles className="w-5 h-5" />
                      Total Requests
                    </CardTitle>
                    <CardDescription>Since service startup</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="text-3xl font-bold">{formatNumber(llmTotals?.requests ?? 0)}</div>
                    <p className="text-sm text-muted-foreground">
                      Cache hits: {formatNumber(llmTotals?.cacheHits ?? 0)} • Misses: {formatNumber(llmTotals?.cacheMisses ?? 0)}
                    </p>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <TrendingUp className="w-5 h-5" />
                      Cache Efficiency
                    </CardTitle>
                    <CardDescription>Hit ratio and eviction statistics</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-1">
                    <div className="text-3xl font-bold">
                      {cacheHitRate !== null ? `${cacheHitRate.toFixed(1)}%` : "—"}
                    </div>
                    <p className="text-sm text-muted-foreground">
                      Evictions: {formatNumber(llmTotals?.cacheEvictions ?? 0)}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Cache size: {formatNumber(llmTotals?.cacheSize ?? 0)} / {formatNumber(llmTotals?.maxCacheEntries ?? 0)} entries
                    </p>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Zap className="w-5 h-5" />
                      Latency & TTFB
                    </CardTitle>
                    <CardDescription>Provider averages (fresh generations)</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {providerMetrics.length > 0 ? (
                      <ul className="space-y-1 text-sm text-muted-foreground">
                        {providerMetrics.slice(0, 2).map((provider) => (
                          <li key={`${provider.providerName}-${provider.providerModel}`}>
                            <span className="font-medium text-foreground">
                              {provider.providerName ?? "default"}
                              {provider.providerModel ? ` · ${provider.providerModel}` : ""}
                            </span>
                            <span className="ml-2">
                              Latency: {formatMs(provider.averageLatencyMs)} • TTFB: {formatMs(provider.averageTimeToFirstByteMs)}
                            </span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-sm text-muted-foreground">No provider activity recorded yet.</p>
                    )}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Clock className="w-5 h-5" />
                      Snapshot time
                    </CardTitle>
                    <CardDescription>When metrics were generated</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="text-lg font-semibold">{formatTimestamp(llmMetricsState.data.generatedAt)}</div>
                    <p className="text-sm text-muted-foreground">
                      Default cache TTL: {formatSeconds(llmTotals?.cacheTtlMs ?? null)}
                    </p>
                  </CardContent>
                </Card>
              </div>
            ) : llmMetricsState.status === "loading" ? (
              <Skeleton className="h-24 w-full" />
            ) : null}

            <Card>
              <CardHeader>
                <CardTitle>Provider Breakdown</CardTitle>
                <CardDescription>Aggregated totals per registered provider/model</CardDescription>
              </CardHeader>
              <CardContent>
                {llmMetricsState.status === "loaded" && providerMetrics.length > 0 ? (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="text-left text-muted-foreground">
                        <tr>
                          <th className="py-2 pr-4">Provider</th>
                          <th className="py-2 pr-4">Requests</th>
                          <th className="py-2 pr-4">Cache hits</th>
                          <th className="py-2 pr-4">Errors</th>
                          <th className="py-2 pr-4">Avg latency</th>
                          <th className="py-2 pr-4">Avg TTFB</th>
                          <th className="py-2">Tokens</th>
                        </tr>
                      </thead>
                      <tbody>
                        {providerMetrics.map((provider) => (
                          <tr key={`${provider.providerName}-${provider.providerModel}`} className="border-t">
                            <td className="py-2 pr-4 font-medium text-foreground">
                              {provider.providerName ?? "default"}
                              {provider.providerModel ? ` · ${provider.providerModel}` : ""}
                            </td>
                            <td className="py-2 pr-4">{formatNumber(provider.requests)}</td>
                            <td className="py-2 pr-4">{formatNumber(provider.cacheHits)}</td>
                            <td className="py-2 pr-4 text-red-600">{formatNumber(provider.errors)}</td>
                            <td className="py-2 pr-4">{formatMs(provider.averageLatencyMs)}</td>
                            <td className="py-2 pr-4">{formatMs(provider.averageTimeToFirstByteMs)}</td>
                            <td className="py-2">{formatNumber(provider.totalTokens)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : llmMetricsState.status === "loading" ? (
                  <Skeleton className="h-32 w-full" />
                ) : (
                  <p className="text-sm text-muted-foreground">No provider metrics available.</p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Recent Requests</CardTitle>
                <CardDescription>Most recent narrative generations and cache hits</CardDescription>
              </CardHeader>
              <CardContent>
                {llmMetricsState.status === "loaded" && recentRequests.length > 0 ? (
                  <ul className="space-y-3 text-sm">
                    {recentRequests.map((request) => (
                      <li
                        key={request.id}
                        className="rounded border bg-muted/40 p-3"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="font-medium text-foreground">
                            {request.type ?? 'unknown'} • {request.providerName ?? 'default'}
                            {request.providerModel ? ` · ${request.providerModel}` : ''}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {formatTimestamp(request.occurredAt)}
                          </span>
                        </div>
                        <div className="mt-1 text-xs text-muted-foreground">
                          Cache hit: {request.cacheHit ? 'yes' : 'no'} • Latency: {formatMs(request.latencyMs)} • TTFB: {formatMs(request.ttfbMs)} • Tokens: {formatNumber(request.totalTokens)}
                          {request.error ? <span className="ml-2 text-red-600">Error flagged</span> : null}
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : llmMetricsState.status === "loading" ? (
                  <Skeleton className="h-24 w-full" />
                ) : (
                  <p className="text-sm text-muted-foreground">No narrative requests observed yet.</p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Cache Entries</CardTitle>
                <CardDescription>Current LLM cache contents with expiry information</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {llmCacheState.status === "error" && (
                  <Alert variant="destructive">
                    <AlertTriangle className="w-4 h-4" />
                    <AlertTitle>Cache inspection unavailable</AlertTitle>
                    <AlertDescription>
                      {llmCacheState.error ?? "Unable to retrieve cache snapshot."}
                    </AlertDescription>
                  </Alert>
                )}

                {llmCacheState.status === "loaded" && cacheEntries.length > 0 ? (
                  <div className="space-y-2">
                    {cacheEntries.map((entry) => {
                      const isRemoving =
                        llmCacheMutation.status === "removing" && llmCacheMutation.cacheKey === entry.key;
                      return (
                        <div key={entry.key} className="flex flex-col gap-2 rounded border bg-muted/40 p-3 md:flex-row md:items-center md:justify-between">
                          <div>
                            <p className="font-medium text-foreground break-all">{entry.key}</p>
                            <p className="text-xs text-muted-foreground">
                              {entry.type ?? 'unknown'} • {entry.providerName ?? 'default'}
                              {entry.providerModel ? ` · ${entry.providerModel}` : ''}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              Created: {formatTimestamp(entry.createdAt)} • Last access: {formatTimestamp(entry.lastAccessedAt)} • Expires: {formatTimestamp(entry.expiresAt)} • TTL remaining: {formatSeconds(entry.ttlRemainingMs)}
                            </p>
                          </div>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => removeCacheEntry(entry.key)}
                            disabled={isRemoving || llmCacheMutation.status === "clearing"}
                          >
                            {isRemoving ? <Trash2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                            <span className="ml-2">Remove</span>
                          </Button>
                        </div>
                      );
                    })}
                  </div>
                ) : llmCacheState.status === "loading" ? (
                  <Skeleton className="h-24 w-full" />
                ) : (
                  <p className="text-sm text-muted-foreground">Cache is currently empty.</p>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="system" className="space-y-6">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
              <div>
                <h2 className="text-xl font-semibold">System health</h2>
                <p className="text-sm text-muted-foreground">Real-time status reported by `/api/health`.</p>
              </div>
              <Button variant="outline" onClick={loadHealth} disabled={healthState.status === "loading"}>
                {healthState.status === "loading" ? (
                  <RefreshCw className="w-4 h-4 animate-spin" />
                ) : (
                  <RefreshCw className="w-4 h-4" />
                )}
                <span className="ml-2">Refresh health</span>
              </Button>
            </div>

            {healthState.status === "error" ? (
              <Alert variant="destructive">
                <AlertTriangle className="w-4 h-4" />
                <AlertTitle>Health check failed</AlertTitle>
                <AlertDescription>{healthState.error}</AlertDescription>
              </Alert>
            ) : (
              <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Server className="w-5 h-5" />
                      API status
                    </CardTitle>
                    <CardDescription>Connectivity between the frontend and database service</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {healthState.data ? (
                      <>
                        <div className="text-lg font-semibold capitalize">{healthState.data.status}</div>
                        <p className="text-sm text-muted-foreground">Database: {healthState.data.database}</p>
                        <p className="text-sm text-muted-foreground">Latency: {healthState.data.latency} ms</p>
                        <p className="text-xs text-muted-foreground">Checked at {new Date(healthState.data.timestamp).toLocaleString()}</p>
                      </>
                    ) : (
                      <Skeleton className="h-24 w-full" />
                    )}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Activity className="w-5 h-5" />
                      Connection pool
                    </CardTitle>
                    <CardDescription>Live PostgreSQL connection counts</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {healthState.data?.pool ? (
                      <>
                        <p className="text-sm text-muted-foreground">Total connections: {healthState.data.pool.totalCount}</p>
                        <p className="text-sm text-muted-foreground">Idle: {healthState.data.pool.idleCount}</p>
                        <p className="text-sm text-muted-foreground">Waiting: {healthState.data.pool.waitingCount}</p>
                      </>
                    ) : (
                      <p className="text-sm text-muted-foreground">No pool metrics reported.</p>
                    )}
                  </CardContent>
                </Card>

                <Card className="md:col-span-2 lg:col-span-1">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <TrendingUp className="w-5 h-5" />
                      Operational notes
                    </CardTitle>
                    <CardDescription>Summary of the latest checks</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <ul className="space-y-2 text-sm text-muted-foreground">
                      <li>• Health checks reflect the live Express server.</li>
                      <li>• Any outage here blocks admin metric refreshes.</li>
                      <li>• Reach out to the backend team if latency keeps increasing.</li>
                    </ul>
                  </CardContent>
                </Card>
              </div>
            )}
          </TabsContent>

          <TabsContent value="feature-status" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Feature availability</CardTitle>
                <CardDescription>Honest status of administrative tooling</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <Alert>
                  <TrendingUp className="w-4 h-4" />
                  <AlertTitle>Metrics</AlertTitle>
                  <AlertDescription>
                    Platform metrics now originate from `/api/admin/metrics` on the live database. No placeholder numbers remain.
                  </AlertDescription>
                </Alert>

                <Alert variant="destructive">
                  <AlertTriangle className="w-4 h-4" />
                  <AlertTitle>User management actions</AlertTitle>
                  <AlertDescription>
                    Bulk moderation (activate/deactivate/ban) still needs dedicated backend endpoints. The previous fake controls have been removed until that support ships.
                  </AlertDescription>
                </Alert>

                <Alert variant="destructive">
                  <AlertTriangle className="w-4 h-4" />
                  <AlertTitle>Player tooling in admin view</AlertTitle>
                  <AlertDescription>
                    The admin dashboard no longer attempts to mirror player dashboards. Those flows stay within their dedicated views to avoid duplicate dummy data.
                  </AlertDescription>
                </Alert>

                <Alert>
                  <Clock className="w-4 h-4" />
                  <AlertTitle>Next steps</AlertTitle>
                  <AlertDescription>
                    Coordinate with the backend team to expose moderation APIs and analytics visualisations. Until then the UI will continue to surface limited but truthful data.
                  </AlertDescription>
                </Alert>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
