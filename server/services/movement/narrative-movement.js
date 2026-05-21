import { resolveDestination } from './destination-resolver.js';
import { planTravel } from './travel-planner.js';
import { pickArrivalGate, retargetPlanToGate } from './gate-picker.js';
import { snapCoordToNearbyBurg } from './burg-snap.js';
import { performPlayerMovement } from '../campaigns/service.js';
import { evaluateEncounterAtPoint } from '../encounters/proactive-generator.js';
import { logInfo, logWarn } from '../../utils/logger.js';

async function loadCurrentPosition(client, campaignId, playerId) {
  const { rows } = await client.query(
    `SELECT ST_X(loc_current) AS x, ST_Y(loc_current) AS y
       FROM public.campaign_players
      WHERE campaign_id = $1 AND id = $2 AND loc_current IS NOT NULL
      LIMIT 1`,
    [campaignId, playerId],
  );
  if (rows.length === 0) return { x: 0, y: 0 };
  return { x: Number(rows[0].x), y: Number(rows[0].y) };
}

async function loadWorldId(client, campaignId) {
  const { rows } = await client.query(
    `SELECT world_map_id FROM public.campaigns WHERE id = $1 LIMIT 1`,
    [campaignId],
  );
  return rows[0]?.world_map_id ?? null;
}

async function loadClockDay(client, campaignId) {
  const { rows } = await client.query(
    `SELECT campaign_clock_days FROM public.campaigns WHERE id = $1 LIMIT 1`,
    [campaignId],
  );
  return rows[0]?.campaign_clock_days ?? 0;
}

function segmentLength(a, b) { return Math.hypot(b.x - a.x, b.y - a.y); }

function truncateWaypointsAtCamp(waypoints, camp) {
  const out = [{ ...waypoints[0] }];
  for (let i = 1; i < waypoints.length; i++) {
    const prev = waypoints[i - 1];
    const cur  = waypoints[i];
    if (Math.abs(cur.x - camp.x) < 1e-6 && Math.abs(cur.y - camp.y) < 1e-6) {
      out.push({ ...cur });
      return out;
    }
    const segLen = segmentLength(prev, cur);
    const toCamp = segmentLength(prev, camp);
    const fromCamp = segmentLength(camp, cur);
    if (Math.abs(segLen - (toCamp + fromCamp)) < 1e-3) {
      out.push({ x: camp.x, y: camp.y });
      return out;
    }
    out.push({ ...cur });
  }
  out.push({ x: camp.x, y: camp.y });
  return out;
}

async function walkCampsForEncounter({ sessionId, campaignId, campPoints }) {
  for (const camp of campPoints) {
    const triggered = await evaluateEncounterAtPoint({
      campaignId, sessionId,
      x: camp.x, y: camp.y,
    });
    if (triggered) {
      return { interruptedAt: camp, dayReached: camp.day };
    }
  }
  return { interruptedAt: null };
}

