import { randomUUID } from 'crypto';
import { Router } from 'express';
import { body, param } from 'express-validator';
import {
  requireAuth,
  requireCampaignOwnership,
  requireCampaignParticipation,
} from '../auth-middleware.js';
import { getClient } from '../db/pool.js';
import { validateCampaign } from '../validation/campaigns.js';
import { handleValidationErrors } from '../validation/common.js';
import {
  parseLevelRangeInput,
  parseMaxPlayersInput,
  normalizeStatusInput,
  coerceNullableString,
  coerceBooleanInput,
  pickProvided,
  DEFAULT_VISIBILITY_RADIUS,
  DEFAULT_MAX_PLAYERS,
  CAMPAIGN_STATUS_VALUES,
  EXPERIENCE_TYPE_VALUES,
  RESTING_RULE_VALUES,
  DEATH_SAVE_RULE_VALUES,
} from '../services/campaigns/utils.js';
import { ensureLLMReady } from '../llm/request-helpers.js';
import { insertNarrativeRecord } from '../services/narratives/service.js';
import {
  MOVE_MODES,
  MOVE_MODE_SET,
  TELEPORT_MODES,
  ENCOUNTER_TYPES,
  normalizeTargetCoordinates,
  parseBounds,
  pointWithinBounds,
  ensureDmControl,
  getViewerContextOrThrow,
  performPlayerMovement,
  extractNumeric,
  sanitizeReason,
  formatSpawnRow,
} from '../services/campaigns/service.js';
import {
  sanitizeObjectivePayload,
  ObjectiveValidationError,
  MARKDOWN_FIELDS,
} from '../objectives/objective-validation.js';
import { respondWithNarrativeError } from '../llm/narrative-errors.js';
import { LLMProviderError, LLMServiceError } from '../llm/index.js';
import {
  OBJECTIVE_RETURNING_FIELDS,
  OBJECTIVE_ASSIST_FIELDS,
  fetchObjectiveWithCampaign,
  fetchObjectiveById,
  fetchObjectiveDescendantIds,
  formatObjectiveRow,
  buildObjectiveAssistSections,
  sanitizeAssistFocus,
  stripThinkTags,
} from '../services/narratives/objectives.js';
import { objectiveAssistValidators } from '../validation/narratives.js';
import { logInfo, logError, logWarn } from '../utils/logger.js';
import { incrementCounter, recordEvent } from '../utils/telemetry.js';


const createObjectiveAssistHandler = (fieldKey) => async (req, res) => {
  const config = OBJECTIVE_ASSIST_FIELDS[fieldKey];
  if (!config) {
    logError('Objective assist configuration missing', new Error('Unknown assist field'), { fieldKey });
    return res.status(500).json({
      error: 'objective_assist_unavailable',
      message: 'Objective assist is not configured.',
    });
  }

  const { objectiveId } = req.params;
  const client = await getClient({ label: `objectives.assist.${fieldKey}` });
  let transactionStarted = false;

  try {
    const objectiveRow = await fetchObjectiveWithCampaign(client, objectiveId);
    if (!objectiveRow) {
      return res.status(404).json({ error: 'Objective not found' });
    }

    const viewer = await getViewerContextOrThrow(client, objectiveRow.campaign_id, req.user);
    if (!viewer.isAdmin && !['dm', 'co-dm'].includes(viewer.role)) {
      return res.status(403).json({
        error: 'objective_forbidden',
        message: 'Only DMs can use objective assists.',
      });
    }

    const parentObjective = objectiveRow.parent_id
      ? await fetchObjectiveById(client, objectiveRow.parent_id)
      : null;

    const formattedObjective = formatObjectiveRow(objectiveRow);
    const formattedParentObjective = parentObjective ? formatObjectiveRow(parentObjective) : null;

    const sanitizedPayload = sanitizeObjectivePayload(req.body ?? {}, {
      allowPartial: true,
      campaignId: objectiveRow.campaign_id,
      parentObjective: formattedParentObjective,
    });

    const focus = sanitizeAssistFocus(req.body?.focus);
    const extraSections = buildObjectiveAssistSections({
      objective: formattedObjective,
      parentObjective: formattedParentObjective,
      fieldConfig: config,
    });

    const contextualService = ensureLLMReady(req);
    const generation = await contextualService.generateFromContext({
      campaignId: objectiveRow.campaign_id,
      sessionId: null,
      type: config.narrativeType,
      provider: sanitizedPayload.provider,
      parameters: sanitizedPayload.parameters,
      metadata: {
        objectiveId,
        assistField: config.column,
        requestedBy: req.user.id,
      },
      request: {
        focus,
        extraSections,
      },
    });

    const generatedContent = stripThinkTags(generation.result?.content || '');
    if (!generatedContent) {
      throw new LLMServiceError('LLM returned empty content for objective assist', {
        type: 'objective_assist_empty',
      });
    }

    await client.query('BEGIN');
    transactionStarted = true;

    const updateResult = await client.query(
      `UPDATE public.campaign_objectives
          SET ${config.column} = $1,
              updated_at = NOW(),
              updated_by = $2
        WHERE id = $3
        RETURNING ${OBJECTIVE_RETURNING_FIELDS}`,
      [generatedContent, req.user.id, objectiveId],
    );

    const narrativeRecord = await insertNarrativeRecord(client, {
      requestId: generation.result?.request?.id ?? randomUUID(),
      campaignId: objectiveRow.campaign_id,
      sessionId: null,
      npcId: null,
      type: config.narrativeType,
      requestedBy: req.user.id,
      cacheKey: generation.result?.cache?.key ?? null,
      cacheHit: generation.result?.cache?.hit ?? false,
      provider: generation.result?.provider ?? {},
      requestMetadata: generation.result?.request ?? null,
      prompt: generation.prompt.user,
      systemPrompt: generation.prompt.system,
      response: generatedContent,
      metrics: generation.result?.metrics ?? null,
      metadata: {
        objectiveId,
        assistField: config.column,
        focus,
        provider: generation.result?.provider ?? null,
      },
    });

    await client.query('COMMIT');
    transactionStarted = false;

    const updatedObjective = formatObjectiveRow(updateResult.rows[0]);
    incrementCounter('objective_assists.generated');
    recordEvent('objective.assist.generated', {
      campaignId: objectiveRow.campaign_id,
      objectiveId,
      field: config.column,
      userId: req.user.id,
      provider: generation.result?.provider ?? null,
      cacheHit: generation.result?.cache?.hit ?? false,
    });
    logInfo('Objective assist generated', {
      telemetryEvent: 'objective.assist_generated',
      objectiveId,
      field: config.column,
      provider: generation.result?.provider?.name ?? null,
      narrativeId: narrativeRecord.id,
    });

    res.json({
      objective: updatedObjective,
      assist: {
        field: config.column,
        content: generatedContent,
        provider: generation.result?.provider ?? null,
        metrics: generation.result?.metrics ?? null,
        cache: generation.result?.cache ?? null,
      },
    });
  } catch (error) {
    if (transactionStarted) {
      await client.query('ROLLBACK').catch(() => {});
    }

    if (error instanceof ObjectiveValidationError) {
      return res.status(400).json({
        error: error.code,
        message: error.message,
      });
    }

    if (error instanceof LLMProviderError || error instanceof LLMServiceError) {
      logError('Objective assist generation failed', error, {
        objectiveId,
        field: config?.column,
        userId: req.user?.id,
      });
      return respondWithNarrativeError(res, error);
    }

    logError('Objective assist generation failed', error, {
      objectiveId,
      field: config?.column,
      userId: req.user?.id,
    });
    res.status(error.status || 500).json({
      error: error.code || 'objective_assist_failed',
      message: error.message || 'Failed to generate objective assist content.',
    });
  } finally {
    client.release();
  }
};

const router = Router();

