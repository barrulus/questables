import { useMemo } from "react";
import { Alert, AlertDescription, AlertTitle } from "./ui/alert";
import { Button } from "./ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
import { Skeleton } from "./ui/skeleton";
import { AlertTriangle, Clock, RefreshCw, Server, Sparkles, Trash2, TrendingUp, Zap } from "lucide-react";

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

type LoadState<T> =
  | { status: "idle"; data: T | null; error?: undefined }
  | { status: "loading"; data: T | null; error?: undefined }
  | { status: "loaded"; data: T; error?: undefined }
  | { status: "error"; data: T | null; error: string };

interface AdminLLMWorkloadsTabProps {
  llmMetricsState: LoadState<LLMMetricsResponse>;
  llmCacheState: LoadState<LLMCacheSnapshot>;
  llmCacheMutation: { status: "idle" | "clearing" | "removing"; cacheKey?: string | null };
  loadLlmMetrics: () => void;
  loadLlmCache: () => void;
  clearLlmCache: () => void;
  removeCacheEntry: (key: string) => void;
}

export type { LLMMetricsResponse, LLMCacheSnapshot, LLMProviderMetric, LLMRecentRequest, LLMCacheEntry };

const formatNumber = (value: number | null | undefined) =>
  typeof value === "number" && Number.isFinite(value) ? value.toLocaleString() : "\u2014";

const formatMs = (value: number | null | undefined) =>
  typeof value === "number" && Number.isFinite(value) ? `${Math.round(value)} ms` : "\u2014";

const formatSeconds = (value: number | null | undefined) => {
  if (typeof value !== "number" || Number.isNaN(value)) return "\u2014";
  return `${Math.max(0, Math.round(value / 1000)).toLocaleString()} s`;
};

const formatTimestamp = (value: string | null | undefined) =>
  value ? new Date(value).toLocaleString() : "\u2014";

export function AdminLLMWorkloadsTab({
  llmMetricsState,
  llmCacheState,
  llmCacheMutation,
  loadLlmMetrics,
  loadLlmCache,
  clearLlmCache,
  removeCacheEntry,
}: AdminLLMWorkloadsTabProps) {
  const llmTotals = llmMetricsState.status === "loaded" && llmMetricsState.data ? llmMetricsState.data.totals : null;

  const cacheHitRate = useMemo(() => {
    if (!llmTotals || llmTotals.requests === 0) return null;
    return (llmTotals.cacheHits / llmTotals.requests) * 100;
  }, [llmTotals]);

  const providerMetrics = useMemo(() => {
    if (llmMetricsState.status !== "loaded" || !llmMetricsState.data) return [] as LLMProviderMetric[];
    return [...llmMetricsState.data.providers].sort((a, b) => b.requests - a.requests);
  }, [llmMetricsState]);

  const recentRequests = useMemo(() => {
    if (llmMetricsState.status !== "loaded" || !llmMetricsState.data) return [] as LLMRecentRequest[];
    return llmMetricsState.data.recentRequests;
  }, [llmMetricsState]);

  const cacheEntries = useMemo(() => {
    if (llmCacheState.status !== "loaded" || !llmCacheState.data) return [] as LLMCacheEntry[];
    return [...llmCacheState.data.entries].sort((a, b) => {
      const aTime = a.lastAccessedAt || a.createdAt || "";
      const bTime = b.lastAccessedAt || b.createdAt || "";
      return bTime.localeCompare(aTime);
    });
  }, [llmCacheState]);

  return (
    <div className="space-y-6">
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
                {cacheHitRate !== null ? `${cacheHitRate.toFixed(1)}%` : "\u2014"}
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
                        {provider.providerModel ? ` \u00b7 ${provider.providerModel}` : ""}
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
                        {provider.providerModel ? ` \u00b7 ${provider.providerModel}` : ""}
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
                <li key={request.id} className="rounded border bg-muted/40 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium text-foreground">
                      {request.type ?? 'unknown'} • {request.providerName ?? 'default'}
                      {request.providerModel ? ` \u00b7 ${request.providerModel}` : ''}
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
                        {entry.providerModel ? ` \u00b7 ${entry.providerModel}` : ''}
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
    </div>
  );
}
