# Monitoring & Telemetry

The DM Toolkit backend now exposes structured logs and an in-memory telemetry snapshot so operators can trace the live flows without relying on dummy data.

## Structured Logging

- Every critical DM Toolkit action emits a `logInfo` entry with a `telemetryEvent` field. Examples include `campaign.created`, `campaign.spawn_upserted`, `objective.created`, `objective.assist_generated`, `session.focus_updated`, `npc.sentiment_adjusted`, and the teleport actions.
- Log payloads include stable identifiers (`campaignId`, `objectiveId`, `sessionId`, `userId`, etc.) so they can be fed directly into log aggregation or alerting tools.

## Telemetry Counters & Events

- The server keeps lightweight, in-memory counters and recent events in `server/utils/telemetry.js`.
- Counters currently tracked:
  - `campaigns.created`
  - `campaign_spawns.upserted`
  - `objectives.created`
  - `objectives.updated`
  - `objectives.deleted`
  - `objective_assists.generated`
  - `sessions.focus_updated`
  - `sessions.context_updated`
  - `encounters.unplanned_created`
  - `npc.sentiment_adjusted`
  - `movement.teleport_player`
  - `movement.teleport_npc`
  - `websocket.connections` (gauge)
- `recordEvent` captures up to 200 of the most recent events with timestamped metadata for quick inspection.

## Admin Telemetry Endpoint

- `GET /api/admin/telemetry` (requires admin role) returns the realtime telemetry snapshot:

```json
{
  "generatedAt": "2025-09-23T22:58:12.345Z",
  "counters": {
    "campaigns.created": 1,
    "objectives.created": 2,
    "objective_assists.generated": 1,
    "movement.teleport_player": 1
  },
  "gauges": {
    "websocket.connections": 0
  },
  "recentEvents": [
    {
      "id": "...",
      "type": "objective.assist_generated",
      "timestamp": "2025-09-23T22:58:11.901Z",
      "details": {
        "campaignId": "…",
        "objectiveId": "…",
        "userId": "…",
        "field": "description_md",
        "provider": {
          "name": "stub-provider",
          "model": "stub-model"
        },
        "cacheHit": false
      }
    }
  ]
}
```

- Because the snapshot is in-memory, restart the server after exporting it to reset counters.

## Operational Guidance

- Use the telemetry endpoint for dashboards/alerting (e.g., notify if `objective_assists.generated` spikes or `movement.teleport_player` is called by unexpected users).
- Leverage structured logs for deep forensics; combine `telemetryEvent` filters with `userId` to follow a DM’s session flow.
- Maintain separate collectors if persistent metrics are required; this module is intentionally lightweight for local/edge environments.