router.post('/api/campaigns', requireAuth, validateCampaign, handleValidationErrors, async (req, res) => {
  const dmUserId = req.user?.id;
  if (!dmUserId) {
    return res.status(401).json({
      error: 'authentication_required',
      message: 'You must be signed in to create a campaign.',
    });
  }

  if (req.body?.dmUserId && req.body.dmUserId !== dmUserId) {
    return res.status(403).json({
      error: 'dm_mismatch',
      message: 'Campaigns can only be created for the authenticated DM.',
    });
  }

  const trimmedName = typeof req.body.name === 'string' ? req.body.name.trim() : '';
  if (!trimmedName) {
    return res.status(400).json({
      error: 'invalid_name',
      message: 'Campaign name is required.',
    });
  }

  const description = coerceNullableString(req.body.description);
  let maxPlayers;
  try {
    maxPlayers = parseMaxPlayersInput(req.body.maxPlayers, { fallback: DEFAULT_MAX_PLAYERS, required: false });
  } catch (error) {
    return res.status(400).json({
      error: 'invalid_max_players',
      message: error.message,
    });
  }

  let levelRange;
  try {
    levelRange = parseLevelRangeInput(req.body.levelRange, { fallbackToDefault: true });
  } catch (error) {
    return res.status(400).json({
      error: 'invalid_level_range',
      message: error.message,
    });
  }

  const status = normalizeStatusInput(req.body.status, 'recruiting');
  const isPublic = coerceBooleanInput(req.body.isPublic, false);
  const worldMapId = coerceNullableString(req.body.worldMapId);

  if (status === 'active' && !worldMapId) {
    return res.status(409).json({
      error: 'world_map_required',
      message: 'Active campaigns must specify a world map.',
    });
  }

  const system = coerceNullableString(req.body.system);
  if (req.body.system !== undefined && system === null) {
    return res.status(400).json({
      error: 'invalid_system',
      message: 'System cannot be empty when provided.',
    });
  }

  const setting = coerceNullableString(req.body.setting, { trim: true });

  const columns = ['name', 'description', 'dm_user_id', 'status', 'max_players', 'level_range', 'is_public', 'world_map_id'];
  const values = [
    trimmedName,
    description,
    dmUserId,
    status,
    maxPlayers,
    JSON.stringify(levelRange),
    isPublic,
    worldMapId,
  ];

  const placeholders = [];

  columns.forEach((column, index) => {
    const position = index + 1;
    if (column === 'level_range') {
      placeholders.push(`$${position}::jsonb`);
    } else {
      placeholders.push(`$${position}`);
    }
  });

  if (system) {
    columns.push('system');
    placeholders.push(`$${columns.length}`);
    values.push(system);
  }

  // Persist explicit null for setting to avoid resurrecting placeholder defaults
  columns.push('setting');
  placeholders.push(`$${columns.length}`);
  values.push(setting);

  const insertSql = `INSERT INTO campaigns (${columns.join(', ')}) VALUES (${placeholders.join(', ')}) RETURNING *`;

  const client = await getClient();
  try {
    const result = await client.query(insertSql, values);
    const insertedCampaign = result.rows[0] ?? null;
    if (insertedCampaign?.id) {
      incrementCounter('campaigns.created');
      recordEvent('campaign.created', {
        campaignId: insertedCampaign.id,
        dmUserId,
        status,
        isPublic,
      });
    }
    logInfo('Campaign created', {
      telemetryEvent: 'campaign.created',
      campaignId: insertedCampaign?.id ?? null,
      dmUserId,
      status,
      isPublic,
    });
    return res.status(201).json({ campaign: insertedCampaign });
  } catch (error) {
    if (error.code === '23505' && error.constraint === 'uq_campaign_name_per_dm') {
      logWarn('Campaign name conflict detected', { dmUserId, name: trimmedName });
      return res.status(409).json({
        error: 'campaign_name_conflict',
        message: 'You already have a campaign with that name. Choose a different name.',
      });
    }

    logError('Campaign creation failed', error, { dmUserId, name: trimmedName });
    return res.status(500).json({ error: 'Failed to create campaign' });
  } finally {
    client.release();
  }
});

router.get('/api/users/:userId/campaigns', async (req, res) => {
  const { userId } = req.params;

  try {
    const client = await getClient();
    
    // Get campaigns where user is DM
    const dmCampaigns = await client.query(`
      SELECT c.*, COUNT(cp.user_id) as current_players
      FROM campaigns c
      LEFT JOIN campaign_players cp ON c.id = cp.campaign_id AND cp.status = 'active'
      WHERE c.dm_user_id = $1
      GROUP BY c.id
      ORDER BY c.created_at DESC
    `, [userId]);
    
    // Get campaigns where user is a player
    const playerCampaigns = await client.query(`
      SELECT c.*, u.username as dm_username, cp.character_id, ch.name as character_name
      FROM campaigns c
      JOIN campaign_players cp ON c.id = cp.campaign_id
      JOIN user_profiles u ON c.dm_user_id = u.id
      LEFT JOIN characters ch ON cp.character_id = ch.id
      WHERE cp.user_id = $1 AND cp.status = 'active'
      ORDER BY c.created_at DESC
    `, [userId]);
    
    client.release();

    res.json({ 
      dmCampaigns: dmCampaigns.rows, 
      playerCampaigns: playerCampaigns.rows 
    });
  } catch (error) {
    logError('[Campaigns] Get user campaigns error:', error);
    res.status(500).json({ error: 'Failed to fetch user campaigns' });
  }
});

router.get('/api/campaigns/public', async (req, res) => {
  try {
    const client = await getClient();
    const result = await client.query(`
      SELECT c.*, u.username as dm_username, 
             COUNT(cp.user_id) as current_players
      FROM campaigns c
      LEFT JOIN campaign_players cp ON c.id = cp.campaign_id AND cp.status = 'active'
      JOIN user_profiles u ON c.dm_user_id = u.id
      WHERE c.is_public = true AND c.status = 'recruiting'
      GROUP BY c.id, u.username
      ORDER BY c.created_at DESC
    `);
    client.release();

    res.json(result.rows);
  } catch (error) {
    logError('[Campaigns] Get public campaigns error:', error);
    res.status(500).json({ error: 'Failed to fetch public campaigns' });
  }
});

router.get('/api/campaigns/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const client = await getClient();
    const result = await client.query(`
      SELECT c.*, u.username as dm_username
      FROM campaigns c
      JOIN user_profiles u ON c.dm_user_id = u.id
      WHERE c.id = $1
    `, [id]);
    client.release();

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Campaign not found' });
    }

    const campaign = result.rows[0];
    if (!Object.prototype.hasOwnProperty.call(campaign, 'visibility_radius')) {
      campaign.visibility_radius = DEFAULT_VISIBILITY_RADIUS;
    }

    res.json({ campaign });
  } catch (error) {
    logError('[Campaigns] Get error:', error);
    res.status(500).json({ error: 'Failed to fetch campaign' });
  }
});

router.post('/api/campaigns/:campaignId/players', async (req, res) => {
  const { campaignId } = req.params;
  const { userId, characterId } = req.body;

  if (!userId) {
    return res.status(400).json({ error: 'User ID is required' });
  }

  let client;
  try {
    client = await getClient();
    await client.query('BEGIN');

    // Check if campaign exists and has space
    const campaignCheck = await client.query(`
      SELECT c.max_players,
             c.world_map_id,
             c.dm_user_id,
             COUNT(cp.user_id) as current_players
        FROM campaigns c
        LEFT JOIN campaign_players cp ON c.id = cp.campaign_id AND cp.status = 'active'
       WHERE c.id = $1
       GROUP BY c.id, c.max_players, c.world_map_id, c.dm_user_id
    `, [campaignId]);

    if (campaignCheck.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Campaign not found' });
    }

    const campaignMeta = campaignCheck.rows[0];
    if (campaignMeta.current_players >= campaignMeta.max_players) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Campaign is full' });
    }

    // Check if user is already a player
    const existingPlayer = await client.query(
      'SELECT 1 FROM campaign_players WHERE campaign_id = $1 AND user_id = $2',
      [campaignId, userId]
    );

    if (existingPlayer.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'User is already in this campaign' });
    }

    // Add player to campaign and capture id
    const insertResult = await client.query(
      `INSERT INTO campaign_players (campaign_id, user_id, character_id, status, role)
       VALUES ($1, $2, $3, 'active', 'player')
       RETURNING id`,
      [campaignId, userId, characterId]
    );

    const campaignPlayerId = insertResult.rows[0]?.id;
    let autoPlacement = null;

    if (campaignPlayerId) {
      // Prefer default (or latest) spawn
      const spawnResult = await client.query(
        `SELECT ST_X(world_position) AS x,
                ST_Y(world_position) AS y
           FROM public.campaign_spawns
          WHERE campaign_id = $1
          ORDER BY is_default DESC, updated_at DESC
          LIMIT 1`,
        [campaignId]
      );

      if (spawnResult.rowCount > 0) {
        autoPlacement = {
          x: Number(spawnResult.rows[0].x),
          y: Number(spawnResult.rows[0].y),
          reason: 'Auto-placement to default spawn',
        };
      } else if (campaignMeta.world_map_id) {
        const boundsResult = await client.query(
          'SELECT bounds FROM public.maps_world WHERE id = $1',
          [campaignMeta.world_map_id]
        );
        const parsed = parseBounds(boundsResult.rows[0]?.bounds);
        if (parsed) {
          autoPlacement = {
            x: (parsed.west + parsed.east) / 2,
            y: (parsed.south + parsed.north) / 2,
            reason: 'Auto-placement to map center',
          };
        }
      }

      if (autoPlacement) {
        await client.query(
          `UPDATE public.campaign_players
              SET loc_current = ST_SetSRID(ST_MakePoint($1, $2), 0),
                  last_located_at = NOW()
            WHERE id = $3`,
          [autoPlacement.x, autoPlacement.y, campaignPlayerId]
        );

        await client.query(
          `INSERT INTO public.player_movement_audit
              (campaign_id, player_id, moved_by, mode, reason, previous_loc, new_loc)
           VALUES
              ($1, $2, $3, 'gm', $4, NULL, ST_SetSRID(ST_MakePoint($5, $6), 0))`,
          [
            campaignId,
            campaignPlayerId,
            campaignMeta.dm_user_id ?? null,
            autoPlacement.reason,
            autoPlacement.x,
            autoPlacement.y,
          ]
        );
      }
    }

    await client.query('COMMIT');

    res.json({
      message: 'Successfully joined campaign',
      playerId: campaignPlayerId,
      autoPlaced: Boolean(autoPlacement),
    });
  } catch (error) {
    if (client) {
      await client.query('ROLLBACK').catch(() => {});
    }
    logError('[Campaigns] Join campaign error:', error);
    res.status(500).json({ error: 'Failed to join campaign' });
  } finally {
    client?.release();
  }
});

