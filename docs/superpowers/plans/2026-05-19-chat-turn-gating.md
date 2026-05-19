# Chat & Turn Gating Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a persistent turn-status bar above the chat input that explains when and why a player can't take in-character actions, and gate IC submit accordingly. Eliminate silent `chat.intercept_skipped` outcomes by surfacing the reason in the UI.

**Architecture:** Lift the rule that decides "can this user take an action right now?" out of `server/services/chat/action-interceptor.js` into a pure shared function (`shared/actionability.js`) consumed by both the server intercept path and a new client hook. Existing realtime events (`turn-advanced`, `game-phase-changed`, `turn-order-changed`, `world-turn-completed`) already carry the data needed; we add one snapshot event so reconnecting clients don't need to remount.

**Tech Stack:** Node 20 + Express (ESM, `.js` extensions in imports), socket.io, React 18 + TypeScript + Vite, Jest + RTL.

**Spec:** `docs/superpowers/specs/2026-05-19-chat-turn-gating-design.md`

---

## File Structure

**Created:**
- `shared/actionability.js` — pure function `computeActionability` + reason constants. Plain ESM JS so both the server (Node) and the Vite/TS client can import it without a build step.
- `shared/actionability.d.ts` — type declarations so TS consumers get inference.
- `tests/shared/actionability.test.js` — unit tests, one per reason code.
- `hooks/useActionability.ts` — small React hook that reads `useGameState()` + the campaign character and returns the actionability result for the current user.
- `components/turn-status-bar.tsx` — presentational component rendered above the chat input on the party channel.
- `tests/turn-status-bar.test.tsx` — RTL tests for each reason → text mapping.

**Modified:**
- `server/services/chat/action-interceptor.js` — collapse the existing rule to a thin wrapper around `computeActionability`; normalise the `phase_<name>_not_actionable` telemetry reason to a single `phase_not_actionable` with a `phase` field.
- `server/routes/chat.routes.js` — short-circuit the intercept call when the message is OOC (`character_id` null) or the channel is not `party`, so we never burn LLM tokens on messages that cannot be actions.
- `server/websocket-server.js` — add `gameStateSnapshot` to `REALTIME_EVENTS` and emit it on `join-campaign` after the room join succeeds.
- `contexts/GameStateContext.tsx` — subscribe to `game-state-snapshot` so reconnects re-populate state without remounting the campaign.
- `components/chat-system.tsx` — render `<TurnStatusBar>` above the input on the party channel; extend `inputDisabled` with a `blockedByTurn` check that uses the actionability hook.

---

## Task 1: Shared actionability function

**Files:**
- Create: `shared/actionability.js`
- Create: `shared/actionability.d.ts`
- Create: `tests/shared/actionability.test.js`

- [ ] **Step 1: Write the failing tests**

Create `tests/shared/actionability.test.js`:

```js
import { describe, expect, it } from '@jest/globals';
import {
  computeActionability,
  ACTIONABILITY_REASONS,
} from '../../shared/actionability.js';

const userId = 'user-1';
const otherUserId = 'user-2';

const baseGameState = {
  phase: 'exploration',
  turnOrder: [userId, otherUserId],
  activePlayerId: userId,
};

describe('computeActionability', () => {
  it('returns ok when user is in turn order during exploration', () => {
    const result = computeActionability({
      gameState: baseGameState,
      userId,
      hasActiveCharacter: true,
    });
    expect(result).toEqual({ canAct: true, reason: ACTIONABILITY_REASONS.OK });
  });

  it('returns ok for any party member during social phase', () => {
    const result = computeActionability({
      gameState: { ...baseGameState, phase: 'social', activePlayerId: otherUserId },
      userId,
      hasActiveCharacter: true,
    });
    expect(result.canAct).toBe(true);
  });

  it('returns no_active_session when gameState is null', () => {
    const result = computeActionability({
      gameState: null,
      userId,
      hasActiveCharacter: true,
    });
    expect(result).toEqual({
      canAct: false,
      reason: ACTIONABILITY_REASONS.NO_ACTIVE_SESSION,
    });
  });

  it('returns phase_not_actionable with phase field for downtime', () => {
    const result = computeActionability({
      gameState: { ...baseGameState, phase: 'downtime' },
      userId,
      hasActiveCharacter: true,
    });
    expect(result).toEqual({
      canAct: false,
      reason: ACTIONABILITY_REASONS.PHASE_NOT_ACTIONABLE,
      phase: 'downtime',
    });
  });

  it('returns phase_not_actionable for rest phase', () => {
    const result = computeActionability({
      gameState: { ...baseGameState, phase: 'rest' },
      userId,
      hasActiveCharacter: true,
    });
    expect(result.reason).toBe(ACTIONABILITY_REASONS.PHASE_NOT_ACTIONABLE);
    expect(result.phase).toBe('rest');
  });

  it('returns user_not_in_turn_order when user missing from exploration turnOrder', () => {
    const result = computeActionability({
      gameState: { ...baseGameState, turnOrder: [otherUserId] },
      userId,
      hasActiveCharacter: true,
    });
    expect(result).toEqual({
      canAct: false,
      reason: ACTIONABILITY_REASONS.USER_NOT_IN_TURN_ORDER,
    });
  });

  it('returns not_active_player_in_combat for non-active combatant', () => {
    const result = computeActionability({
      gameState: {
        phase: 'combat',
        turnOrder: [userId, otherUserId],
        activePlayerId: otherUserId,
      },
      userId,
      hasActiveCharacter: true,
    });
    expect(result).toEqual({
      canAct: false,
      reason: ACTIONABILITY_REASONS.NOT_ACTIVE_PLAYER_IN_COMBAT,
      activeUserId: otherUserId,
    });
  });

  it('returns ok for the active combatant', () => {
    const result = computeActionability({
      gameState: {
        phase: 'combat',
        turnOrder: [userId, otherUserId],
        activePlayerId: userId,
      },
      userId,
      hasActiveCharacter: true,
    });
    expect(result.canAct).toBe(true);
  });

  it('returns no_active_character when user has none, even if otherwise eligible', () => {
    const result = computeActionability({
      gameState: baseGameState,
      userId,
      hasActiveCharacter: false,
    });
    expect(result).toEqual({
      canAct: false,
      reason: ACTIONABILITY_REASONS.NO_ACTIVE_CHARACTER,
    });
  });

  it('treats empty turnOrder as no_active_session-equivalent state', () => {
    // No session-active marker beyond gameState shape; an empty turnOrder
    // with null activePlayerId means a session was never initialised.
    const result = computeActionability({
      gameState: { phase: 'exploration', turnOrder: [], activePlayerId: null },
      userId,
      hasActiveCharacter: true,
    });
    expect(result.canAct).toBe(false);
    expect(result.reason).toBe(ACTIONABILITY_REASONS.NO_ACTIVE_SESSION);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest tests/shared/actionability.test.js`
Expected: FAIL with `Cannot find module '../../shared/actionability.js'`.

- [ ] **Step 3: Create the implementation**

Create `shared/actionability.js`:

```js
/**
 * @typedef {Object} GameStateLike
 * @property {string} phase
 * @property {string[]} turnOrder
 * @property {string|null} activePlayerId
 */

/**
 * @typedef {Object} ActionabilityResult
 * @property {boolean} canAct
 * @property {string} reason
 * @property {string} [activeUserId]
 * @property {string} [phase]
 */

export const ACTIONABILITY_REASONS = Object.freeze({
  OK: 'ok',
  NO_ACTIVE_SESSION: 'no_active_session',
  PHASE_NOT_ACTIONABLE: 'phase_not_actionable',
  USER_NOT_IN_TURN_ORDER: 'user_not_in_turn_order',
  NOT_ACTIVE_PLAYER_IN_COMBAT: 'not_active_player_in_combat',
  NO_ACTIVE_CHARACTER: 'no_active_character',
});

const ACTIONABLE_PHASES = new Set(['exploration', 'combat', 'social']);

/**
 * Decide whether a given user could currently take an in-character action
 * that the DM action-interceptor would resolve.
 *
 * Pure function: same inputs → same outputs. Safe to call from both server
 * (chat intercept path) and client (turn-status bar / input gating).
 *
 * @param {{ gameState: GameStateLike|null, userId: string, hasActiveCharacter: boolean }} args
 * @returns {ActionabilityResult}
 */
export function computeActionability({ gameState, userId, hasActiveCharacter }) {
  if (!gameState) {
    return { canAct: false, reason: ACTIONABILITY_REASONS.NO_ACTIVE_SESSION };
  }

  const turnOrder = Array.isArray(gameState.turnOrder) ? gameState.turnOrder : [];
  const hasParticipants = turnOrder.length > 0 || gameState.activePlayerId !== null;
  if (!hasParticipants) {
    return { canAct: false, reason: ACTIONABILITY_REASONS.NO_ACTIVE_SESSION };
  }

  if (!ACTIONABLE_PHASES.has(gameState.phase)) {
    return {
      canAct: false,
      reason: ACTIONABILITY_REASONS.PHASE_NOT_ACTIONABLE,
      phase: gameState.phase,
    };
  }

  if (gameState.phase === 'combat') {
    if (gameState.activePlayerId !== userId) {
      return {
        canAct: false,
        reason: ACTIONABILITY_REASONS.NOT_ACTIVE_PLAYER_IN_COMBAT,
        activeUserId: gameState.activePlayerId ?? undefined,
      };
    }
  } else if (!turnOrder.includes(userId)) {
    return { canAct: false, reason: ACTIONABILITY_REASONS.USER_NOT_IN_TURN_ORDER };
  }

  if (!hasActiveCharacter) {
    return { canAct: false, reason: ACTIONABILITY_REASONS.NO_ACTIVE_CHARACTER };
  }

  return { canAct: true, reason: ACTIONABILITY_REASONS.OK };
}
```

Create `shared/actionability.d.ts`:

```ts
export type ActionabilityReason =
  | 'ok'
  | 'no_active_session'
  | 'phase_not_actionable'
  | 'user_not_in_turn_order'
  | 'not_active_player_in_combat'
  | 'no_active_character';

export interface GameStateLike {
  phase: string;
  turnOrder: string[];
  activePlayerId: string | null;
}

export interface ActionabilityResult {
  canAct: boolean;
  reason: ActionabilityReason;
  activeUserId?: string;
  phase?: string;
}

export const ACTIONABILITY_REASONS: {
  OK: 'ok';
  NO_ACTIVE_SESSION: 'no_active_session';
  PHASE_NOT_ACTIONABLE: 'phase_not_actionable';
  USER_NOT_IN_TURN_ORDER: 'user_not_in_turn_order';
  NOT_ACTIVE_PLAYER_IN_COMBAT: 'not_active_player_in_combat';
  NO_ACTIVE_CHARACTER: 'no_active_character';
};

export function computeActionability(args: {
  gameState: GameStateLike | null;
  userId: string;
  hasActiveCharacter: boolean;
}): ActionabilityResult;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest tests/shared/actionability.test.js`
Expected: PASS (10 tests).

Run: `npx tsc --noEmit`
Expected: PASS — no type errors.

- [ ] **Step 5: Commit**

```bash
git add shared/actionability.js shared/actionability.d.ts tests/shared/actionability.test.js
git commit -m "feat(chat): add shared computeActionability function"
```

---

## Task 2: Refactor server intercept to use shared function

**Files:**
- Modify: `server/services/chat/action-interceptor.js:35-93`

This task is a behaviour-preserving refactor with one telemetry normalisation: `phase_<name>_not_actionable` becomes `phase_not_actionable` (the specific phase still appears in the telemetry payload via a new `phase` field on the log entry).

- [ ] **Step 1: Search for any consumer of the old phase reason strings**

Run: `rg -n "phase_.*_not_actionable" -g '!node_modules' -g '!dist'`
Expected: only the one definition site in `action-interceptor.js`. If anything else matches, surface it before continuing.

- [ ] **Step 2: Rewrite `shouldInterceptAsAction`**

Replace lines 35–93 in `server/services/chat/action-interceptor.js` with:

```js
import { computeActionability, ACTIONABILITY_REASONS } from '../../../shared/actionability.js';

export async function shouldInterceptAsAction({ campaignId, userId }) {
  const client = await getClient({ label: 'action-interceptor.check' });
  try {
    const { rows: sessionRows } = await client.query(
      `SELECT s.id, s.game_state
         FROM public.sessions s
        WHERE s.campaign_id = $1 AND s.status = 'active'
        LIMIT 1`,
      [campaignId],
    );

    const session = sessionRows[0] ?? null;
    const gameState = session
      ? (typeof session.game_state === 'string'
          ? JSON.parse(session.game_state)
          : session.game_state)
      : null;

    const { rows: charRows } = await client.query(
      `SELECT character_id FROM public.campaign_players
        WHERE campaign_id = $1 AND user_id = $2 AND status = 'active'`,
      [campaignId, userId],
    );
    const characterId = charRows[0]?.character_id ?? null;

    const result = computeActionability({
      gameState,
      userId,
      hasActiveCharacter: characterId !== null,
    });

    if (!result.canAct) {
      return {
        shouldIntercept: false,
        reason: result.reason,
        phase: result.phase ?? null,
        activeUserId: result.activeUserId ?? null,
      };
    }

    return {
      shouldIntercept: true,
      session,
      gameState,
      characterId,
    };
  } finally {
    client.release();
  }
}
```

The two adjacent `const ACTIONABILITY_REASONS = …` import-style references in this file (if any pre-existing code imported the helpers) should also be updated. There were none in the pre-refactor file — this is a pure replacement.

- [ ] **Step 3: Update telemetry call sites in chat.routes.js**

Edit `server/routes/chat.routes.js` at lines 241–250 — extend the `chat.intercept_skipped` log call so the `phase`, `activeUserId` fields are forwarded when present:

```js
shouldInterceptAsAction({ campaignId, userId: senderId })
  .then(({ shouldIntercept, reason, phase, activeUserId, session, gameState, characterId: charId }) => {
    if (!shouldIntercept) {
      logInfo('Action interception skipped', {
        telemetryEvent: 'chat.intercept_skipped',
        campaignId,
        userId: senderId,
        reason: reason ?? 'unknown',
        ...(phase ? { phase } : {}),
        ...(activeUserId ? { activeUserId } : {}),
      });
      return;
    }
    // ... rest unchanged
```

- [ ] **Step 4: Verify existing intercept tests still pass**

Run: `npx jest tests/ --testPathPattern='intercept|chat.*action'`
Expected: PASS. If any test asserts the literal string `phase_*_not_actionable`, update the assertion to `phase_not_actionable` and assert the new `phase` field separately.

- [ ] **Step 5: Type check + lint**

Run: `npx tsc --noEmit && npx eslint server/services/chat/action-interceptor.js server/routes/chat.routes.js`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add server/services/chat/action-interceptor.js server/routes/chat.routes.js tests/
git commit -m "refactor(chat): delegate intercept rule to computeActionability"
```

---

## Task 3: Short-circuit intercept for OOC / non-party messages

**Files:**
- Modify: `server/routes/chat.routes.js:226-282`

Today's code already gates the intercept on `effectiveChannelType === 'party'`. We extend that to also skip when `character_id` is null — those are OOC messages by definition and cannot be character actions.

- [ ] **Step 1: Update the guard**

Replace lines 226–227 of `server/routes/chat.routes.js`:

```js
const effectiveChannelType = channel_type ?? 'party';
const isOOC = !character_id;
if (effectiveChannelType === 'party' && (!type || type === 'text') && !isOOC) {
```

The matching closing brace at line 282 stays unchanged.

- [ ] **Step 2: Add a regression test**

Find the existing chat-intercept test (likely `tests/chat-intercept.test.js` or similar). If none exists, create `tests/chat-intercept-ooc.test.js`:

```js
import { describe, expect, it, jest } from '@jest/globals';

// Mock the action-interceptor so we can detect whether it was called.
const shouldInterceptAsAction = jest.fn();
jest.unstable_mockModule('../server/services/chat/action-interceptor.js', () => ({
  shouldInterceptAsAction,
  interceptChatAction: jest.fn(),
}));

// (Boilerplate: import the route after the mock, build a supertest app,
// POST a party message with character_id: null, then assert
// shouldInterceptAsAction was NOT called.)
```

If wiring a full route test is heavier than the rest of the plan justifies, document the gap and rely on the manual smoke test at the end instead. Surface the trade-off in the commit message.

- [ ] **Step 3: Run tests**

Run: `npx jest tests/chat-intercept-ooc.test.js` (or skip if Step 2 was deferred).
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add server/routes/chat.routes.js tests/
git commit -m "fix(chat): skip intercept for OOC party messages"
```

---

## Task 4: Snapshot event on WebSocket subscribe

**Files:**
- Modify: `server/websocket-server.js:11-47` (REALTIME_EVENTS), `server/websocket-server.js:181-198` (join-campaign handler)

- [ ] **Step 1: Add the event name**

In `server/websocket-server.js`, extend the `REALTIME_EVENTS` constant (after the `turnOrderChanged` entry):

```js
turnOrderChanged: 'turn-order-changed',
gameStateSnapshot: 'game-state-snapshot',
```

- [ ] **Step 2: Import the game-state reader**

At the top of `server/websocket-server.js`, alongside the existing imports:

```js
import { parseGameState } from './services/game-state/service.js';
```

Confirm the exact export name — open `server/services/game-state/service.js` and check that `parseGameState` is exported. If it isn't, export it (it's used internally at line 53 in that file). Otherwise pick the read helper that returns a plain `{ phase, turnOrder, activePlayerId, … }` object.

