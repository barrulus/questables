import { useCallback, useEffect, useMemo, useState } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "./ui/avatar";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
import { Alert, AlertDescription, AlertTitle } from "./ui/alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";
import { Skeleton } from "./ui/skeleton";
import { Activity, AlertTriangle, Clock, LogOut, RefreshCw, Server, TrendingUp } from "lucide-react";
import { apiFetch, readErrorMessage, readJsonBody } from "../utils/api-client";
import { AdminUserManagement } from "./admin-user-management";
import { AdminModeration } from "./admin-moderation";
import { AdminOverviewTab, type AdminMetricsResponse } from "./admin-overview-tab";
import { AdminLLMWorkloadsTab, type LLMMetricsResponse, type LLMCacheSnapshot } from "./admin-llm-workloads-tab";
import { AdminLLMConfigTab } from "./admin-llm-config-tab";

interface AdminDashboardProps {
  user: { id: string; username: string; email: string; roles: string[]; role?: string };
  onLogout: () => void;
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
    if (llmCacheMutation.status !== "idle") return;
    const confirmed = typeof window !== "undefined" ? window.confirm("Clear all cached LLM responses?") : true;
    if (!confirmed) return;

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
      if (llmCacheMutation.status !== "idle") return;

      setLlmCacheMutation({ status: "removing", cacheKey });
      try {
        const response = await apiFetch(`/api/admin/llm/cache/${encodeURIComponent(cacheKey)}`, { method: "DELETE" });
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
      return { label: "System healthy", className: "text-green-600 border-green-600" };
    }
    if (healthState.status === "error") {
      return { label: "Health check failed", className: "text-red-600 border-red-600" };
    }
    if (healthState.status === "loading") {
      return { label: "Checking health\u2026", className: "text-muted-foreground border-muted-foreground/50" };
    }
    return { label: "Health unknown", className: "text-muted-foreground border-muted-foreground/50" };
  }, [healthState]);

  const averageSessionHours = useMemo(() => {
    const minutes = metricsState.data?.sessions.averageDurationMinutes;
    if (typeof minutes !== "number" || Number.isNaN(minutes)) return null;
    return minutes / 60;
  }, [metricsState.data?.sessions.averageDurationMinutes]);

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
            <TabsTrigger value="llm-config">LLM Configuration</TabsTrigger>
            <TabsTrigger value="system">System Health</TabsTrigger>
            <TabsTrigger value="feature-status">Feature Status</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-6">
            <AdminOverviewTab
              metricsState={metricsState}
              loadMetrics={loadMetrics}
              averageSessionHours={averageSessionHours}
            />
          </TabsContent>

          <TabsContent value="users" className="space-y-6">
            <AdminUserManagement />
          </TabsContent>

          <TabsContent value="moderation" className="space-y-6">
            <AdminModeration />
          </TabsContent>

          <TabsContent value="llm" className="space-y-6">
            <AdminLLMWorkloadsTab
              llmMetricsState={llmMetricsState}
              llmCacheState={llmCacheState}
              llmCacheMutation={llmCacheMutation}
              loadLlmMetrics={loadLlmMetrics}
              loadLlmCache={loadLlmCache}
              clearLlmCache={clearLlmCache}
              removeCacheEntry={removeCacheEntry}
            />
          </TabsContent>

          <TabsContent value="llm-config" className="space-y-6">
            <AdminLLMConfigTab />
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