router.get('/api/campaigns/:campaignId/characters', async (req, res) => {
  const { campaignId } = req.params;

  try {
    const client = await getClient();
    const result = await client.query(`
      SELECT
        c.*,
        cp.id AS campaign_player_id,
        cp.user_id AS campaign_user_id,
        cp.role,
        cp.status,
        cp.visibility_state,
        up.username,
        ST_AsGeoJSON(cp.loc_current)::json AS loc_geometry,
        cp.last_located_at
      FROM campaign_players cp
      JOIN characters c ON cp.character_id = c.id
      JOIN user_profiles up ON cp.user_id = up.id
      WHERE cp.campaign_id = $1
      ORDER BY c.name
    `, [campaignId]);
    client.release();

    res.json(result.rows);
  } catch (error) {
    logError('[Campaigns] Get characters error:', error);
    res.status(500).json({ error: error.message });
  }
});

router.get(
  '/api/campaigns/:campaignId/players',
  requireAuth,
  [
    param('campaignId')
      .isUUID()
      .withMessage('campaignId must be a valid UUID'),
  ],
  handleValidationErrors,
  async (req, res) => {
    const { campaignId } = req.params;
    const client = await getClient();
    const wsServer = req.app?.locals?.wsServer ?? null;

    try {
      const viewer = await getViewerContextOrThrow(client, campaignId, req.user);
      ensureDmControl(viewer, 'Only the campaign DM or co-DM may view the full roster.');

      const result = await client.query(
        `SELECT
            cp.id,
            cp.id AS campaign_player_id,
            cp.user_id,
            cp.user_id AS campaign_user_id,
            cp.role,
            cp.status,
            cp.character_id,
            up.username,
            c.name AS character_name,
            c.level AS character_level
          FROM public.campaign_players cp
          JOIN public.user_profiles up ON cp.user_id = up.id
          LEFT JOIN public.characters c ON cp.character_id = c.id
         WHERE cp.campaign_id = $1
         ORDER BY up.username`,
        [campaignId]
      );

      res.json(result.rows);
    } catch (error) {
      logError('[Campaigns] Get players error:', error);
      res.status(error.status || 500).json({
        error: error.code || 'campaign_players_failed',
        message: error.message || 'Failed to load campaign roster',
      });
    } finally {
      client.release();
    }
  }
);

router.delete('/api/campaigns/:campaignId/players/:userId', async (req, res) => {
  const { campaignId, userId } = req.params;

  try {
    const client = await getClient();
    const result = await client.query(
      'DELETE FROM campaign_players WHERE campaign_id = $1 AND user_id = $2 RETURNING *',
      [campaignId, userId]
    );
    client.release();

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Player not found in campaign' });
    }

    res.json({ message: 'Successfully left campaign' });
  } catch (error) {
    logError('[Campaigns] Leave campaign error:', error);
    res.status(500).json({ error: 'Failed to leave campaign' });
  }
});

router.post(
  '/api/campaigns/:campaignId/players/:playerId/move',
  requireAuth,
  requireCampaignParticipation,
  async (req, res) => {
    const { campaignId, playerId } = req.params;
    const target = normalizeTargetCoordinates(
      req.body?.target ?? req.body?.position ?? req.body
    );

    if (!target) {
      return res.status(400).json({
        error: 'invalid_target',
        message: 'Target coordinates are required (provide x/y in SRID-0 units).',
      });
    }

    const modeRaw = typeof req.body?.mode === 'string' ? req.body.mode.trim().toLowerCase() : 'walk';
    if (!MOVE_MODE_SET.has(modeRaw)) {
      return res.status(400).json({
        error: 'invalid_mode',
        message: `Movement mode must be one of: ${MOVE_MODES.join(', ')}`,
      });
    }

    const reason = sanitizeReason(req.body?.reason);

    const client = await getClient();
    const wsServer = req.app?.locals?.wsServer ?? null;
    try {
      await client.query('BEGIN');
      const viewer = await getViewerContextOrThrow(client, campaignId, req.user);

      if (!viewer.isAdmin && viewer.role === 'player' && viewer.campaign_player_id !== playerId) {
        const error = new Error('You may only move your own token');
        error.status = 403;
        error.code = 'movement_forbidden';
        throw error;
      }

      if (TELEPORT_MODES.has(modeRaw) && !viewer.isAdmin && !['dm', 'co-dm'].includes(viewer.role)) {
        const error = new Error('Teleportation requires DM privileges');
        error.status = 403;
        error.code = 'teleport_forbidden';
        throw error;
      }

      const { player, requestedDistance } = await performPlayerMovement({
        client,
        campaignId,
        playerId,
        requestorUserId: req.user.id,
        requestorRole: viewer.role,
        isRequestorAdmin: viewer.isAdmin,
        targetX: target.x,
        targetY: target.y,
        mode: modeRaw,
        reason,
        enforceClamp: !(viewer.isAdmin || ['dm', 'co-dm'].includes(viewer.role) || TELEPORT_MODES.has(modeRaw)),
      });

      await client.query('COMMIT');

      if (player?.id && wsServer) {
        wsServer.broadcastToCampaign(campaignId, 'player-moved', {
          playerId: player.id,
          geometry: player.geometry,
          visibilityState: player.visibility_state,
          mode: modeRaw,
          movedBy: req.user.id,
          updatedAt: player.last_located_at,
          distance: typeof requestedDistance === 'number' ? requestedDistance : null,
          reason: reason ?? null,
        });
      }

      res.json({
        playerId: player.id,
        geometry: player.geometry,
        visibilityState: player.visibility_state,
        lastLocatedAt: player.last_located_at
          ? new Date(player.last_located_at).toISOString()
          : null,
        mode: modeRaw,
        distance: typeof requestedDistance === 'number' ? requestedDistance : null,
        reason: reason ?? null,
      });
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      logError('[Movement] Player move error:', error);
      res.status(error.status || 500).json({
        error: error.code || 'move_failed',
        message: error.message || 'Failed to move player',
      });
    } finally {
      client.release();
    }
  }
);