- [ ] **Step 3: Emit the snapshot on join**

Replace the `socket.on('join-campaign', …)` handler body so that after the room join succeeds, the snapshot is emitted to *just this socket* (not broadcast — the other room members already have current state):

```js
socket.on('join-campaign', async (campaignId) => {
  const access = await this.requireCampaignAccess(socket, campaignId, 'join-campaign');
  if (!access) return;

  socket.join(`${CAMPAIGN_ROOM_PREFIX}${access.campaignId}`);
  socket.campaignId = access.campaignId;
  logInfo('WebSocket campaign joined', {
    campaignId: access.campaignId,
    userId: socket.user.id,
    role: access.role,
  });

  // Send current game state to the joining socket so it doesn't need
  // to remount the campaign to get fresh turn info after a reconnect.
  try {
    const client = await getClient({ label: 'ws.snapshot' });
    try {
      const { rows } = await client.query(
        `SELECT s.id AS session_id, s.status AS session_status, s.game_state
           FROM public.sessions s
          WHERE s.campaign_id = $1 AND s.status = 'active'
          LIMIT 1`,
        [access.campaignId],
      );
      const session = rows[0] ?? null;
      const gameState = session
        ? (typeof session.game_state === 'string'
            ? JSON.parse(session.game_state)
            : session.game_state)
        : null;
      socket.emit(REALTIME_EVENTS.gameStateSnapshot, {
        sessionId: session?.session_id ?? null,
        sessionStatus: session?.session_status ?? null,
        gameState,
        emittedAt: new Date().toISOString(),
      });
    } finally {
      client.release();
    }
  } catch (err) {
    logError('Failed to emit game-state-snapshot on join', {
      campaignId: access.campaignId,
      error: err.message,
    });
  }

  socket.to(`${CAMPAIGN_ROOM_PREFIX}${access.campaignId}`).emit('user-joined', {
    userId: socket.user.id,
    username: socket.user.username,
    timestamp: new Date().toISOString(),
  });
});
```

- [ ] **Step 4: Smoke-test the server**

