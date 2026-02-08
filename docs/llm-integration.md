# LLM Integration

Questables uses a provider-abstracted LLM service for AI-powered narrative generation during gameplay.

## Architecture

```
Narrative Console (UI)
        │
        ▼
POST /api/campaigns/:id/narratives/*
        │
        ▼
┌─────────────────────────┐
│  Contextual Service     │  ← Loads campaign/session/NPC context from DB
│  contextual-service.js  │
└────────┬────────────────┘
         │
         ▼
┌─────────────────────────┐
│  Enhanced LLM Service   │  ← Caching, metrics, retry logic
│  enhanced-llm-service.js│
└────────┬────────────────┘
         │
         ▼
┌─────────────────────────┐
│  Provider Registry      │  ← Manages available LLM providers
│  provider-registry.js   │
└────────┬────────────────┘
         │
         ▼
┌─────────────────────────┐
│  Ollama Provider        │  ← HTTP calls to Ollama API
│  providers/ollama.js    │
└─────────────────────────┘
```

## Provider System

### Provider Registry

`server/llm/provider-registry.js` manages LLM providers using a registry pattern. Providers can be:

1. Configured via environment variables
2. Stored in the `llm_providers` database table
3. Both — env vars override DB settings

```javascript
// Provider interface
{
  name: string,
  generate(prompt, options): Promise<{ text, metrics }>,
  checkHealth(): Promise<{ status, latency }>
}
```

### Current Provider: Ollama

The default provider connects to a local or network Ollama instance.

**Environment variables:**

```env
LLM_PROVIDER=ollama
LLM_OLLAMA_HOST=http://localhost:11434
LLM_OLLAMA_MODEL=qwen3:8b
LLM_OLLAMA_TIMEOUT_MS=60000     # optional
LLM_OLLAMA_TEMPERATURE=0.7      # optional
LLM_OLLAMA_TOP_P=0.9            # optional
LLM_OLLAMA_API_KEY=             # optional, only if Ollama requires auth
```

### Database Provider Configuration

Providers can also be managed via the `llm_providers` table:

```sql
INSERT INTO llm_providers (name, adapter, host, model, default_provider)
VALUES ('ollama', 'ollama', 'http://localhost:11434', 'qwen3:8b', true);
```

`default_provider = true` marks which provider is used when callers don't specify one.

## Narrative Types

| Type | Endpoint | Description | Access |
|------|----------|-------------|--------|
| DM Narration | `POST .../narratives/dm` | Session summaries and recaps | DM/co-DM |
| Scene Description | `POST .../narratives/scene` | Environmental/location descriptions | DM/co-DM |
| NPC Dialogue | `POST .../narratives/npc` | In-character NPC responses | DM/co-DM |
| Action Outcome | `POST .../narratives/action` | Narrate results of player actions | Any participant |
| Quest Outline | `POST .../narratives/quest` | AI-generated quest structure | DM/co-DM |

### Contextual Service

The contextual service enriches LLM prompts with live campaign data:

- Active campaign metadata (setting, system, status)
- Current session information
- NPC profiles and relationship history
- Recent chat messages for context
- Campaign objectives and their status

## NPC Dialogue

NPC dialogue requests have special behavior:

1. Prompt includes NPC personality, occupation, and past interactions from `npc_memories`
2. Response is stored in `llm_narratives`
3. An entry is appended to `npc_memories` with:
   - Interaction summary (from response or caller-provided)
   - Sentiment (keyword heuristics or caller-provided)
   - Trust delta (clamped -10 to 10)
   - Tags for categorization
4. `npc_relationships` updated atomically

## Caching

The enhanced LLM service includes TTL-based caching:

- Repeated identical prompts return cached responses
- Cache entries include provider, model, and timestamp metadata
- Admin endpoints for cache inspection and clearing:
  - `GET /api/admin/llm/cache` — View all cache entries
  - `DELETE /api/admin/llm/cache` — Clear all
  - `DELETE /api/admin/llm/cache/:key` — Clear specific entry

## Metrics

Every LLM request is tracked with:

- Request count per provider/model
- Latency (milliseconds)
- Token counts (prompt + completion)
- Cache hit/miss ratio
- Last 25 generation attempts

Metrics are exposed at `GET /api/admin/llm/metrics` and displayed on the Admin dashboard's "LLM Workloads" tab.

## Persistence

All narrative generations are persisted in `llm_narratives`:

| Column | Description |
|--------|-------------|
| campaign_id | Associated campaign |
| type | Narrative type (dm_narration, scene_description, etc.) |
| prompt | Full prompt sent to LLM |
| response | Generated text |
| provider | Provider name |
| model | Model used |
| cached | Whether response came from cache |
| latency_ms | Generation time |
| tokens | `{ prompt, completion }` token counts |

## Error Handling

- Provider failures return `502` (bad gateway) or `503` (service unavailable)
- No fallback content is generated — errors are surfaced to the UI
- The backend refuses narrative requests when the provider bootstrap fails
- Admin dashboard shows provider health status

## Health Check

Verify LLM connectivity before running integration tests:

```bash
LLM_OLLAMA_MODEL=qwen3:8b node --input-type=module <<'NODE'
import { initializeLLMServiceFromEnv } from './server/llm/index.js';

const { registry } = initializeLLMServiceFromEnv(process.env);
const health = await registry.get('ollama').checkHealth();
console.log(health);
NODE
```

## Frontend: Narrative Console

`components/narrative-console.tsx` provides the DM interface for generating narratives:

- Type selector (DM narration, scene, NPC dialogue, action, quest)
- Context-aware prompting (active session, selected NPCs)
- Response display with provider metadata and cache indicators
- Error states for provider unavailability