router.post(
  '/api/campaigns/:campaignId/teleport/player',
  requireAuth,
  requireCampaignParticipation,
  [
    body('playerId')
      .optional({ checkFalsy: true })
      .isUUID()
      .withMessage('playerId must be a valid UUID when provided'),
    body('player_id')
      .optional({ checkFalsy: true })
      .isUUID()
      .withMessage('player_id must be a valid UUID when provided'),
    body('spawnId')
      .optional({ checkFalsy: true })
      .isUUID()
      .withMessage('spawnId must be a valid UUID when provided'),
  ],
  handleValidationErrors,
  async (req, res) => {
    const { campaignId } = req.params;
    const playerId = req.body?.playerId || req.body?.player_id;

    if (!playerId) {
      return res.status(400).json({
        error: 'player_required',
        message: 'playerId is required to teleport a campaign participant.',
      });
    }

    const client = await getClient();
    const wsServer = req.app?.locals?.wsServer ?? null;
    try {
      await client.query('BEGIN');
      const viewer = await getViewerContextOrThrow(client, campaignId, req.user);
      ensureDmControl(viewer, 'Teleportation requires DM or co-DM privileges.');

      let target = null;
      let spawnMeta = null;

      if (req.body?.spawnId) {
        const spawnResult = await client.query(
          `SELECT id, campaign_id, name, note, is_default,
                  ST_X(world_position) AS x,
                  ST_Y(world_position) AS y,
                  ST_AsGeoJSON(world_position)::json AS geometry
             FROM public.campaign_spawns
            WHERE id = $1 AND campaign_id = $2`,
          [req.body.spawnId, campaignId]
        );

        if (spawnResult.rowCount === 0) {
          const error = new Error('Spawn point not found for this campaign');
          error.status = 404;
          error.code = 'spawn_not_found';
          throw error;
        }

        const spawnRow = spawnResult.rows[0];
        spawnMeta = spawnRow;
        target = {
          x: Number(spawnRow.x),
          y: Number(spawnRow.y),
        };
      }

      if (!target) {
        target = normalizeTargetCoordinates(
          req.body?.target ?? req.body?.position ?? req.body
        );
      }

      if (!target) {
        const error = new Error('Target coordinates or spawnId are required for teleport');
        error.status = 400;
        error.code = 'invalid_target';
        throw error;
      }

      const inferredReason = spawnMeta
        ? `Teleport to spawn: ${spawnMeta.name}${spawnMeta.note ? ` – ${spawnMeta.note}` : ''}`
        : null;
      const reason = sanitizeReason(req.body?.reason ?? inferredReason);

      const { player } = await performPlayerMovement({
        client,
        campaignId,
        playerId,
        requestorUserId: req.user.id,
        requestorRole: viewer.role,
        isRequestorAdmin: viewer.isAdmin,
        targetX: target.x,
        targetY: target.y,
        mode: 'teleport',
        reason,
        enforceClamp: false,
      });

      await client.query('COMMIT');

      if (player?.id && wsServer) {
        wsServer.broadcastToCampaign(campaignId, 'player-teleported', {
          playerId: player.id,
          geometry: player.geometry,
          visibilityState: player.visibility_state,
          mode: 'teleport',
          movedBy: req.user.id,
          spawn: spawnMeta
            ? {
                id: spawnMeta.id,
                name: spawnMeta.name,
                note: spawnMeta.note,
                isDefault: spawnMeta.is_default,
              }
            : null,
          reason: reason ?? null,
          updatedAt: player.last_located_at,
        });
      }

      incrementCounter('movement.teleport_player');
      recordEvent('movement.teleport_player', {
        campaignId,
        playerId: player.id,
        userId: req.user.id,
        viaSpawn: Boolean(spawnMeta),
        reason: reason ?? null,
      });
      logInfo('Player teleported', {
        telemetryEvent: 'movement.teleport_player',
        campaignId,
        playerId: player.id,
        userId: req.user.id,
        viaSpawn: Boolean(spawnMeta),
      });

      res.json({
        playerId: player.id,
        geometry: player.geometry,
        visibilityState: player.visibility_state,
        lastLocatedAt: player.last_located_at
          ? new Date(player.last_located_at).toISOString()
          : null,
        mode: 'teleport',
        reason: reason ?? null,
        spawn: spawnMeta
          ? {
              id: spawnMeta.id,
              name: spawnMeta.name,
              note: spawnMeta.note,
              isDefault: spawnMeta.is_default,
              geometry: spawnMeta.geometry,
            }
          : null,
      });
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      logError('[Movement] Player teleport error:', error);
      res.status(error.status || 500).json({
        error: error.code || 'teleport_failed',
        message: error.message || 'Failed to teleport player',
      });
    } finally {
      client.release();
    }
  }
);

router.post(
  '/api/campaigns/:campaignId/teleport/npc',
  requireAuth,
  requireCampaignParticipation,
  [
    body('npcId')
      .optional({ checkFalsy: true })
      .isUUID()
      .withMessage('npcId must be a valid UUID when provided'),
    body('npc_id')
      .optional({ checkFalsy: true })
      .isUUID()
      .withMessage('npc_id must be a valid UUID when provided'),
    body('locationId')
      .optional({ checkFalsy: true })
      .isUUID()
      .withMessage('locationId must be a valid UUID when provided'),
    body('location_id')
      .optional({ checkFalsy: true })
      .isUUID()
      .withMessage('location_id must be a valid UUID when provided'),
  ],
  handleValidationErrors,
  async (req, res) => {
    const { campaignId } = req.params;
    const npcId = req.body?.npcId || req.body?.npc_id;

    if (!npcId) {
      return res.status(400).json({
        error: 'npc_required',
        message: 'npcId is required to teleport an NPC.',
      });
    }

    const client = await getClient();
    const wsServer = req.app?.locals?.wsServer ?? null;
    try {
      await client.query('BEGIN');

      const npcResult = await client.query(
        `SELECT id, campaign_id, name, current_location_id,
                ST_AsGeoJSON(world_position)::json AS world_position_geo
           FROM public.npcs
          WHERE id = $1 AND campaign_id = $2
          FOR UPDATE`,
        [npcId, campaignId]
      );

      if (npcResult.rowCount === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({
          error: 'npc_not_found',
          message: 'NPC not found for this campaign.',
        });
      }

      const viewer = await getViewerContextOrThrow(client, campaignId, req.user);
      ensureDmControl(viewer, 'Only the campaign DM or co-DM may teleport NPCs.');

      const locationId = req.body?.locationId || req.body?.location_id || null;
      const target = normalizeTargetCoordinates(
        req.body?.target ?? req.body?.position ?? req.body
      );

      if (!locationId && !target) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          error: 'destination_required',
          message: 'Provide either locationId or target coordinates to teleport the NPC.',
        });
      }

      if (locationId) {
        const { rowCount } = await client.query(
          'SELECT 1 FROM public.locations WHERE id = $1 AND campaign_id = $2',
          [locationId, campaignId]
        );
        if (rowCount === 0) {
          await client.query('ROLLBACK');
          return res.status(404).json({
            error: 'location_not_found',
            message: 'The specified location does not belong to this campaign.',
          });
        }
      }

      const assignments = ['updated_at = NOW()'];
      const params = [npcId];
      let paramIndex = 1;

      if (locationId) {
        paramIndex += 1;
        assignments.push(`current_location_id = $${paramIndex}`);
        params.push(locationId);
      } else if (target) {
        assignments.push('current_location_id = NULL');
      }

      if (target) {
        paramIndex += 2;
        assignments.push(`world_position = ST_SetSRID(ST_MakePoint($${paramIndex - 1}, $${paramIndex}), 0)`);
        params.push(target.x, target.y);
      } else if (locationId) {
        assignments.push('world_position = NULL');
      }

      const { rows } = await client.query(
        `UPDATE public.npcs
            SET ${assignments.join(', ')}
          WHERE id = $1
          RETURNING id, campaign_id, name, current_location_id,
                    ST_AsGeoJSON(world_position)::json AS world_position_geo`,
        params
      );

      await client.query('COMMIT');

      const npc = rows[0];
      incrementCounter('movement.teleport_npc');
      recordEvent('movement.teleport_npc', {
        campaignId,
        npcId,
        userId: req.user.id,
        mode: target ? 'coordinates' : 'location',
        locationId: npc.current_location_id,
      });
      logInfo('NPC teleported', {
        telemetryEvent: 'movement.teleport_npc',
        npcId,
        campaignId,
        userId: req.user.id,
        mode: target ? 'coordinates' : 'location',
        locationId: npc.current_location_id,
      });

      const responsePayload = {
        npcId: npc.id,
        campaignId: npc.campaign_id,
        currentLocationId: npc.current_location_id,
        worldPosition: npc.world_position_geo,
      };

      if (wsServer) {
        wsServer.emitNpcTeleported(campaignId, responsePayload, {
          actorId: req.user.id,
          mode: target ? 'coordinates' : 'location',
        });
      }

      res.json(responsePayload);
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      logError('[Movement] NPC teleport error:', error);
      res.status(error.status || 500).json({
        error: error.code || 'npc_teleport_failed',
        message: error.message || 'Failed to teleport NPC',
      });
    } finally {
      client.release();
    }
  }
);

