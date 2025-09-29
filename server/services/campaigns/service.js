import { DEFAULT_VISIBILITY_RADIUS, DEFAULT_MAX_MOVE_DISTANCE, DEFAULT_MIN_MOVE_INTERVAL_MS } from './utils.js';
import { getMovementConfig, snapToGrid, computeDistance } from './movement-config.js';

export const MOVE_MODES = ['walk', 'ride', 'boat', 'fly', 'teleport', 'gm'];
export const MOVE_MODE_SET = new Set(MOVE_MODES);
export const TELEPORT_MODES = new Set(['teleport', 'gm']);
export const DM_CONTROL_ROLES = new Set(['dm', 'co-dm']);
export const ENCOUNTER_TYPES = new Set(['combat', 'social', 'exploration', 'puzzle', 'rumour']);
export const SIDEBAR_ENCOUNTER_DIFFICULTIES = new Set(['easy', 'medium', 'hard', 'deadly']);
export const MAX_FOCUS_LENGTH = 500;
export const MAX_CONTEXT_LENGTH = 20000;
export const MAX_SENTIMENT_SUMMARY_LENGTH = 1000;

export const formatSpawnRow = (row) => ({
  id: row.id,
  campaignId: row.campaign_id,
  name: row.name,
  note: row.note ?? null,
  isDefault: row.is_default,
  geometry: row.geometry,
  createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
  updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at,
});

export const isAdminUser = (user) => Array.isArray(user?.roles) && user.roles.includes('admin');

