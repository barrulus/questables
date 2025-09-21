# LLM Monitoring & Cache Governance

The Enhanced LLM Service now exposes live metrics and cache controls so administrators can audit generation performance and flush cached narratives without restarting the server. All endpoints require an authenticated admin session and respond with JSON only—no dummy payloads are returned.

## HTTP Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/admin/llm/metrics` | Returns aggregate counters (total requests, cache hits/misses, error count, cache evictions), per-provider averages (latency, time to first byte, token usage) and the last 25 requests. |
| `GET` | `/api/admin/llm/cache` | Provides a cache snapshot including entry keys, provider/model, created/last accessed timestamps, expiry times, and remaining TTL. |
| `DELETE` | `/api/admin/llm/cache` | Clears the entire cache and records an audit log entry including the acting admin and number of entries removed. |
| `DELETE` | `/api/admin/llm/cache/:cacheKey` | Removes a single cache entry by key; returns `404` if the key is not tracked. |

All endpoints surface 500-level responses when the underlying provider is unavailable—the admin UI reflects these failures as “Metrics service unavailable” or “Cache inspection unavailable.”

## Metric Fields

`GET /api/admin/llm/metrics` returns:

- `totals.requests` — total generation attempts since process start (includes cache hits and misses).
- `totals.cacheHits` / `totals.cacheMisses` — cache performance counters.
- `totals.errors` — provider or orchestration failures (no silent fallbacks).
- `totals.cacheEvictions` — number of cache entries removed via eviction, expiry, or manual invalidation.
- `totals.cacheSize`, `totals.cacheTtlMs`, `totals.maxCacheEntries` — current cache usage & configuration.
- `providers[]` — per provider/model breakdown with average latency, time-to-first-byte, and aggregate token usage.
- `recentRequests[]` — chronological list of the 25 most recent requests (hit/miss, latency, tokens, error flag).

`GET /api/admin/llm/cache` returns the current cache contents. Each entry includes:

- `key` — SHA-256 cache key.
- `type` — narrative type associated with the entry.
- `providerName` / `providerModel` — provider metadata stored alongside the response.
- `createdAt` / `lastAccessedAt` — UTC timestamps.
- `expiresAt` / `ttlRemainingMs` — expiry data computed from the configured TTL.

## Admin Dashboard

The `AdminDashboard` now displays an **LLM Workloads** tab powered entirely by the live endpoints above:

- Total request counters and cache efficiency (hit rate, evictions, current size).
- Provider averages for latency and first tokens.
- Recent request ledger mirroring the backend payload (no prose embellishments).
- Cache inspector with per-entry removal and a destructive “Clear cache” action (both wired to the new DELETE routes).
- Error states surface backend messages verbatim so admins see when telemetry is unavailable.

## Verification

With Ollama reachable at `http://192.168.1.34:11434` and the database server at `https://quixote.tail3f19fe.ts.net:3001`, run:

```bash
LLM_PROVIDER=ollama \
LLM_OLLAMA_HOST=http://192.168.1.34:11434 \
LLM_OLLAMA_MODEL=qwen3:8b \
LIVE_API_BASE_URL=https://quixote.tail3f19fe.ts.net:3001 \
LIVE_API_ADMIN_EMAIL=b@rry.im \
LIVE_API_ADMIN_PASSWORD=barrulus \
npm test -- --runTestsByPath tests/narrative-api.integration.test.js --runInBand
```

The suite logs into the live backend, exercises the narrative endpoints, and asserts that the new LLM metrics and cache routes respond successfully. Use the same credentials to `curl` the endpoints for ad-hoc audits.