Run: `npm run lint -- server/websocket-server.js` and `node --check server/websocket-server.js`.
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add server/websocket-server.js
git commit -m "feat(realtime): emit game-state-snapshot on join-campaign"
```

---

## Task 5: Wire the client to consume the snapshot

**Files:**
- Modify: `contexts/GameStateContext.tsx:135-161`

- [ ] **Step 1: Subscribe to the snapshot event**

In `contexts/GameStateContext.tsx`, near the other `useWsEvent` calls (around line 142–158), add a snapshot subscription that fully replaces gameState (not a partial merge — the snapshot is canonical):

```ts
useWsEvent<{
  gameState?: GameState | null;
  sessionId?: string | null;
  sessionStatus?: string | null;
}>("game-state-snapshot", (data) => {
  if (data && "gameState" in data) {
    setGameStateData({
      gameState: data.gameState ?? null,
      sessionId: data.sessionId ?? null,
    });
  }
});
```

Use `setGameStateData` (not `setGameState`) because the snapshot updates both `gameState` and `sessionId`. Look at the existing implementations of the `useAsync` setter to confirm the exact signature — there's an example at line 95–108.

- [ ] **Step 2: Type-check + smoke run**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Manual reconnect check (defer if no dev environment)**

Boot the app, join a campaign with an active session, kill the websocket connection via DevTools, let it reconnect, and confirm the `GameStateContext` value still reflects current turn state (look at any consumer of `isMyTurn` — e.g., the existing DM toolkit components). Document the result.

- [ ] **Step 4: Commit**

```bash
git add contexts/GameStateContext.tsx
git commit -m "feat(realtime): refresh game state on snapshot event"
```

---

## Task 6: Client actionability hook

**Files:**
- Create: `hooks/useActionability.ts`

This hook adapts the existing `GameStateContext` value into an actionability decision for the current user. It is the single source the chat UI consults — both for the `<TurnStatusBar>` text and for `inputDisabled`.

- [ ] **Step 1: Write the hook**

Create `hooks/useActionability.ts`:

```ts
import { useMemo } from "react";
import { computeActionability, type ActionabilityResult } from "../shared/actionability";
import { useGameState } from "../contexts/GameStateContext";
import { useUser } from "../contexts/UserContext";

/**
 * Returns the current user's actionability for the active campaign session.
 *
 * Pass `hasActiveCharacter` so the hook stays UI-agnostic — chat-system.tsx
 * already manages `campaignCharacter` and passes `!!campaignCharacter`.
 */
