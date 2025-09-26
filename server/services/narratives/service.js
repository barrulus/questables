import { randomUUID } from 'crypto';
import { query, withClient } from '../../db/pool.js';
import { ensureLLMReady } from '../../llm/request-helpers.js';
import { sanitizeUserInput } from '../../utils/sanitization.js';
import { getViewerContextOrThrow, ensureDmControl } from '../campaigns/service.js';

const INSERT_NARRATIVE_SQL = `
  INSERT INTO public.llm_narratives (
    request_id,
    campaign_id,
    session_id,
    npc_id,
    request_type,
    requested_by,
    cache_key,
    cache_hit,
    provider_name,
    provider_model,
    provider_request_metadata,
    prompt,
    system_prompt,
    response,
    metrics,
    metadata
  ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
  RETURNING *`;

const normalizeProvider = (provider = {}) => ({
  name: provider.name || provider.id || 'unknown',
  model: provider.model ?? provider.name ?? null,
});

const buildInsertParams = ({
  requestId,
  campaignId,
  sessionId,
  npcId,
  type,
  requestedBy,
  cacheKey,
  cacheHit,
  provider,
  requestMetadata,
  prompt,
  systemPrompt,
  response,
  metrics,
  metadata,
}) => {
  const providerInfo = normalizeProvider(provider);

  return [
    requestId ?? randomUUID(),
    campaignId,
    sessionId ?? null,
    npcId ?? null,
    type,
    requestedBy ?? null,
    cacheKey ?? null,
    Boolean(cacheHit),
    providerInfo.name,
    providerInfo.model,
    requestMetadata ?? null,
    typeof prompt === 'string' ? prompt : prompt?.user ?? '',
    systemPrompt ?? (typeof prompt === 'object' ? prompt?.system ?? '' : ''),
    response ?? '',
    metrics ?? null,
    metadata ?? null,
  ];
};

export const insertNarrativeRecord = async (client, payload) => {
  const params = buildInsertParams(payload);
  const { rows } = await client.query(INSERT_NARRATIVE_SQL, params);
  return rows[0];
};

export const persistNarrative = async ({
  campaignId,
  sessionId,
  npcId,
  requestedBy,
  type,
  result,
  prompt,
  metadata,
}) => {
  const finalMetadata = {
    ...metadata,
    cache: result?.cache ?? null,
    provider: result?.provider ?? null,
    raw: result?.raw ?? null,
  };

  const params = buildInsertParams({
    campaignId,
    sessionId,
    npcId,
    type,
    requestedBy,
    cacheKey: result?.cache?.key ?? null,
    cacheHit: result?.cache?.hit ?? false,
    provider: result?.provider ?? {},
    requestMetadata: result?.request ?? null,
    prompt,
    systemPrompt: prompt?.system ?? undefined,
    response: result?.content ?? '',
    metrics: result?.metrics ?? null,
    metadata: finalMetadata,
    requestId: result?.request?.id ?? undefined,
  });

  const { rows } = await query(INSERT_NARRATIVE_SQL, params, { label: 'narratives.persist' });
  return rows[0];
};

export const ensureSessionBelongsToCampaign = async (campaignId, sessionId) => {
  if (!sessionId) {
    return null;
  }

  const { rows } = await query(
    `SELECT id FROM public.sessions WHERE id = $1 AND campaign_id = $2 LIMIT 1`,
    [sessionId, campaignId],
    { label: 'narratives.ensure_session' },
  );

  if (rows.length === 0) {
    const error = new Error('Session not found for campaign');
    error.status = 404;
    error.code = 'session_not_found';
    throw error;
  }

  return rows[0].id;
};

export const ensureNpcBelongsToCampaign = async (campaignId, npcId) => {
  if (!npcId) {
    return null;
  }

  const { rows } = await query(
    `SELECT id FROM public.npcs WHERE id = $1 AND campaign_id = $2 LIMIT 1`,
    [npcId, campaignId],
    { label: 'narratives.ensure_npc' },
  );

  if (rows.length === 0) {
    const error = new Error('NPC not found for campaign');
    error.status = 404;
    error.code = 'npc_not_found';
    throw error;
  }

  return rows[0].id;
};

export const assertNarrativeLead = async ({ user, campaignId }) => {
  await withClient(async (client) => {
    const viewer = await getViewerContextOrThrow(client, campaignId, user);
    ensureDmControl(viewer, 'Only the campaign DM or co-DM may request narratives.');
  }, { label: 'narratives.assert_lead' });
};

const normalizeFocus = (focus) => {
  if (focus === undefined) {
    return undefined;
  }
  const sanitized = sanitizeUserInput(focus, 2000);
  return sanitized ? sanitized : null;
};

export const generateNarrative = async ({
  req,
  campaignId,
  sessionId,
  npcId = null,
  type,
  provider,
  parameters,
  focus,
  metadata = {},
  requestExtras = {},
  requireLead = true,
}) => {
  if (requireLead) {
    await assertNarrativeLead({ user: req.user, campaignId });
  }

  const validatedSessionId = await ensureSessionBelongsToCampaign(campaignId, sessionId);

  if (npcId) {
    await ensureNpcBelongsToCampaign(campaignId, npcId);
  }

  const contextualService = ensureLLMReady(req);
  const normalizedFocus = normalizeFocus(focus);

  const generation = await contextualService.generateFromContext({
    campaignId,
    sessionId: validatedSessionId,
    type,
    provider: provider ?? undefined,
    parameters,
    metadata: {
      ...metadata,
      focus: normalizedFocus ?? metadata.focus ?? null,
      requestedBy: req.user.id,
      npcId: npcId ?? null,
      requestType: type,
    },
    request: {
      ...requestExtras,
      ...(normalizedFocus !== undefined ? { focus: normalizedFocus } : {}),
    },
  });

  const narrativeRecord = await persistNarrative({
    campaignId,
    sessionId: generation.context.session?.id ?? validatedSessionId ?? null,
    npcId,
    requestedBy: req.user.id,
    type,
    result: generation.result,
    prompt: generation.prompt,
    metadata: {
      ...metadata,
      focus: normalizedFocus ?? metadata.focus ?? null,
      parameters: parameters ?? null,
    },
  });

  return {
    narrative: {
      narrativeId: narrativeRecord.id,
      content: generation.result.content,
      provider: generation.result.provider,
      metrics: generation.result.metrics,
      cache: generation.result.cache,
      request: generation.result.request,
      prompt: generation.prompt,
      contextGeneratedAt: generation.context.generatedAt,
      recordedAt: narrativeRecord.created_at?.toISOString?.() ?? null,
    },
    narrativeRecord,
  };
};