router.get(
  '/api/campaigns/:campaignId/spawns',
  requireAuth,
  requireCampaignParticipation,
  async (req, res) => {
    const { campaignId } = req.params;
    const client = await getClient();
    try {
      const viewer = await getViewerContextOrThrow(client, campaignId, req.user);
      if (!viewer.isAdmin && !['dm', 'co-dm'].includes(viewer.role)) {
        return res.status(403).json({
          error: 'spawn_access_forbidden',
          message: 'Only DMs can view campaign spawn points.',
        });
      }

      const { rows } = await client.query(
        `SELECT id, campaign_id, name, note, is_default,
                ST_AsGeoJSON(world_position)::json AS geometry,
                created_at, updated_at
           FROM public.campaign_spawns
          WHERE campaign_id = $1
          ORDER BY is_default DESC, name ASC`,
        [campaignId]
      );

      res.json({ spawns: rows.map(formatSpawnRow) });
    } catch (error) {
      logError('[Spawns] List error:', error);
      res.status(500).json({ error: 'Failed to fetch spawns' });
    } finally {
      client.release();
    }
  }
);

router.put('/api/campaigns/:campaignId/spawn', requireAuth, async (req, res) => {
  const { campaignId } = req.params;

    const client = await getClient();
    const wsServer = req.app?.locals?.wsServer ?? null;
    let transactionStarted = false;
  try {
    const viewer = await getViewerContextOrThrow(client, campaignId, req.user);
    if (!viewer.isAdmin && !['dm', 'co-dm'].includes(viewer.role)) {
      return res.status(403).json({
        error: 'spawn_forbidden',
        message: 'Only DMs can update the campaign spawn.',
      });
    }

    const target = normalizeTargetCoordinates(
      req.body?.worldPosition ?? req.body?.position ?? req.body?.target ?? req.body
    );

    if (!target) {
      return res.status(400).json({
        error: 'invalid_target',
        message: 'Spawn coordinates require numeric x and y values.',
      });
    }

    const rawName = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    const name = rawName ? rawName : 'Default Spawn';
    const note = (() => {
      if (typeof req.body?.note !== 'string') return null;
      const trimmed = req.body.note.trim();
      return trimmed.length > 0 ? trimmed : null;
    })();

    await client.query('BEGIN');
    transactionStarted = true;

    const upsertResult = await client.query(
      `INSERT INTO public.campaign_spawns
         (campaign_id, name, note, world_position, is_default, created_by, updated_by)
       VALUES
         ($1, $2, $3, ST_SetSRID(ST_MakePoint($4, $5), 0), true, $6, $6)
       ON CONFLICT (campaign_id) WHERE is_default = true
       DO UPDATE SET
         name = EXCLUDED.name,
         note = EXCLUDED.note,
         world_position = EXCLUDED.world_position,
         updated_at = NOW(),
         updated_by = EXCLUDED.updated_by,
         is_default = true
       RETURNING id, campaign_id, name, note, is_default,
                 ST_AsGeoJSON(world_position)::json AS geometry,
                 created_at, updated_at`,
      [campaignId, name, note, target.x, target.y, req.user.id]
    );

    await client.query('COMMIT');
    transactionStarted = false;

    const formatted = formatSpawnRow(upsertResult.rows[0]);

    incrementCounter('campaign_spawns.upserted');
    recordEvent('campaign.spawn_upserted', {
      campaignId,
      spawnId: formatted.id,
      userId: req.user.id,
      hasNote: Boolean(formatted.note),
    });
    logInfo('Campaign spawn upserted', {
      telemetryEvent: 'campaign.spawn_upserted',
      campaignId,
      userId: req.user.id,
      hasNote: Boolean(formatted.note),
    });

    if (wsServer) {
      wsServer.emitSpawnUpdated(campaignId, formatted, {
        action: 'upserted',
        actorId: req.user.id,
      });
    }

    res.json({ spawn: formatted });
  } catch (error) {
    if (transactionStarted) {
      await client.query('ROLLBACK').catch(() => {});
    }
    logError('Campaign spawn upsert failed', error, {
      campaignId,
      userId: req.user?.id,
    });
    res.status(error.status || 500).json({
      error: error.code || 'spawn_upsert_failed',
      message: error.message || 'Failed to update spawn location.',
    });
  } finally {
    client.release();
  }
});

router.get(
  '/api/campaigns/:campaignId/objectives',
  requireAuth,
  requireCampaignParticipation,
  async (req, res) => {
    const { campaignId } = req.params;
    const client = await getClient();
    try {
      const viewer = await getViewerContextOrThrow(client, campaignId, req.user);
      if (!viewer.isAdmin && !['dm', 'co-dm'].includes(viewer.role)) {
        return res.status(403).json({
          error: 'objective_access_forbidden',
          message: 'Only DMs can view campaign objectives.',
        });
      }

      const { rows } = await client.query(
        `SELECT ${OBJECTIVE_RETURNING_FIELDS}
           FROM public.campaign_objectives
          WHERE campaign_id = $1
          ORDER BY parent_id NULLS FIRST, order_index ASC, created_at ASC`,
        [campaignId]
      );

      res.json({ objectives: rows.map(formatObjectiveRow) });
    } catch (error) {
      logError('[Objectives] List error:', error);
      res.status(500).json({ error: 'Failed to fetch objectives' });
    } finally {
      client.release();
    }
  }
);

router.post(
  '/api/campaigns/:campaignId/objectives',
  requireAuth,
  requireCampaignParticipation,
  async (req, res) => {
    const { campaignId } = req.params;
    const client = await getClient();
    const wsServer = req.app?.locals?.wsServer ?? null;
    let transactionStarted = false;
    try {
      const viewer = await getViewerContextOrThrow(client, campaignId, req.user);
      if (!viewer.isAdmin && !['dm', 'co-dm'].includes(viewer.role)) {
        return res.status(403).json({
          error: 'objective_forbidden',
          message: 'Only DMs can create campaign objectives.',
        });
      }

      const parentCandidateId = req.body?.parentId ?? req.body?.parent_id ?? null;
      let parentObjective = null;
      if (parentCandidateId) {
        parentObjective = await fetchObjectiveById(client, parentCandidateId);
        if (!parentObjective || parentObjective.campaign_id !== campaignId) {
          return res.status(404).json({
            error: 'parent_not_found',
            message: 'Parent objective not found in this campaign.',
          });
        }
      }

      const sanitized = sanitizeObjectivePayload(req.body ?? {}, {
        requireTitle: true,
        campaignId,
        parentObjective,
      });

      await client.query('BEGIN');
      transactionStarted = true;

      const columns = ['campaign_id', 'title', 'created_by', 'updated_by'];
      const placeholders = ['$1', '$2', '$3', '$4'];
      const values = [campaignId, sanitized.title, req.user.id, req.user.id];
      let paramIndex = values.length + 1;

      if (Object.prototype.hasOwnProperty.call(sanitized, 'parentId')) {
        columns.push('parent_id');
        placeholders.push(`$${paramIndex}`);
        values.push(sanitized.parentId);
        paramIndex += 1;
      }

      if (Object.prototype.hasOwnProperty.call(sanitized, 'orderIndex')) {
        columns.push('order_index');
        placeholders.push(`$${paramIndex}`);
        values.push(sanitized.orderIndex);
        paramIndex += 1;
      }

      if (Object.prototype.hasOwnProperty.call(sanitized, 'isMajor')) {
        columns.push('is_major');
        placeholders.push(`$${paramIndex}`);
        values.push(Boolean(sanitized.isMajor));
        paramIndex += 1;
      }

      if (Object.prototype.hasOwnProperty.call(sanitized, 'slug')) {
        columns.push('slug');
        placeholders.push(`$${paramIndex}`);
        values.push(sanitized.slug);
        paramIndex += 1;
      }

      if (sanitized.markdown) {
        for (const field of MARKDOWN_FIELDS) {
          if (Object.prototype.hasOwnProperty.call(sanitized.markdown, field)) {
            columns.push(field);
            placeholders.push(`$${paramIndex}`);
            values.push(sanitized.markdown[field]);
            paramIndex += 1;
          }
        }
      }

      if (sanitized.location) {
        columns.push('location_type');
        placeholders.push(`$${paramIndex}`);
        values.push(sanitized.location.type);
        paramIndex += 1;

        if (sanitized.location.type === 'pin') {
          columns.push('location_pin');
          placeholders.push(`ST_SetSRID(ST_MakePoint($${paramIndex}, $${paramIndex + 1}), 0)`);
          values.push(sanitized.location.pin.x, sanitized.location.pin.y);
          paramIndex += 2;
        } else if (sanitized.location.type === 'burg') {
          columns.push('location_burg_id');
          placeholders.push(`$${paramIndex}`);
          values.push(sanitized.location.burgId);
          paramIndex += 1;
        } else if (sanitized.location.type === 'marker') {
          columns.push('location_marker_id');
          placeholders.push(`$${paramIndex}`);
          values.push(sanitized.location.markerId);
          paramIndex += 1;
        }
      }

      const insertSql = `INSERT INTO public.campaign_objectives (${columns.join(', ')}) VALUES (${placeholders.join(', ')}) RETURNING ${OBJECTIVE_RETURNING_FIELDS}`;
      const insertResult = await client.query(insertSql, values);

      await client.query('COMMIT');
      transactionStarted = false;

      const objective = formatObjectiveRow(insertResult.rows[0]);
      incrementCounter('objectives.created');
      recordEvent('objective.created', {
        campaignId,
        objectiveId: objective.id,
        userId: req.user.id,
        parentId: objective.parentId ?? null,
        isMajor: Boolean(objective.isMajor),
      });
      logInfo('Objective created', {
        telemetryEvent: 'objective.created',
        campaignId,
        objectiveId: objective.id,
        userId: req.user.id,
      });

      if (wsServer) {
        wsServer.emitObjectiveCreated(campaignId, objective, {
          actorId: req.user.id,
        });
      }

      res.status(201).json({ objective });
    } catch (error) {
      if (transactionStarted) {
        await client.query('ROLLBACK').catch(() => {});
      }

      if (error instanceof ObjectiveValidationError) {
        return res.status(400).json({
          error: error.code,
          message: error.message,
        });
      }

      logError('Objective creation failed', error, {
        campaignId,
        userId: req.user?.id,
      });
      res.status(error.status || 500).json({
        error: error.code || 'objective_create_failed',
        message: error.message || 'Failed to create objective',
      });
    } finally {
      client.release();
    }
  }
);

