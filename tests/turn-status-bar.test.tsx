import '@testing-library/jest-dom/jest-globals';
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

  it('shows "enemy is acting" when active participant is an NPC', () => {
    render(
      <TurnStatusBar
        actionability={{
          canAct: false,
          reason: 'not_active_player_in_combat',
          activeUserId: 'npc:goblin-1',
        }}
        activePlayerName={null}
      />,
    );
    expect(screen.getByText(/enemy is acting/i)).toBeInTheDocument();
  });
});
