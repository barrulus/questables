# Chat & Turn Gating UX

**Date:** 2026-05-19
**Status:** Design approved, ready for implementation plan.

## Problem

Players type a message in party chat, submit it, and the DM never narrates a response. The server's action-interceptor decided the message wasn't actionable — most often because it isn't the player's turn — and silently logged `chat.intercept_skipped`. The player has no way to tell their input was dropped from the action pipeline.

Today's flow (`server/services/chat/action-interceptor.js:35-93`):

1. Player POSTs message → server persists it and broadcasts it to chat.
2. Server runs `shouldInterceptAsAction`, which returns one of six skip reasons:
   `no_active_session`, `no_game_state`, `phase_<x>_not_actionable`,
   `not_active_player_in_combat`, `user_not_in_turn_order`, `no_active_character`.
3. On skip, intercept exits quietly. Telemetry is logged; the client is never told.

The client (`components/chat-system.tsx`) has no model of turn state. The IC/OOC toggle, channel tabs, and presence badges are all the player has to reason about why nothing happens.

## Decisions

These are the constraints the design must satisfy. Sources are this design's brainstorming conversation on 2026-05-19.

1. **OOC chat must always flow.** Party chat doubles as table talk. Only IC actions are gated.
2. **Persistent turn bar above the chat input** carries the explanatory load. Per-reason status text (not a single generic state).
3. **IC submit is blocked when the user can't act.** Players must toggle OOC to send anything when gated.
4. **Server intercept short-circuits OOC/non-party paths** so we don't burn LLM tokens on messages that can't be actions.
5. **No new realtime events.** Existing `gamePhaseChanged`, `turnAdvanced`, `turnOrderChanged`, `worldTurnCompleted` cover all transitions. We add one snapshot emit on subscribe.

## Architecture

### Shared actionability function

A pure function lives in a path importable by both server and client (proposed location: `shared/actionability.js`; final path chosen during implementation to fit the existing layout).

```js
computeActionability({ gameState, userId, hasActiveCharacter }) => {
  canAct: boolean,
  reason:
    | 'ok'
    | 'no_active_session'
    | 'phase_not_actionable'
    | 'user_not_in_turn_order'
    | 'not_active_player_in_combat'
    | 'no_active_character',
  activeUserId?: string, // populated when reason === 'not_active_player_in_combat'
  phase?: string,        // populated when reason === 'phase_not_actionable'
}
```

The reason codes mostly match the strings the server already emits in `chat.intercept_skipped` telemetry. One normalization: today's server emits dynamic `phase_<name>_not_actionable` strings; the shared function collapses those into a single `phase_not_actionable` reason with the specific phase carried in the `phase` field. The telemetry event payload should be updated to match.

`shouldInterceptAsAction` becomes a thin wrapper:

```
load session + character → call computeActionability → return { shouldIntercept, reason, ...ctx }
```

### Server changes

1. **Extract the rule** (`action-interceptor.js:49-73` → `shared/actionability.js`).
2. **Short-circuit non-actionable POSTs.** In the chat POST handler, when `character_id` is null or `channel_type !== 'party'`, skip the intercept call path entirely. Today's code happens to skip these implicitly; this makes the guard explicit and removes any chance of the LLM intent-parser running on a non-action.
3. **Emit `game-state-snapshot` on subscribe.** When a client joins a campaign WebSocket room, the server emits a one-time snapshot of `{ phase, turnOrder, activePlayerId, sessionStatus }` read from `sessions.game_state`. Same payload shape as the existing turn/phase events; same source of truth.

No new DB columns. No new tables. No new realtime events beyond the snapshot.

### Client changes

**`useTurnState(campaignId)` hook.** Subscribes to:

- `game-state-snapshot` (initial state on connect/reconnect)
- `turnAdvanced`
- `gamePhaseChanged`
- `turnOrderChanged`
- `worldTurnCompleted`