router.put('/api/objectives/:objectiveId', requireAuth, async (req, res) => {
  const { objectiveId } = req.params;
    const client = await getClient();
    const wsServer = req.app?.locals?.wsServer ?? null;
    let transactionStarted = false;
  try {
    await client.query('BEGIN');
    transactionStarted = true;

    const existing = await fetchObjectiveWithCampaign(client, objectiveId);
    if (!existing) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Objective not found' });
    }

    const viewer = await getViewerContextOrThrow(client, existing.campaign_id, req.user);
    if (!viewer.isAdmin && !['dm', 'co-dm'].includes(viewer.role)) {
      await client.query('ROLLBACK');
      return res.status(403).json({
        error: 'objective_forbidden',
        message: 'Only DMs can update objectives.',
      });
    }

    const parentCandidateId = req.body?.parentId ?? req.body?.parent_id ?? undefined;
    let parentObjective = null;
    if (parentCandidateId) {
      parentObjective = await fetchObjectiveById(client, parentCandidateId);
      if (!parentObjective || parentObjective.campaign_id !== existing.campaign_id) {
        await client.query('ROLLBACK');
        return res.status(404).json({
          error: 'parent_not_found',
          message: 'Parent objective not found in this campaign.',
        });
      }
    }

    const descendantIds = await fetchObjectiveDescendantIds(client, objectiveId);

    const sanitized = sanitizeObjectivePayload(req.body ?? {}, {
      requireTitle: false,
      campaignId: existing.campaign_id,
      parentObjective,
      ancestorIds: descendantIds,
      selfId: objectiveId,
    });

    const updates = [];
    const values = [];
    let paramIndex = 1;

    if (Object.prototype.hasOwnProperty.call(sanitized, 'title')) {
      updates.push(`title = $${paramIndex}`);
      values.push(sanitized.title);
      paramIndex += 1;
    }

    if (Object.prototype.hasOwnProperty.call(sanitized, 'parentId')) {
      updates.push(`parent_id = $${paramIndex}`);
      values.push(sanitized.parentId);
      paramIndex += 1;
    }

    if (Object.prototype.hasOwnProperty.call(sanitized, 'orderIndex')) {
      updates.push(`order_index = $${paramIndex}`);
      values.push(sanitized.orderIndex);
      paramIndex += 1;
    }

    if (Object.prototype.hasOwnProperty.call(sanitized, 'isMajor')) {
      updates.push(`is_major = $${paramIndex}`);
      values.push(Boolean(sanitized.isMajor));
      paramIndex += 1;
    }

    if (Object.prototype.hasOwnProperty.call(sanitized, 'slug')) {
      updates.push(`slug = $${paramIndex}`);
      values.push(sanitized.slug);
      paramIndex += 1;
    }

    if (sanitized.markdown) {
      for (const field of MARKDOWN_FIELDS) {
        if (Object.prototype.hasOwnProperty.call(sanitized.markdown, field)) {
          updates.push(`${field} = $${paramIndex}`);
          values.push(sanitized.markdown[field]);
          paramIndex += 1;
        }
      }
    }

    if (sanitized.location) {
      updates.push(`location_type = $${paramIndex}`);
      values.push(sanitized.location.type);
      paramIndex += 1;

      if (sanitized.location.type === 'pin') {
        updates.push(`location_pin = ST_SetSRID(ST_MakePoint($${paramIndex}, $${paramIndex + 1}), 0)`);
        values.push(sanitized.location.pin.x, sanitized.location.pin.y);
        paramIndex += 2;
        updates.push('location_burg_id = NULL');
        updates.push('location_marker_id = NULL');
      } else if (sanitized.location.type === 'burg') {
        updates.push(`location_burg_id = $${paramIndex}`);
        values.push(sanitized.location.burgId);
        paramIndex += 1;
        updates.push('location_marker_id = NULL');
        updates.push('location_pin = NULL');
      } else if (sanitized.location.type === 'marker') {
        updates.push(`location_marker_id = $${paramIndex}`);
        values.push(sanitized.location.markerId);
        paramIndex += 1;
        updates.push('location_burg_id = NULL');
        updates.push('location_pin = NULL');
      } else {
        updates.push('location_burg_id = NULL');
        updates.push('location_marker_id = NULL');
        updates.push('location_pin = NULL');
      }
    }

    if (updates.length === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: 'no_changes',
        message: 'No valid fields were provided for update.',
      });
    }

    updates.push('updated_at = NOW()');
    updates.push(`updated_by = $${paramIndex}`);
    values.push(req.user.id);
    paramIndex += 1;

    values.push(objectiveId);

    const updateQuery = `UPDATE public.campaign_objectives SET ${updates.join(', ')} WHERE id = $${paramIndex} RETURNING ${OBJECTIVE_RETURNING_FIELDS}`;
    const updateResult = await client.query(updateQuery, values);

    await client.query('COMMIT');
    transactionStarted = false;

    const objective = formatObjectiveRow(updateResult.rows[0]);
    incrementCounter('objectives.updated');
    recordEvent('objective.updated', {
      campaignId: existing.campaign_id,
      objectiveId,
      userId: req.user.id,
      parentId: objective.parentId ?? null,
      isMajor: Boolean(objective.isMajor),
    });
    logInfo('Objective updated', {
      telemetryEvent: 'objective.updated',
      objectiveId,
      campaignId: existing.campaign_id,
      userId: req.user.id,
    });

    if (wsServer) {
      wsServer.emitObjectiveUpdated(existing.campaign_id, objective, {
        actorId: req.user.id,
      });
    }

    res.json({ objective });
  } catch (error) {
    if (transactionStarted) {
      await client.query('ROLLBACK').catch(() => {});
    }

    if (error instanceof ObjectiveValidationError) {
      return res.status(400).json({
        error: error.code,
        message: error.message,
      });
    }

    logError('Objective update failed', error, { objectiveId, userId: req.user?.id });
    res.status(error.status || 500).json({
      error: error.code || 'objective_update_failed',
      message: error.message || 'Failed to update objective',
    });
  } finally {
    client.release();
  }
});

