# Questables Documentation

Subsystem documentation for Questables. Start with the [project README](../README.md) for the
overview, quick start, and configuration; these guides go a level deeper.

## Guides

| Document | Description |
|----------|-------------|
| [Architecture](./architecture.md) | System overview, tech stack, application states, key decisions |
| [Database Schema](./database-schema.md) | PostgreSQL tables, relationships, indexes |
| [Frontend Guide](./frontend-guide.md) | React components, state management, UI patterns |
| [Mapping System](./mapping-system.md) | OpenLayers integration, layers, projections, PostGIS |
| [Character Wizard](./character-wizard.md) | 7-step character creation flow and state |
| [LLM Integration](./llm-integration.md) | Narrative generation, provider system, caching |
| [WebSocket Events](./websocket-events.md) | Real-time event reference for Socket.io |
| [User Journeys](./user-journeys.md) | UI inventory, user flows, navigation tree |
| [Development Guide](./development-guide.md) | Setup, testing, conventions, troubleshooting |

## Design specs and plans

`superpowers/specs/` and `superpowers/plans/` hold dated design documents and implementation
plans for individual workstreams. They are a historical record of how a feature was designed —
they are **not** maintained as current documentation, so prefer the guides above for how the
system behaves today.

## Note on API documentation

There is no committed API reference. The route surface is defined in `server/routes/*.routes.js`
(22 domain modules) with business logic in the matching `server/services/<domain>/service.js`;
those files are authoritative. A previous `api-reference.md` was removed once it had drifted out
of sync with the code.
