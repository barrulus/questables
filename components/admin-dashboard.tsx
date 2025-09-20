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
} from "lucide-react";
import { apiFetch, readErrorMessage, readJsonBody } from "../utils/api-client";

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

  useEffect(() => {
    loadMetrics();
    loadHealth();
  }, [loadMetrics, loadHealth]);

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
