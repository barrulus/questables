import { logWarn } from '../../utils/logger.js';
import { resolveDestination } from './destination-resolver.js';
import { performPlayerMovement } from '../campaigns/service.js';

export async function applyNarrativeMove(client, {
  campaignId,
  playerId,
  requestorUserId,
  destination,
  reason,
  mode = 'walk',
  wsServer = null,
}) {
  const resolved = await resolveDestination(client, { campaignId, destination });

  const result = await performPlayerMovement({
    client,
    campaignId,
    playerId,
    requestorUserId,
    requestorRole: 'llm',
    isRequestorAdmin: false,
    targetX: resolved.x,
    targetY: resolved.y,
    mode,
    reason: reason ?? `narrative: ${destination.kind}:${destination.ref}`,
    enforceClamp: true,
    source: 'llm',
  });

  const summary = {
    playerId: result.player.id,
    geometry: result.player.geometry,
    visibilityState: result.player.visibility_state,
    mapLevel: resolved.mapLevel,
    insideBurgId: resolved.burgId,
    resolvedName: resolved.resolvedName,
    distance: result.requestedDistance,
    pathId: result.pathId,
    updatedAt: result.player.last_located_at,
  };

  if (wsServer?.broadcastToCampaign) {
    try {
      wsServer.broadcastToCampaign(campaignId, 'player-moved', {
        ...summary,
        mode,
        movedBy: requestorUserId,
        reason: reason ?? null,
        target: result.requestedTarget,
        snapped: result.snappedTarget,
        grid: result.grid,
        source: 'llm',
      });
    } catch (err) {
      logWarn('narrative-movement broadcast failed (non-fatal)', {
        campaignId,
        playerId: result.player.id,
        error: err?.message ?? String(err),
      });
    }
  }

  return summary;
}