router.delete('/api/objectives/:objectiveId', requireAuth, async (req, res) => {
  const { objectiveId } = req.params;
  const client = await getClient();
  let transactionStarted = false;
  try {
    await client.query('BEGIN');
    transactionStarted = true;

    const existing = await fetchObjectiveWithCampaign(client, objectiveId);
    if (!existing) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Objective not found' });
    }

    const viewer = await getViewerContextOrThrow(client, existing.campaign_id, req.user);
    if (!viewer.isAdmin && !['dm', 'co-dm'].includes(viewer.role)) {
      await client.query('ROLLBACK');
      return res.status(403).json({
        error: 'objective_forbidden',
        message: 'Only DMs can delete objectives.',
      });
    }

    const deleteResult = await client.query(
      `WITH RECURSIVE tree AS (
         SELECT id FROM public.campaign_objectives WHERE id = $1
         UNION ALL
         SELECT child.id
           FROM public.campaign_objectives child
           JOIN tree t ON child.parent_id = t.id
       )
       DELETE FROM public.campaign_objectives
       WHERE id IN (SELECT id FROM tree)
       RETURNING id`,
      [objectiveId]
    );

    await client.query('COMMIT');
    transactionStarted = false;

    const deletedObjectiveIds = deleteResult.rows.map((row) => row.id);

    incrementCounter('objectives.deleted', deleteResult.rowCount ?? 1);
    recordEvent('objective.deleted', {
      campaignId: existing.campaign_id,
      objectiveId,
      deletedObjectiveIds,
      userId: req.user.id,
    });

    logInfo('Objective deleted', {
      telemetryEvent: 'objective.deleted',
      objectiveId,
      deletedCount: deleteResult.rowCount,
      campaignId: existing.campaign_id,
      userId: req.user.id,
    });

    if (wsServer) {
      wsServer.emitObjectiveDeleted(existing.campaign_id, deletedObjectiveIds, {
        actorId: req.user.id,
      });
    }

    res.json({ deletedObjectiveIds });
  } catch (error) {
    if (transactionStarted) {
      await client.query('ROLLBACK').catch(() => {});
    }

    logError('Objective delete failed', error, { objectiveId, userId: req.user?.id });
    res.status(error.status || 500).json({
      error: error.code || 'objective_delete_failed',
      message: error.message || 'Failed to delete objective',
    });
  } finally {
    client.release();
  }
});

router.post(
  '/api/objectives/:objectiveId/assist/description',
  requireAuth,
  objectiveAssistValidators,
  handleValidationErrors,
  createObjectiveAssistHandler('description')
);

router.post(
  '/api/objectives/:objectiveId/assist/treasure',
  requireAuth,
  objectiveAssistValidators,
  handleValidationErrors,
  createObjectiveAssistHandler('treasure')
);

router.post(
  '/api/objectives/:objectiveId/assist/combat',
  requireAuth,
  objectiveAssistValidators,
  handleValidationErrors,
  createObjectiveAssistHandler('combat')
);

router.post(
  '/api/objectives/:objectiveId/assist/npcs',
  requireAuth,
  objectiveAssistValidators,
  handleValidationErrors,
  createObjectiveAssistHandler('npcs')
);

router.post(
  '/api/objectives/:objectiveId/assist/rumours',
  requireAuth,
  objectiveAssistValidators,
  handleValidationErrors,
  createObjectiveAssistHandler('rumours')
);

router.get(
  '/api/campaigns/:campaignId/players/visible',
  requireAuth,
  requireCampaignParticipation,
  async (req, res) => {
    const { campaignId } = req.params;
    const radiusOverride = extractNumeric(req.query?.radius);
    const radius = radiusOverride !== null ? Math.max(radiusOverride, 0) : DEFAULT_VISIBILITY_RADIUS;

    const client = await getClient();
    try {
      const viewer = await getViewerContextOrThrow(client, campaignId, req.user);

      const { rows } = await client.query(
        `SELECT player_id, user_id, character_id, role, visibility_state,
                ST_AsGeoJSON(loc)::json AS geometry,
                can_view_history
           FROM visible_player_positions($1, $2, $3)` ,
        [campaignId, req.user.id, radius]
      );

      const features = rows.map((row) => ({
        type: 'Feature',
        geometry: row.geometry,
        properties: {
          playerId: row.player_id,
          userId: row.user_id,
          characterId: row.character_id,
          role: row.role,
          visibilityState: row.visibility_state,
          canViewHistory: row.can_view_history,
        },
      }));

      res.json({
        type: 'FeatureCollection',
        features,
        metadata: {
          radius,
          viewerRole: viewer.role,
        },
      });
    } catch (error) {
      logError('[Movement] Visible players error:', error);
      res.status(500).json({ error: 'Failed to load visible players' });
    } finally {
      client.release();
    }
  }
);

router.get(
  '/api/campaigns/:campaignId/players/:playerId/trail',
  requireAuth,
  requireCampaignParticipation,
  async (req, res) => {
    const { campaignId, playerId } = req.params;
    const radiusOverride = extractNumeric(req.query?.radius);
    const radius = radiusOverride !== null ? Math.max(radiusOverride, 0) : DEFAULT_VISIBILITY_RADIUS;

    const client = await getClient();
    try {
      const viewer = await getViewerContextOrThrow(client, campaignId, req.user);

      const visibilityCheck = await client.query(
        `SELECT player_id, can_view_history
           FROM visible_player_positions($1, $2, $3)
          WHERE player_id = $4`,
        [campaignId, req.user.id, radius, playerId]
      );

      const canViewHistory = visibilityCheck.rowCount > 0 && visibilityCheck.rows[0].can_view_history;
      const isSelf = viewer.campaign_player_id && viewer.campaign_player_id === playerId;
      const isDungeonMaster = viewer.isAdmin || ['dm', 'co-dm'].includes(viewer.role);

      if (!isDungeonMaster && !isSelf && !canViewHistory) {
        res.set('Cache-Control', 'no-store, must-revalidate');
        return res.status(403).json({
          error: 'trail_hidden',
          message: 'Trail is not visible to the current user.',
        });
      }

      const trailResult = await client.query(
        `SELECT ST_AsGeoJSON(trail_geom)::json AS geometry,
                point_count,
                recorded_from,
                recorded_to
           FROM public.v_player_recent_trails
          WHERE campaign_id = $1 AND player_id = $2`,
        [campaignId, playerId]
      );

      if (trailResult.rowCount === 0) {
        res.set('Cache-Control', 'no-store, must-revalidate');
        return res.status(404).json({
          error: 'trail_not_found',
          message: 'No trail data recorded for this player.',
        });
      }

      const trail = trailResult.rows[0];

      res.set('Cache-Control', 'private, max-age=5, must-revalidate');
      res.set('Vary', 'Authorization');
      res.json({
        playerId,
        geometry: trail.geometry,
        pointCount: trail.point_count,
        recordedFrom: trail.recorded_from ? new Date(trail.recorded_from).toISOString() : null,
        recordedTo: trail.recorded_to ? new Date(trail.recorded_to).toISOString() : null,
      });
    } catch (error) {
      logError('[Movement] Trail fetch error:', error);
      res.set('Cache-Control', 'no-store, must-revalidate');
      res.status(500).json({ error: 'Failed to load player trail' });
    } finally {
      client.release();
    }
  }
);

router.get(
  '/api/campaigns/:campaignId/movement-audit',
  requireAuth,
  requireCampaignParticipation,
  async (req, res) => {
    const { campaignId } = req.params;
    const limitParam = Number.parseInt(req.query?.limit, 10);
    const limit = Number.isFinite(limitParam) ? Math.min(Math.max(limitParam, 1), 200) : 50;
    const beforeRaw = req.query?.before;
    let before = null;

    if (beforeRaw) {
      const timestamp = Date.parse(beforeRaw);
      if (Number.isNaN(timestamp)) {
        return res.status(400).json({
          error: 'invalid_cursor',
          message: 'Invalid before cursor provided.',
        });
      }
      before = new Date(timestamp).toISOString();
    }

    const client = await getClient();
    try {
      const viewer = await getViewerContextOrThrow(client, campaignId, req.user);
      if (!viewer.isAdmin && !['dm', 'co-dm'].includes(viewer.role)) {
        return res.status(403).json({
          error: 'audit_forbidden',
          message: 'Only campaign DMs can review movement audits.',
        });
      }

      const { rows } = await client.query(
        `SELECT pma.id,
                pma.player_id,
                pma.moved_by,
                pma.mode,
                pma.reason,
                pma.created_at,
                ST_AsGeoJSON(pma.previous_loc)::json AS previous_geometry,
                ST_AsGeoJSON(pma.new_loc)::json AS new_geometry,
                cp.user_id,
                cp.character_id
           FROM public.player_movement_audit pma
           LEFT JOIN public.campaign_players cp ON cp.id = pma.player_id
          WHERE pma.campaign_id = $1
            AND ($3::timestamptz IS NULL OR pma.created_at < $3)
          ORDER BY pma.created_at DESC
          LIMIT $2`,
        [campaignId, limit, before]
      );

      res.json({
        entries: rows.map((row) => ({
          id: row.id,
          playerId: row.player_id,
          movedBy: row.moved_by,
          mode: row.mode,
          reason: row.reason,
          createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
          previousGeometry: row.previous_geometry,
          newGeometry: row.new_geometry,
          userId: row.user_id,
          characterId: row.character_id,
        })),
        pagination: {
          limit,
          before,
          hasMore: rows.length === limit,
        },
      });
    } catch (error) {
      logError('[Movement] Audit fetch error:', error);
      res.status(500).json({ error: 'Failed to load movement audit' });
    } finally {
      client.release();
    }
  }
);

