import { Alert, AlertDescription, AlertTitle } from "./ui/alert";
import { Button } from "./ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
import { Skeleton } from "./ui/skeleton";
import { AlertTriangle, BarChart3, Clock, MapIcon, RefreshCw, Users } from "lucide-react";

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

type LoadState<T> =
  | { status: "idle"; data: T | null; error?: undefined }
  | { status: "loading"; data: T | null; error?: undefined }
  | { status: "loaded"; data: T; error?: undefined }
  | { status: "error"; data: T | null; error: string };

interface AdminOverviewTabProps {
  metricsState: LoadState<AdminMetricsResponse>;
  loadMetrics: () => void;
  averageSessionHours: number | null;
}

export type { AdminMetricsResponse };

export function AdminOverviewTab({ metricsState, loadMetrics, averageSessionHours }: AdminOverviewTabProps) {
  return (
    <div className="space-y-6">
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
    </div>
  );
}