export function useActionability(hasActiveCharacter: boolean): ActionabilityResult {
  const { gameState } = useGameState();
  const { user } = useUser();

  return useMemo(
    () =>
      computeActionability({
        gameState: gameState
          ? {
              phase: gameState.phase,
              turnOrder: gameState.turnOrder,
              activePlayerId: gameState.activePlayerId,
            }
          : null,
        userId: user?.id ?? "",
        hasActiveCharacter,
      }),
    [gameState, user?.id, hasActiveCharacter],
  );
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: clean. If `useGameState` or `useUser` aren't exported from those paths, locate the correct exports (`rg -n "export function useGameState|export const useGameState" contexts/`) and update the import.

- [ ] **Step 3: Commit**

```bash
git add hooks/useActionability.ts
git commit -m "feat(chat): add useActionability hook"
```

---

## Task 7: Turn status bar component

**Files:**
- Create: `components/turn-status-bar.tsx`
- Create: `tests/turn-status-bar.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `tests/turn-status-bar.test.tsx`:

```tsx
import { describe, expect, it } from '@jest/globals';
import { render, screen } from '@testing-library/react';
import { TurnStatusBar } from '../components/turn-status-bar';

describe('<TurnStatusBar>', () => {
  it('shows positive state when canAct is true', () => {
    render(
      <TurnStatusBar
        actionability={{ canAct: true, reason: 'ok' }}
        activePlayerName={null}
      />,
    );
    expect(screen.getByText(/your turn/i)).toBeInTheDocument();
  });

  it('shows no-session message', () => {
    render(
      <TurnStatusBar
        actionability={{ canAct: false, reason: 'no_active_session' }}
        activePlayerName={null}
      />,
    );
    expect(screen.getByText(/no active session/i)).toBeInTheDocument();
  });

  it('shows phase-paused message with phase name', () => {
    render(
      <TurnStatusBar
        actionability={{ canAct: false, reason: 'phase_not_actionable', phase: 'rest' }}
        activePlayerName={null}
      />,
    );
    expect(screen.getByText(/rest.*actions paused/i)).toBeInTheDocument();
  });

  it('shows spectator message', () => {
    render(
      <TurnStatusBar
        actionability={{ canAct: false, reason: 'user_not_in_turn_order' }}
        activePlayerName={null}
      />,
    );
    expect(screen.getByText(/spectator/i)).toBeInTheDocument();
  });

  it("shows active player's name during combat", () => {
    render(
      <TurnStatusBar
        actionability={{
          canAct: false,
          reason: 'not_active_player_in_combat',
          activeUserId: 'user-2',
        }}
        activePlayerName="Bob"
      />,
    );
    expect(screen.getByText(/combat — bob's turn/i)).toBeInTheDocument();
  });

  it('falls back to "another player" when active name unknown', () => {
    render(
      <TurnStatusBar
        actionability={{
          canAct: false,
          reason: 'not_active_player_in_combat',
          activeUserId: 'user-2',
        }}
        activePlayerName={null}
      />,
    );
    expect(screen.getByText(/another player/i)).toBeInTheDocument();
  });

  it('shows no-character message', () => {
    render(
      <TurnStatusBar
        actionability={{ canAct: false, reason: 'no_active_character' }}
        activePlayerName={null}
      />,
    );
    expect(screen.getByText(/no character enrolled/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest tests/turn-status-bar.test.tsx`
Expected: FAIL with `Cannot find module '../components/turn-status-bar'`.

- [ ] **Step 3: Implement the component**

Create `components/turn-status-bar.tsx`:

```tsx
import { CheckCircle2, Hourglass, Info, Pause } from "lucide-react";
import type { ActionabilityResult } from "../shared/actionability";
import { cn } from "../utils/cn";

interface TurnStatusBarProps {
  actionability: ActionabilityResult;
  activePlayerName: string | null;
}

export function TurnStatusBar({ actionability, activePlayerName }: TurnStatusBarProps) {
  const { canAct, reason } = actionability;

  let icon = <Pause className="w-4 h-4" />;
  let text = "Actions paused";
  let tone: "ok" | "info" | "warn" = "info";

  switch (reason) {
    case "ok":
      icon = <CheckCircle2 className="w-4 h-4" />;
      text = "Your turn — act freely";
      tone = "ok";
      break;
    case "no_active_session":
      icon = <Info className="w-4 h-4" />;
      text = "No active session — Campaign Director hasn't started one";
      tone = "info";
      break;
    case "phase_not_actionable":
      icon = <Pause className="w-4 h-4" />;
      text = `Phase: ${actionability.phase ?? "paused"} — actions paused`;
      tone = "info";
      break;
    case "user_not_in_turn_order":
      icon = <Info className="w-4 h-4" />;
      text = "You're a spectator — join from the dashboard to act";
      tone = "info";
      break;
    case "not_active_player_in_combat":
      icon = <Hourglass className="w-4 h-4" />;
      text = `Combat — ${activePlayerName ?? "another player"}'s turn`;
      tone = "warn";
      break;
    case "no_active_character":
      icon = <Info className="w-4 h-4" />;
      text = "No character enrolled — join with one to act";
      tone = "info";
      break;
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "flex items-center gap-2 px-3 py-1.5 text-xs border-b",
        tone === "ok" && "bg-emerald-50 text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300",
        tone === "info" && "bg-muted/40 text-muted-foreground",
        tone === "warn" && "bg-amber-50 text-amber-800 dark:bg-amber-950/30 dark:text-amber-300",
      )}
      data-canact={canAct}
      data-reason={reason}
    >
      {icon}
      <span>{text}</span>
    </div>
  );
}
```

Confirm the icon imports match what's already used in the codebase by grepping: `rg -n "from \"lucide-react\"" components/chat-system.tsx`. If `cn` isn't at `utils/cn`, find the project's classname helper (likely under `utils/` or a UI library wrapper) and use that import path.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest tests/turn-status-bar.test.tsx`
Expected: PASS (7 tests).

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add components/turn-status-bar.tsx tests/turn-status-bar.test.tsx
git commit -m "feat(chat): add TurnStatusBar component"
```

---

## Task 8: Integrate the bar and gate IC submit in chat-system

**Files:**
- Modify: `components/chat-system.tsx:633-650` (placeholder + inputDisabled), and the JSX near the input (search for the `<Input>` or textarea element after line 650).

- [ ] **Step 1: Import the new pieces**

At the top of `components/chat-system.tsx`, add:

```ts
import { TurnStatusBar } from "./turn-status-bar";
import { useActionability } from "../hooks/useActionability";
import { useGameState } from "../contexts/GameStateContext";
```

- [ ] **Step 2: Compute actionability + gating**

Inside the component body, after `campaignCharacter` is established (around line 134 / wherever the state is declared), add:

```ts
const { activePlayerName } = useGameState();
const actionability = useActionability(Boolean(campaignCharacter));
const wouldBeAction =
  activeChannel.channelType === "party" && speakingInCharacter;
const blockedByTurn = wouldBeAction && !actionability.canAct;
```

- [ ] **Step 3: Update placeholder + inputDisabled**

Replace lines 634–650 with:

```ts
const inputPlaceholder = useMemo(() => {
  if (blockedByTurn) {
    return "Wait for your turn — toggle OOC to chat freely";
  }
  switch (activeChannel.channelType) {
    case "dm_broadcast":
      return isDm ? "Narrate to all players..." : "The DM narrates here — use Party chat to act";
    case "dm_whisper":
      return "Whisper to the DM...";
    case "director_whisper":
      return "Steer the DM... (only the LLM sees this)";
    case "private":
      return "Private message...";
    default:
      return "What do you do?";
  }
}, [activeChannel.channelType, blockedByTurn, isDm]);

const inputDisabled =
  sending ||
  (activeChannel.channelType === "dm_broadcast" && !isDm) ||
  blockedByTurn;
```

- [ ] **Step 4: Render the bar above the input**

Find the input region (the `<form>` or `<div>` wrapping the textarea and send button — likely after line 750 in the existing JSX). Render the bar conditionally on the active channel being `party`:

```tsx
{activeChannel.channelType === "party" && (
  <TurnStatusBar
    actionability={actionability}
    activePlayerName={activePlayerName}
  />
)}
{/* existing input row stays below */}
```

Place it immediately above the existing input row so the bar feels attached to the input, not floating in the message list.

- [ ] **Step 5: Verify Enter doesn't submit when blocked**

Inspect the existing keyboard handler near the textarea (search `onKeyDown.*Enter`). It already early-returns when `inputDisabled` is true; if not, add:

```ts
if (inputDisabled) return;
```

at the top of the handler.

- [ ] **Step 6: Type-check + lint**

Run: `npx tsc --noEmit && npx eslint components/chat-system.tsx`
Expected: clean.

- [ ] **Step 7: Visual smoke test in the dev server**

Run: `npm run dev` (or whatever the project's start command is — check `package.json` scripts). In a browser:

1. Open a campaign with an active session, you in the turn order — bar reads "Your turn — act freely", input enabled.
2. Have the CD end your turn (or use the DM toolkit). Bar flips to "Combat — X's turn" or similar; with IC toggle ON, input goes disabled with the new placeholder.
3. Toggle IC → OOC. Input re-enables. Send a message; it lands in chat.
4. Open a campaign with no active session. Bar reads "No active session — …".
5. Switch to the Adventure tab. Bar disappears.

Document any visual issues in the commit message.

- [ ] **Step 8: Commit**

```bash
git add components/chat-system.tsx
git commit -m "feat(chat): gate IC submit + show TurnStatusBar on party channel"
```

---

## Task 9: Verification sweep

**Files:** none — verification only.

- [ ] **Step 1: Full type-check**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 2: Full lint**

Run: `npx eslint .`
Expected: clean (or, if there are pre-existing warnings, no new ones introduced by this change).

- [ ] **Step 3: Full test run**

Run: `npx jest`
Expected: all green. Pay attention to chat-system / intercept tests in particular.

- [ ] **Step 4: Manual end-to-end**

Reproduce the original bug condition from the user's log: a player not in the campaign's turn order sends a party IC message.

- Before the fix: the message lands, the server logs `chat.intercept_skipped reason=user_not_in_turn_order`, the player sees no DM response.
- After the fix: IC submit is disabled with the bar reading "You're a spectator — join from the dashboard to act". The player must toggle OOC to send anything.

Confirm. If anything diverges, open a follow-up task rather than papering over it.

- [ ] **Step 5: Final commit (only if anything from the verification sweep changed)**

If verification surfaced lint/test fixes, commit them:

```bash
git add .
git commit -m "chore(chat): verification fixes for turn gating"
```

Otherwise this task ends without a commit.
