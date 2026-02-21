import { query } from '../../db/pool.js';

const VALID_WORLD_TONES = ['balanced', 'dark', 'heroic', 'comedic', 'gritty', 'custom'];
const VALID_NARRATIVE_VOICES = ['concise', 'verbose', 'poetic', 'terse'];
const VERSIONED_TEXT_FIELDS = ['custom_world_context', 'system_prompt_additions', 'directive_overrides'];

const DEFAULTS = {
  world_tone: 'balanced',
  narrative_voice: 'concise',
  custom_world_context: null,
  system_prompt_additions: null,
  directive_overrides: {},
  chat_history_depth: 5,
  npc_memory_depth: 10,
  include_undiscovered_locations: false,
  preferred_provider: null,
  preferred_model: null,
  temperature: null,
  top_p: null,
};

export const getCampaignLLMSettings = async (campaignId) => {
  const { rows } = await query(
    `SELECT * FROM public.campaign_llm_settings WHERE campaign_id = $1`,
    [campaignId],
    { label: 'campaign_llm_settings.get' },
  );

  if (rows.length === 0) {
    return { campaign_id: campaignId, ...DEFAULTS };
  }

  const row = rows[0];
  return {
    campaign_id: row.campaign_id,
    world_tone: row.world_tone ?? DEFAULTS.world_tone,
    narrative_voice: row.narrative_voice ?? DEFAULTS.narrative_voice,
    custom_world_context: row.custom_world_context ?? DEFAULTS.custom_world_context,
    system_prompt_additions: row.system_prompt_additions ?? DEFAULTS.system_prompt_additions,
    directive_overrides: row.directive_overrides ?? DEFAULTS.directive_overrides,
    chat_history_depth: row.chat_history_depth ?? DEFAULTS.chat_history_depth,
    npc_memory_depth: row.npc_memory_depth ?? DEFAULTS.npc_memory_depth,
    include_undiscovered_locations: row.include_undiscovered_locations ?? DEFAULTS.include_undiscovered_locations,
    preferred_provider: row.preferred_provider ?? DEFAULTS.preferred_provider,
    preferred_model: row.preferred_model ?? DEFAULTS.preferred_model,
    temperature: row.temperature != null ? Number(row.temperature) : DEFAULTS.temperature,
    top_p: row.top_p != null ? Number(row.top_p) : DEFAULTS.top_p,
    updated_at: row.updated_at?.toISOString?.() ?? null,
    updated_by: row.updated_by ?? null,
  };
};