export async function applyNarrativeMove(client, {
  campaignId,
  playerId,
  sessionId,
  requestorUserId,
  destination,
  reason,
  mode = 'walk',
  via = 'roads',
  wsServer = null,
}) {
  const initialResolved = await resolveDestination(client, { campaignId, destination });
  const current  = await loadCurrentPosition(client, campaignId, playerId);
  const worldId  = await loadWorldId(client, campaignId);

  // Promote sloppy coordinate/poi destinations to burg destinations when the
  // target is plausibly "approaching" a burg. Without this, the LLM emitting
  // { kind: 'coordinate', ref: {x,y} } near a settlement skips gate-picking
  // entirely and the player lands a few km short — so `inside_burg_id` stays
  // NULL and the map never flips to the settlement view.
  let resolved = initialResolved;
  let effectiveDestinationKind = destination.kind;
  if (resolved.burgId === null && destination.kind !== 'burg' && worldId) {
    const snap = await snapCoordToNearbyBurg(client, {
      worldId,
      x: resolved.x,
      y: resolved.y,
    });
    if (snap) {
      logInfo('narrative-movement: snapped coordinate target to burg', {
        campaignId,
        originalKind: destination.kind,
        snappedBurgId: snap.burgId,
        snappedName: snap.resolvedName,
        distance: snap.distance,
      });
      resolved = {
        x: snap.x,
        y: snap.y,
        burgId: snap.burgId,
        mapLevel: 'settlement',
        resolvedName: snap.resolvedName,
      };
      effectiveDestinationKind = 'burg';
    }
  }

  const plan = worldId
    ? await planTravel(client, {
        worldId, start: current,
        end: { x: resolved.x, y: resolved.y },
        mode, via,
      })
    : {
        waypoints: [current, { x: resolved.x, y: resolved.y }],
        distancePixels: segmentLength(current, { x: resolved.x, y: resolved.y }),
        distanceMiles: null,
        totalDays: 0,
        campPoints: [],
        effectiveVia: 'direct',
        dailyPixels: Infinity,
      };

  const arrivalGate = await pickArrivalGate(client, {
    plan: { ...plan, mode },
    destination: { kind: effectiveDestinationKind, burgId: resolved.burgId },
  });
  const gatedPlan = arrivalGate ? retargetPlanToGate(plan, arrivalGate) : plan;

  const interrupt = gatedPlan.campPoints.length > 0 && sessionId
    ? await walkCampsForEncounter({ sessionId, campaignId, campPoints: gatedPlan.campPoints })
    : { interruptedAt: null };

  const centroidEnd = { x: resolved.x, y: resolved.y };
  const gateEnd = arrivalGate ? { x: arrivalGate.x, y: arrivalGate.y } : centroidEnd;
  const effectiveEnd = interrupt.interruptedAt ?? gateEnd;
  const effectiveWaypoints = interrupt.interruptedAt
    ? truncateWaypointsAtCamp(gatedPlan.waypoints, interrupt.interruptedAt)
    : gatedPlan.waypoints;
  const daysElapsed = interrupt.interruptedAt
    ? interrupt.interruptedAt.day
    : gatedPlan.totalDays;

  const moveResult = await performPlayerMovement({
    client, campaignId, playerId,
    requestorUserId,
    requestorRole: 'llm',
    isRequestorAdmin: false,
    targetX: effectiveEnd.x,
    targetY: effectiveEnd.y,
    mode,
    reason: reason ?? `narrative: ${destination.kind}:${destination.ref}`,
    enforceClamp: true,
    source: 'llm',
    arrivalGateEntranceId: arrivalGate?.entranceId ?? null,
    pathWaypoints: effectiveWaypoints,
    gameDaysElapsed: daysElapsed,
  });

  const clockDay = await loadClockDay(client, campaignId);

  const summary = {
    playerId: moveResult.player.id,
    geometry: moveResult.player.geometry,
    visibilityState: moveResult.player.visibility_state,
    mapLevel: resolved.mapLevel,
    insideBurgId: resolved.burgId,
    resolvedName: resolved.resolvedName,
    distance: moveResult.requestedDistance,
    pathId: moveResult.pathId,
    updatedAt: moveResult.player.last_located_at,
    path: {
      waypoints: effectiveWaypoints,
      distancePixels: gatedPlan.distancePixels,
      distanceMiles: gatedPlan.distanceMiles,
      mode,
    },
    travel: {
      totalDaysPlanned: gatedPlan.totalDays,
      daysElapsed,
      interrupted: interrupt.interruptedAt !== null,
      effectiveVia: gatedPlan.effectiveVia,
    },
    arrival: {
      gate: arrivalGate ? {
        id:        arrivalGate.entranceId,
        gateId:    arrivalGate.gateId,
        name:      arrivalGate.name,
        kind:      arrivalGate.kind,
        subKind:   arrivalGate.subKind,
        matchedBy: arrivalGate.matchedBy,
      } : null,
    },
    clockDay,
    encounter: null,
  };

  if (wsServer?.broadcastToCampaign) {
    try {
      wsServer.broadcastToCampaign(campaignId, 'player-moved', {
        ...summary,
        mode,
        movedBy: requestorUserId,
        reason: reason ?? null,
        target: moveResult.requestedTarget,
        snapped: moveResult.snappedTarget,
        grid: moveResult.grid,
        source: 'llm',
      });
    } catch (err) {
      logWarn('narrative-movement broadcast failed (non-fatal)', {
        campaignId,
        playerId: moveResult.player.id,
        error: err?.message ?? String(err),
      });
    }
  }

  return summary;
}
