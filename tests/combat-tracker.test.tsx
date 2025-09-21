import { jest } from '@jest/globals';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

type CombatTrackerComponent = typeof import('../components/combat-tracker').default;

declare const Response: typeof global.Response;

const apiFetchMock = jest.fn();
const updateCombatMock = jest.fn();
const getMessagesByTypeMock = jest.fn(() => []);

let CombatTracker: CombatTrackerComponent;
const originalBaseUrl = process.env.VITE_DATABASE_SERVER_URL;

beforeAll(() => {
  process.env.VITE_DATABASE_SERVER_URL = 'http://localhost:3001';
});

const createJsonResponse = (payload: unknown) =>
  new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

beforeAll(async () => {
await jest.unstable_mockModule('../utils/api-client', () => ({
    apiFetch: apiFetchMock,
    readErrorMessage: jest.fn(async (_response: Response, fallback: string) => fallback),
    readJsonBody: jest.fn(async (response: Response) => response.json()),
  }));

await jest.unstable_mockModule('../hooks/useWebSocket', () => ({
    useWebSocket: () => ({
      connected: false,
      updateCombat: updateCombatMock,
      getMessagesByType: getMessagesByTypeMock,
      sendChatMessage: jest.fn(),
      startTyping: jest.fn(),
      stopTyping: jest.fn(),
      updateCharacter: jest.fn(),
      updateSession: jest.fn(),
      updatePresence: jest.fn(),
      clearMessages: jest.fn(),
      typingUsers: [],
      presenceUsers: [],
      messages: [],
      connectionAttempts: 0,
      ping: jest.fn(),
    }),
  }));

  const module = await import('../components/combat-tracker');
  CombatTracker = module.default;
});

afterAll(() => {
  process.env.VITE_DATABASE_SERVER_URL = originalBaseUrl;
});

describe('CombatTracker', () => {
  beforeEach(() => {
    apiFetchMock.mockReset();
    updateCombatMock.mockReset();
    getMessagesByTypeMock.mockReturnValue([]);
  });

  it('loads encounters and rolls initiative through live endpoints', async () => {
    const encounterPayload = [
      {
        id: 'enc-1',
        campaign_id: 'camp-1',
        name: 'Ambush at the Ford',
        description: 'Goblins strike from the brush.',
        type: 'combat',
        difficulty: 'medium',
        status: 'planned',
        current_round: 0,
        participant_count: 1,
        initiative_order: null,
        location_name: null,
        session_title: null,
      },
    ];

    const participantPayload = [
      {
        id: 'part-1',
        encounter_id: 'enc-1',
        participant_id: 'char-1',
        participant_type: 'character',
        name: 'Elowen',
        initiative: null,
        hit_points: { max: 36, current: 36, temporary: 0 },
        armor_class: 15,
        conditions: [],
        has_acted: false,
      },
    ];

    const initiativePayload = {
      encounter: {
        id: 'enc-1',
        campaign_id: 'camp-1',
        name: 'Ambush at the Ford',
        description: 'Goblins strike from the brush.',
        type: 'combat',
        difficulty: 'medium',
        status: 'active',
        current_round: 1,
        participant_count: 1,
        initiative_order: [
          { participantId: 'part-1', initiative: 18, hasActed: false },
        ],
      },
      participants: [
        {
          id: 'part-1',
          encounter_id: 'enc-1',
          participant_id: 'char-1',
          participant_type: 'character',
          name: 'Elowen',
          initiative: 18,
          hit_points: { max: 36, current: 36, temporary: 0 },
          armor_class: 15,
          conditions: [],
          has_acted: false,
        },
      ],
    };

    const refreshedParticipants = initiativePayload.participants;

    apiFetchMock
      .mockResolvedValueOnce(createJsonResponse(encounterPayload))
      .mockResolvedValueOnce(createJsonResponse(participantPayload))
      .mockResolvedValueOnce(createJsonResponse(initiativePayload))
      .mockResolvedValueOnce(createJsonResponse(refreshedParticipants));

    render(<CombatTracker campaignId="camp-1" sessionId="sess-1" isDM />);

    await waitFor(() => expect(apiFetchMock).toHaveBeenCalledWith('/api/campaigns/camp-1/encounters', undefined));
    expect(await screen.findByText('Ambush at the Ford')).toBeInTheDocument();

    const rollButton = await screen.findByRole('button', { name: /roll initiative/i });
    await userEvent.click(rollButton);

    await waitFor(() =>
      expect(apiFetchMock).toHaveBeenCalledWith(
        '/api/encounters/enc-1/initiative',
        expect.objectContaining({ method: 'POST' }),
      ),
    );

    await waitFor(() => expect(screen.getByText(/Round 1/i)).toBeInTheDocument());
    expect(updateCombatMock).toHaveBeenCalledWith('enc-1', expect.objectContaining({ encounter: expect.any(Object) }));
  });
});