router.put('/api/campaigns/:id', requireAuth, requireCampaignOwnership, async (req, res) => {
  const { id } = req.params;

  const client = await getClient();
  try {
    const existingResult = await client.query('SELECT * FROM campaigns WHERE id = $1 LIMIT 1', [id]);
    if (existingResult.rowCount === 0) {
      return res.status(404).json({ error: 'Campaign not found' });
    }

    const existingCampaign = existingResult.rows[0];
    const updates = {};

    if (Object.prototype.hasOwnProperty.call(req.body, 'name')) {
      const trimmed = typeof req.body.name === 'string' ? req.body.name.trim() : '';
      if (!trimmed) {
        return res.status(400).json({
          error: 'invalid_name',
          message: 'Campaign name cannot be empty.',
        });
      }
      updates.name = trimmed;
    }

    if (Object.prototype.hasOwnProperty.call(req.body, 'description')) {
      updates.description = coerceNullableString(req.body.description);
    }

    if (Object.prototype.hasOwnProperty.call(req.body, 'system')) {
      updates.system = coerceNullableString(req.body.system);
    }

    if (Object.prototype.hasOwnProperty.call(req.body, 'setting')) {
      updates.setting = coerceNullableString(req.body.setting);
    }

    const maxPlayersInput = pickProvided(req.body.max_players, req.body.maxPlayers);
    if (maxPlayersInput !== undefined) {
      try {
        updates.max_players = parseMaxPlayersInput(maxPlayersInput, { required: true });
      } catch (error) {
        return res.status(400).json({
          error: 'invalid_max_players',
          message: error.message,
        });
      }
    }

    const levelRangeInput = pickProvided(req.body.level_range, req.body.levelRange);
    if (levelRangeInput !== undefined) {
      try {
        updates.level_range = JSON.stringify(parseLevelRangeInput(levelRangeInput, { fallbackToDefault: false }));
      } catch (error) {
        return res.status(400).json({
          error: 'invalid_level_range',
          message: error.message,
        });
      }
    }

    if (Object.prototype.hasOwnProperty.call(req.body, 'status')) {
      const candidateStatus = typeof req.body.status === 'string' ? req.body.status.trim() : '';
      if (!CAMPAIGN_STATUS_VALUES.has(candidateStatus)) {
        return res.status(400).json({
          error: 'invalid_status',
          message: 'Status must be one of recruiting, active, paused, or completed.',
        });
      }
      updates.status = candidateStatus;
    }

    const isPublicInput = pickProvided(req.body.is_public, req.body.isPublic);
    if (isPublicInput !== undefined) {
      updates.is_public = coerceBooleanInput(isPublicInput);
    }

    const worldMapInput = pickProvided(req.body.world_map_id, req.body.worldMapId);
    if (worldMapInput !== undefined) {
      updates.world_map_id = worldMapInput === null ? null : coerceNullableString(worldMapInput);
    }

    const allowSpectatorsInput = pickProvided(req.body.allow_spectators, req.body.allowSpectators);
    if (allowSpectatorsInput !== undefined) {
      updates.allow_spectators = coerceBooleanInput(allowSpectatorsInput);
    }

    const autoApproveInput = pickProvided(req.body.auto_approve_join_requests, req.body.autoApproveJoinRequests);
    if (autoApproveInput !== undefined) {
      updates.auto_approve_join_requests = coerceBooleanInput(autoApproveInput);
    }

    const experienceTypeInput = pickProvided(req.body.experience_type, req.body.experienceType);
    if (experienceTypeInput !== undefined) {
      if (typeof experienceTypeInput !== 'string' || !EXPERIENCE_TYPE_VALUES.has(experienceTypeInput)) {
        return res.status(400).json({
          error: 'invalid_experience_type',
          message: 'Experience type must be "milestone" or "experience_points".',
        });
      }
      updates.experience_type = experienceTypeInput;
    }

    const restingRulesInput = pickProvided(req.body.resting_rules, req.body.restingRules);
    if (restingRulesInput !== undefined) {
      if (typeof restingRulesInput !== 'string' || !RESTING_RULE_VALUES.has(restingRulesInput)) {
        return res.status(400).json({
          error: 'invalid_resting_rules',
          message: 'Resting rules must be one of standard, gritty, or heroic.',
        });
      }
      updates.resting_rules = restingRulesInput;
    }

    const deathSaveRulesInput = pickProvided(req.body.death_save_rules, req.body.deathSaveRules);
    if (deathSaveRulesInput !== undefined) {
      if (typeof deathSaveRulesInput !== 'string' || !DEATH_SAVE_RULE_VALUES.has(deathSaveRulesInput)) {
        return res.status(400).json({
          error: 'invalid_death_save_rules',
          message: 'Death save rules must be one of standard, hardcore, or forgiving.',
        });
      }
      updates.death_save_rules = deathSaveRulesInput;
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({
        error: 'no_changes',
        message: 'No valid fields were provided for update.',
      });
    }

    updates.updated_at = new Date().toISOString();

    const nextStatus = Object.prototype.hasOwnProperty.call(updates, 'status')
      ? updates.status
      : existingCampaign.status;
    const nextWorldMapId = Object.prototype.hasOwnProperty.call(updates, 'world_map_id')
      ? updates.world_map_id
      : existingCampaign.world_map_id;

    if (nextStatus === 'active' && !nextWorldMapId) {
      return res.status(409).json({
        error: 'world_map_required',
        message: 'Active campaigns must have a world map configured before inviting players.',
      });
    }

    const entries = Object.entries(updates);
    const setClause = entries
      .map(([column], index) => {
        const placeholder = `$${index + 1}`;
        if (column === 'level_range') {
          return `${column} = ${placeholder}::jsonb`;
        }
        return `${column} = ${placeholder}`;
      })
      .join(', ');

    const values = entries.map(([, value]) => value);
    values.push(id);

    const result = await client.query(
      `UPDATE campaigns SET ${setClause} WHERE id = $${entries.length + 1} RETURNING *`,
      values
    );

    const campaign = result.rows[0];
    logInfo('Campaign updated', { campaignId: id, dmUserId: existingCampaign.dm_user_id });

    return res.json({ campaign });
  } catch (error) {
    if (error.code === '23505' && error.constraint === 'uq_campaign_name_per_dm') {
      logWarn('Campaign name conflict detected during update', { campaignId: id });
      return res.status(409).json({
        error: 'campaign_name_conflict',
        message: 'You already have a campaign with that name. Choose a different name.',
      });
    }

    logError('Campaign update failed', error, { campaignId: id });
    return res.status(500).json({ error: 'Failed to update campaign' });
  } finally {
    client.release();
  }
});

router.delete('/api/campaigns/:id', async (req, res) => {
  const { id } = req.params;
  const { dmUserId } = req.body;

  if (!dmUserId) {
    return res.status(400).json({ error: 'DM user ID required for campaign deletion' });
  }

  try {
    const client = await getClient();
    
    // Verify user is the DM
    const campaignCheck = await client.query(
      'SELECT dm_user_id FROM campaigns WHERE id = $1',
      [id]
    );
    
    if (campaignCheck.rows.length === 0) {
      client.release();
      return res.status(404).json({ error: 'Campaign not found' });
    }
    
    if (campaignCheck.rows[0].dm_user_id !== dmUserId) {
      client.release();
      return res.status(403).json({ error: 'Only the DM can delete this campaign' });
    }
    
    const result = await client.query('DELETE FROM campaigns WHERE id = $1 RETURNING *', [id]);
    client.release();

    res.json({ message: 'Campaign deleted successfully' });
  } catch (error) {
    logError('[Campaigns] Delete error:', error);
    res.status(500).json({ error: 'Failed to delete campaign' });
  }
});


export const registerCampaignRoutes = (app) => {
  app.use(router);
};