export const extractNumeric = (value) => {
  if (value === undefined || value === null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

export const normalizeTargetCoordinates = (input) => {
  if (!input || typeof input !== 'object') return null;
  const candidate = input.target && typeof input.target === 'object' ? input.target : input;
  const x = extractNumeric(
    candidate.x ?? candidate.lon ?? candidate.lng ?? candidate.longitude ?? candidate.east ?? candidate.right,
  );
  const y = extractNumeric(
    candidate.y ?? candidate.lat ?? candidate.latitude ?? candidate.north ?? candidate.top,
  );
  if (x === null || y === null) {
    return null;
  }
  return { x, y };
};

export const parseBounds = (bounds) => {
  if (!bounds) return null;
  const source = typeof bounds === 'string'
    ? (() => {
        try {
          return JSON.parse(bounds);
        } catch {
          return null;
        }
      })()
    : bounds;

  if (!source) return null;

  const west = extractNumeric(source.west);
  const east = extractNumeric(source.east);
  const south = extractNumeric(source.south);
  const north = extractNumeric(source.north);

  if ([west, east, south, north].some((value) => value === null)) {
    return null;
  }

  return { west, east, south, north };
};

export const pointWithinBounds = (bounds, x, y) => {
  const parsed = parseBounds(bounds);
  if (!parsed) return false;
  return x >= parsed.west && x <= parsed.east && y >= parsed.south && y <= parsed.north;
};

export const ensureDmControl = (viewer, message = 'Only the campaign DM or co-DM may perform this action') => {
  if (viewer.isAdmin || DM_CONTROL_ROLES.has(viewer.role)) {
    return;
  }

  const error = new Error(message);
  error.status = 403;
  error.code = 'dm_action_forbidden';
  throw error;
};

export const resolveCampaignViewerContext = async (client, campaignId, userId) => {
  const { rows } = await client.query(
    `SELECT 
        CASE 
          WHEN c.dm_user_id = $2 THEN 'dm'
          WHEN cp.role = 'co-dm' THEN 'co-dm'
          WHEN cp.user_id IS NOT NULL THEN 'player'
          ELSE NULL
        END AS role,
        cp.id AS campaign_player_id
      FROM public.campaigns c
      LEFT JOIN public.campaign_players cp
        ON cp.campaign_id = c.id
       AND cp.user_id = $2
      WHERE c.id = $1
      LIMIT 1`,
    [campaignId, userId],
  );
  if (rows.length === 0) {
    return { role: null, campaign_player_id: null };
  }
  return rows[0];
};

export const getViewerContextOrThrow = async (client, campaignId, user) => {
  const viewer = await resolveCampaignViewerContext(client, campaignId, user.id);
  const isAdmin = isAdminUser(user);
  const role = viewer.role || (isAdmin ? 'dm' : null);

  if (!role && !isAdmin) {
    const error = new Error('You must be part of this campaign to access this resource');
    error.status = 403;
    error.code = 'campaign_access_forbidden';
    throw error;
  }

  return { ...viewer, role, isAdmin };
};


export const sanitizeReason = (reason) => {
  if (typeof reason !== 'string') return null;
  const trimmed = reason.trim();
  if (!trimmed) return null;
  return trimmed.length > 512 ? trimmed.slice(0, 512) : trimmed;
};
export const performPlayerMovement = async ({
  client,
  campaignId,
  playerId,
  requestorUserId,
  requestorRole,
  isRequestorAdmin = false,
  targetX,
  targetY,
  mode,
  reason,
  enforceClamp = true,
}) => {
  if (!MOVE_MODE_SET.has(mode)) {
    const error = new Error(`Unsupported movement mode: ${mode}`);
    error.status = 400;
    error.code = 'invalid_move_mode';
    throw error;
  }

  if (!isRequestorAdmin && !DM_CONTROL_ROLES.has(requestorRole)) {
    const error = new Error('Only DMs or co-DMs may move players');
    error.status = 403;
    error.code = 'move_forbidden';
    throw error;
  }

  if (typeof targetX !== 'number' || typeof targetY !== 'number') {
    const error = new Error('Target coordinates are required');
    error.status = 400;
    error.code = 'invalid_target';
    throw error;
  }

  const movementConfig = getMovementConfig();
  const requestedTarget = { x: targetX, y: targetY };
  const snappedTarget = snapToGrid(targetX, targetY);

  if (enforceClamp) {
    const { rows: boundsRows } = await client.query(
      'SELECT bounds FROM public.maps_world mw JOIN public.campaigns c ON c.world_map_id = mw.id WHERE c.id = $1',
      [campaignId],
    );

    const bounds = boundsRows[0]?.bounds;
    if (bounds && !pointWithinBounds(bounds, snappedTarget.x, snappedTarget.y)) {
      const error = new Error('Target location is outside the campaign map bounds');
      error.status = 400;
      error.code = 'target_out_of_bounds';
      throw error;
    }
  }

  const { rows: currentRows } = await client.query(
    `SELECT id,
            user_id,
            campaign_id,
            visibility_state,
            last_located_at,
            ST_X(loc_current) AS prev_x,
            ST_Y(loc_current) AS prev_y
       FROM public.campaign_players
      WHERE campaign_id = $1
        AND id = $2
      FOR UPDATE`,
    [campaignId, playerId],
  );

  if (currentRows.length === 0) {
    const error = new Error('Campaign player not found');
    error.status = 404;
    error.code = 'player_not_found';
    throw error;
  }

  const existing = currentRows[0];
  const hasPrevious = existing.prev_x !== null && existing.prev_y !== null;
  const previousPoint = hasPrevious
    ? { x: Number(existing.prev_x), y: Number(existing.prev_y) }
    : { x: snappedTarget.x, y: snappedTarget.y };
  const previousTimestamp = existing.last_located_at
    ? new Date(existing.last_located_at).getTime() / 1000
    : Date.now() / 1000;

  await client.query(
    `UPDATE public.campaign_players
        SET loc_current = ST_SetSRID(ST_MakePoint($1, $2), 0),
            last_located_at = NOW()
      WHERE campaign_id = $3
        AND id = $4`,
    [snappedTarget.x, snappedTarget.y, campaignId, playerId],
  );

  const updateResult = await client.query(
    `SELECT id,
            visibility_state,
            ST_AsGeoJSON(loc_current)::json AS geometry,
            last_located_at
       FROM public.campaign_players
      WHERE campaign_id = $1 AND id = $2`,
    [campaignId, playerId],
  );
  const updatedPlayer = updateResult.rows[0] ?? null;

  if (!updatedPlayer) {
    const error = new Error('Failed to load updated player state');
    error.status = 500;
    error.code = 'player_state_missing';
    throw error;
  }

  const nowTimestamp = updatedPlayer.last_located_at
    ? new Date(updatedPlayer.last_located_at).getTime() / 1000
    : Date.now() / 1000;

  const distance = hasPrevious ? computeDistance(previousPoint, snappedTarget) : null;

  await client.query(
    `INSERT INTO public.player_movement_audit
        (campaign_id, player_id, moved_by, mode, reason, previous_loc, new_loc)
     VALUES
        ($1, $2, $3, $4, $5,
         ST_SetSRID(ST_MakePoint($6, $7), 0),
         ST_SetSRID(ST_MakePoint($8, $9), 0))`,
    [
      campaignId,
      playerId,
      requestorUserId,
      mode,
      reason,
      previousPoint.x,
      previousPoint.y,
      snappedTarget.x,
      snappedTarget.y,
    ],
  );

  const pathInsert = await client.query(
    `INSERT INTO public.player_movement_paths (
        campaign_id,
        player_id,
        path,
        mode,
        moved_by,
        reason
     )
     VALUES (
        $1,
        $2,
        ST_SetSRID(ST_MakeLine(ARRAY[
          ST_MakePoint($3, $4, $5),
          ST_MakePoint($6, $7, $8)
        ]), 0),
        $9,
        $10,
        $11
     )
     RETURNING id, created_at`,
    [
      campaignId,
      playerId,
      previousPoint.x,
      previousPoint.y,
      previousTimestamp,
      snappedTarget.x,
      snappedTarget.y,
      nowTimestamp,
      mode,
      requestorUserId,
      reason ?? null,
    ],
  );

  const pathRecord = pathInsert.rows[0] ?? null;

  return {
    player: updatedPlayer,
    requestedDistance: distance,
    requestedTarget,
    snappedTarget,
    grid: {
      type: movementConfig.gridType,
      size: movementConfig.gridSize,
      origin: { x: movementConfig.originX, y: movementConfig.originY },
    },
    pathId: pathRecord?.id ?? null,
    pathRecordedAt: pathRecord?.created_at ?? null,
  };
};

export {
  DEFAULT_VISIBILITY_RADIUS,
  DEFAULT_MAX_MOVE_DISTANCE,
  DEFAULT_MIN_MOVE_INTERVAL_MS,
};

export const MAX_MOVE_DISTANCE = DEFAULT_MAX_MOVE_DISTANCE;
export const MIN_MOVE_INTERVAL_MS = DEFAULT_MIN_MOVE_INTERVAL_MS;

export { getMovementConfig } from './movement-config.js';