export const upsertCampaignLLMSettings = async (campaignId, settings, userId) => {
  // Validate fields
  if (settings.world_tone !== undefined && !VALID_WORLD_TONES.includes(settings.world_tone)) {
    const error = new Error(`world_tone must be one of: ${VALID_WORLD_TONES.join(', ')}`);
    Object.assign(error, { statusCode: 400 });
    throw error;
  }

  if (settings.narrative_voice !== undefined && !VALID_NARRATIVE_VOICES.includes(settings.narrative_voice)) {
    const error = new Error(`narrative_voice must be one of: ${VALID_NARRATIVE_VOICES.join(', ')}`);
    Object.assign(error, { statusCode: 400 });
    throw error;
  }

  if (settings.chat_history_depth !== undefined) {
    const depth = Number(settings.chat_history_depth);
    if (!Number.isInteger(depth) || depth < 1 || depth > 20) {
      const error = new Error('chat_history_depth must be an integer between 1 and 20');
      Object.assign(error, { statusCode: 400 });
      throw error;
    }
  }

  if (settings.npc_memory_depth !== undefined) {
    const depth = Number(settings.npc_memory_depth);
    if (!Number.isInteger(depth) || depth < 1 || depth > 25) {
      const error = new Error('npc_memory_depth must be an integer between 1 and 25');
      Object.assign(error, { statusCode: 400 });
      throw error;
    }
  }

  if (settings.temperature !== undefined && settings.temperature !== null) {
    const temp = Number(settings.temperature);
    if (Number.isNaN(temp) || temp < 0 || temp > 2) {
      const error = new Error('temperature must be between 0.0 and 2.0');
      Object.assign(error, { statusCode: 400 });
      throw error;
    }
  }

  if (settings.top_p !== undefined && settings.top_p !== null) {
    const topP = Number(settings.top_p);
    if (Number.isNaN(topP) || topP < 0 || topP > 1) {
      const error = new Error('top_p must be between 0.0 and 1.0');
      Object.assign(error, { statusCode: 400 });
      throw error;
    }
  }

  // Snapshot changed text fields into prompt_versions for history
  const { rows: currentRows } = await query(
    `SELECT custom_world_context, system_prompt_additions, directive_overrides
       FROM public.campaign_llm_settings WHERE campaign_id = $1`,
    [campaignId],
    { label: 'campaign_llm_settings.snapshot_check' },
  );

  const current = currentRows[0] || {};

  for (const field of VERSIONED_TEXT_FIELDS) {
    if (settings[field] === undefined) continue;

    const oldVal = field === 'directive_overrides'
      ? JSON.stringify(current[field] ?? {})
      : (current[field] ?? null);
    const newVal = field === 'directive_overrides'
      ? JSON.stringify(settings[field] ?? {})
      : (settings[field] ?? null);

    if (oldVal !== newVal) {
      await query(
        `INSERT INTO public.prompt_versions (campaign_id, field_name, old_value, new_value, changed_by)
         VALUES ($1, $2, $3, $4, $5)`,
        [campaignId, field, oldVal, newVal, userId],
        { label: 'prompt_versions.insert' },
      );
    }
  }

  const directiveOverrides = settings.directive_overrides !== undefined
    ? JSON.stringify(settings.directive_overrides)
    : JSON.stringify(DEFAULTS.directive_overrides);

  const { rows } = await query(
    `INSERT INTO public.campaign_llm_settings (
        campaign_id, world_tone, narrative_voice, custom_world_context,
        system_prompt_additions, directive_overrides, chat_history_depth,
        npc_memory_depth, include_undiscovered_locations, preferred_provider,
        preferred_model, temperature, top_p, updated_by
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
     ON CONFLICT (campaign_id) DO UPDATE SET
        world_tone = EXCLUDED.world_tone,
        narrative_voice = EXCLUDED.narrative_voice,
        custom_world_context = EXCLUDED.custom_world_context,
        system_prompt_additions = EXCLUDED.system_prompt_additions,
        directive_overrides = EXCLUDED.directive_overrides,
        chat_history_depth = EXCLUDED.chat_history_depth,
        npc_memory_depth = EXCLUDED.npc_memory_depth,
        include_undiscovered_locations = EXCLUDED.include_undiscovered_locations,
        preferred_provider = EXCLUDED.preferred_provider,
        preferred_model = EXCLUDED.preferred_model,
        temperature = EXCLUDED.temperature,
        top_p = EXCLUDED.top_p,
        updated_by = EXCLUDED.updated_by
     RETURNING *`,
    [
      campaignId,
      settings.world_tone ?? DEFAULTS.world_tone,
      settings.narrative_voice ?? DEFAULTS.narrative_voice,
      settings.custom_world_context ?? null,
      settings.system_prompt_additions ?? null,
      directiveOverrides,
      settings.chat_history_depth ?? DEFAULTS.chat_history_depth,
      settings.npc_memory_depth ?? DEFAULTS.npc_memory_depth,
      settings.include_undiscovered_locations ?? DEFAULTS.include_undiscovered_locations,
      settings.preferred_provider ?? null,
      settings.preferred_model ?? null,
      settings.temperature ?? null,
      settings.top_p ?? null,
      userId,
    ],
    { label: 'campaign_llm_settings.upsert' },
  );

  const row = rows[0];
  return {
    campaign_id: row.campaign_id,
    world_tone: row.world_tone,
    narrative_voice: row.narrative_voice,
    custom_world_context: row.custom_world_context,
    system_prompt_additions: row.system_prompt_additions,
    directive_overrides: row.directive_overrides,
    chat_history_depth: row.chat_history_depth,
    npc_memory_depth: row.npc_memory_depth,
    include_undiscovered_locations: row.include_undiscovered_locations,
    preferred_provider: row.preferred_provider,
    preferred_model: row.preferred_model,
    temperature: row.temperature != null ? Number(row.temperature) : null,
    top_p: row.top_p != null ? Number(row.top_p) : null,
    updated_at: row.updated_at?.toISOString?.() ?? null,
    updated_by: row.updated_by,
  };
};

export const getPromptVersionHistory = async (campaignId, { limit = 50, offset = 0 } = {}) => {
  const { rows } = await query(
    `SELECT pv.*, up.username AS changed_by_username
       FROM public.prompt_versions pv
       LEFT JOIN public.user_profiles up ON up.id = pv.changed_by
      WHERE pv.campaign_id = $1
      ORDER BY pv.changed_at DESC
      LIMIT $2 OFFSET $3`,
    [campaignId, limit, offset],
    { label: 'prompt_versions.history' },
  );

  return rows.map((row) => ({
    id: row.id,
    campaignId: row.campaign_id,
    fieldName: row.field_name,
    oldValue: row.old_value,
    newValue: row.new_value,
    changedBy: row.changed_by,
    changedByUsername: row.changed_by_username ?? null,
    changedAt: row.changed_at?.toISOString?.() ?? null,
  }));
};