Maintains a local `{ phase, turnOrder, activePlayerId, activeUsername, sessionStatus }`. Returns `{ gameState, actionability }`, where `actionability` is the result of calling `computeActionability` with the current user and their `campaignCharacter`.

**`<TurnStatusBar>` component**, rendered above the chat input inside `chat-system.tsx`. Visible only when `activeChannel.channelType === 'party'`. Reason → text mapping:

| reason | bar text |
|---|---|
| `ok` | `Your turn — act freely` |
| `no_active_session` | `No active session — Campaign Director hasn't started one` |
| `phase_not_actionable` | `Phase: {phase} — actions paused` |
| `user_not_in_turn_order` | `You're a spectator — join from the dashboard to act` |
| `not_active_player_in_combat` | `Combat — {activeUsername}'s turn` |
| `no_active_character` | `No character enrolled — join with one to act` |

**Input gating** in `chat-system.tsx` (extending the existing `inputDisabled` at line 650):

```ts
const wouldBeAction = activeChannel.channelType === 'party' && speakingInCharacter;
const blockedByTurn = wouldBeAction && !actionability.canAct;
const inputDisabled =
  sending ||
  (activeChannel.channelType === 'dm_broadcast' && !isDm) ||
  blockedByTurn;
```

When `blockedByTurn`, the placeholder becomes `Wait for your turn — toggle OOC to chat freely`. Submit/Enter are inert. The IC/OOC switch stays clickable; flipping to OOC clears the gate immediately because `wouldBeAction` becomes false.

### Defensive server check

Client gating is for UX, not security. The server still validates on POST: if a message arrives with `character_id` set but `computeActionability` returns `!canAct`, the server persists the message (chatter isn't lost) and skips intercept — same behavior as today. No new 4xx response is introduced; the silent skip is the correct fallback for the race window between turn change and the client receiving the event.

## Edge cases

- **Race: turn changes mid-message.** Player types for 30s while their turn ends. The send still hits the server, message is persisted, intercept skipped. Accepted — the alternative (4xx) creates worse failure modes for marginal benefit. The bar will flip on the next render.
- **Fresh campaign, no session.** `parseGameState` returns defaults (`turnOrder: []`, `activePlayerId: null`). Actionability returns `no_active_session`. Bar explains.
- **Reconnect.** Existing reconnect logic (`chat-system.tsx:358`) re-fetches missed messages. We extend the server to re-emit `game-state-snapshot` on every subscribe (initial connect and reconnects use the same code path), so the client never sees a blank turn state after a network hiccup.
- **Player leaves turn order while typing.** Their `userId` drops from `turnOrder`, bar flips, input disables on next render. Draft text in the textarea is preserved so they can toggle OOC and send.
- **CD speaking as themselves.** CDs in party channel with `character_id` null are OOC — bar doesn't gate them. A CD with a character who toggles IC is treated as a player, gated like anyone else.
- **Non-party channels.** Whispers, `dm_broadcast`, `director_whisper` are never intercepted today; bar is hidden on those tabs.

## Testing

- **Unit tests for `computeActionability`** — pure function, one case per reason code.
- **Server integration tests** — existing intercept tests in `tests/` continue to pass post-refactor (same return shape, same telemetry events). Add one case asserting OOC messages (`character_id` null) never reach the LLM intent-parser.
- **Client unit test for `useTurnState`** — feed a sequence of WebSocket events; assert derived actionability matches expected.
- **Manual smoke test** — join a campaign, start a session, verify bar shows `Your turn`; CD ends turn → bar flips; IC submit disabled; OOC toggle re-enables submit; reload mid-session → bar populates from snapshot.

## Out of scope

- Initiative tracker / round counter UI (option C in the brainstorm; deferred).
- Server-pushed remediation CTAs (e.g., "End your turn" buttons). Bar is informational only.
- New 4xx responses or message rejection on the POST path.
- Changes to non-party channels' behavior.
