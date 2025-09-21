import { jest } from '@jest/globals';

type CharacterHelpers = typeof import('../../utils/database/production-helpers.tsx').characterHelpers;

const queryMock = jest.fn();
let characterHelpers: CharacterHelpers;

beforeAll(async () => {
  await jest.unstable_mockModule('../../utils/database/client.tsx', () => ({
    databaseClient: {
      query: queryMock,
      spatial: jest.fn(),
      auth: {
        login: jest.fn(),
        register: jest.fn(),
      },
    },
  }));

  const module = await import('../../utils/database/production-helpers.tsx');
  characterHelpers = module.characterHelpers;
});

describe('characterHelpers', () => {
  beforeEach(() => {
    queryMock.mockReset();
  });

  it('creates a character and returns hydrated data', async () => {
    queryMock
      .mockResolvedValueOnce({ data: [{ id: 'new-char' }], error: null })
      .mockResolvedValueOnce({
        data: [
          {
            id: 'new-char',
            user_id: 'user-1',
            name: 'Mira',
            class: 'Cleric',
            level: 1,
            race: 'Human',
            background: 'Acolyte',
            hit_points: JSON.stringify({ max: 8, current: 8, temporary: 0 }),
            armor_class: 16,
            proficiency_bonus: 2,
            abilities: JSON.stringify({
              strength: 10,
              dexterity: 12,
              constitution: 12,
              intelligence: 10,
              wisdom: 16,
              charisma: 14,
            }),
            saving_throws: JSON.stringify({ wisdom: 5, charisma: 4 }),
            skills: JSON.stringify({ Insight: 5 }),
            inventory: JSON.stringify([]),
            equipment: JSON.stringify({}),
            spellcasting: null,
            created_at: '2025-09-20T00:00:00.000Z',
            updated_at: '2025-09-20T00:00:00.000Z',
          },
        ],
        error: null,
      });

    const payload = {
      user_id: 'user-1',
      name: 'Mira',
      class: 'Cleric',
      level: 1,
      race: 'Human',
      background: 'Acolyte',
      hit_points: { max: 8, current: 8, temporary: 0 },
      armor_class: 16,
      speed: 30,
      proficiency_bonus: 2,
      abilities: {
        strength: 10,
        dexterity: 12,
        constitution: 12,
        intelligence: 10,
        wisdom: 16,
        charisma: 14,
      },
      saving_throws: {},
      skills: {},
      inventory: [],
      equipment: {},
      spellcasting: null,
      backstory: '',
      personality: '',
      ideals: '',
      bonds: '',
      flaws: '',
    } as const;

    const created = await characterHelpers.createCharacter(payload as any);

    expect(queryMock).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('INSERT INTO characters'),
      expect.arrayContaining([
        payload.user_id,
        payload.name,
        payload.class,
        payload.level,
        payload.race,
      ]),
    );
    expect(queryMock).toHaveBeenNthCalledWith(2, 'SELECT * FROM characters WHERE id = $1', ['new-char']);
    expect(created?.name).toBe('Mira');
    expect(created?.hit_points).toEqual({ max: 8, current: 8, temporary: 0 });
    expect(created?.armor_class).toBe(16);
    expect(created?.abilities).toMatchObject({ wisdom: 16 });
  });

  it('updates a character and returns refreshed data', async () => {
    queryMock
      .mockResolvedValueOnce({ data: null, error: null })
      .mockResolvedValueOnce({
        data: [
          {
            id: 'char-1',
            user_id: 'user-1',
            name: 'Elowen',
            class: 'Wizard',
            level: 6,
            race: 'Elf',
            background: 'Sage',
            hit_points: JSON.stringify({ max: 36, current: 24, temporary: 0 }),
            armor_class: 15,
            proficiency_bonus: 3,
            abilities: JSON.stringify({
              strength: 8,
              dexterity: 14,
              constitution: 12,
              intelligence: 18,
              wisdom: 13,
              charisma: 10,
            }),
            saving_throws: JSON.stringify({ intelligence: 6, wisdom: 4 }),
            skills: JSON.stringify({ Arcana: 6 }),
            inventory: JSON.stringify([]),
            equipment: JSON.stringify({}),
            spellcasting: null,
            created_at: '2025-08-01T00:00:00.000Z',
            updated_at: '2025-09-20T00:00:00.000Z',
          },
        ],
        error: null,
      });

    const updates = {
      name: 'Elowen',
      class: 'Wizard',
      level: 6,
      race: 'Elf',
      background: 'Sage',
      armor_class: 15,
      proficiency_bonus: 3,
      hit_points: { max: 36, current: 24, temporary: 0 },
    } as const;

    const updated = await characterHelpers.updateCharacter('char-1', updates as any);

    expect(queryMock).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('UPDATE characters SET'),
      expect.arrayContaining(['char-1']),
    );
    expect(queryMock).toHaveBeenNthCalledWith(2, 'SELECT * FROM characters WHERE id = $1', ['char-1']);
    expect(updated?.level).toBe(6);
    expect(updated?.hit_points).toEqual({ max: 36, current: 24, temporary: 0 });
  });
});
