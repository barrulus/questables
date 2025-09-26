import type {
  Character,
  Equipment,
  InventoryItem,
  SpellcastingInfo,
} from '../database/data-structures';
import {
  fetchJson,
  buildJsonRequestInit,
  ensurePayload,
  type ApiRequestOptions,
} from '../api-client';

const DEFAULT_ABILITIES: Character['abilities'] = {
  strength: 10,
  dexterity: 10,
  constitution: 10,
  intelligence: 10,
  wisdom: 10,
  charisma: 10,
};

const DEFAULT_HIT_POINTS = { current: 0, max: 0, temporary: 0 };

const parseJsonField = <T>(value: unknown, fallback: T): T => {
  if (value === null || value === undefined) {
    return fallback;
  }

  if (typeof value === 'object') {
    return value as T;
  }

  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as T;
    } catch (error) {
      throw new Error(`[characters] Failed to parse JSON field: ${(error as Error).message}`);
    }
  }

  return fallback;
};

const parseOptionalJson = <T>(value: unknown): T | null => {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === 'object') {
    return value as T;
  }

  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as T;
    } catch (error) {
      throw new Error(`[characters] Failed to parse optional JSON field: ${(error as Error).message}`);
    }
  }

  return null;
};

const coerceNumber = (value: unknown, fallback: number): number => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return fallback;
};

const mapCharacterFromServer = (payload: Record<string, unknown>): Character => {
  const id = typeof payload.id === 'string' ? payload.id : String(payload.id ?? '');
  const userId = typeof payload.user_id === 'string'
    ? payload.user_id
    : typeof payload.userId === 'string'
      ? payload.userId
      : '';

  const className = typeof payload.class === 'string'
    ? payload.class
    : typeof payload.character_class === 'string'
      ? payload.character_class
      : typeof payload.characterClass === 'string'
        ? payload.characterClass
        : '';

  const hitPoints = parseJsonField<Character['hit_points']>(
    payload.hit_points ?? payload.hitPoints,
    { ...DEFAULT_HIT_POINTS },
  );

  const abilities = parseJsonField<Character['abilities']>(payload.abilities, { ...DEFAULT_ABILITIES });
  const savingThrows = parseJsonField<Record<string, number>>(
    payload.saving_throws ?? payload.savingThrows,
    {},
  );
  const skills = parseJsonField<Record<string, number>>(payload.skills, {});
  const inventory = parseJsonField<InventoryItem[]>(payload.inventory, []);
  const equipment = parseJsonField<Equipment>(payload.equipment, { weapons: {}, accessories: {} });
  const spellcasting = parseOptionalJson<SpellcastingInfo>(payload.spellcasting ?? payload.spellCasting);
  const campaigns = payload.campaigns !== undefined
    ? parseOptionalJson<string[]>(payload.campaigns) ?? undefined
    : undefined;

  const createdAt = typeof payload.created_at === 'string' ? payload.created_at : undefined;
  const updatedAt = typeof payload.updated_at === 'string' ? payload.updated_at : undefined;
  const lastPlayed = typeof payload.last_played === 'string' ? payload.last_played : undefined;

  const armorClass = coerceNumber(payload.armor_class ?? payload.armorClass, 10);
  const proficiencyBonus = coerceNumber(payload.proficiency_bonus ?? payload.proficiencyBonus, 2);
  const level = coerceNumber(payload.level, 1);
  const speed = coerceNumber(payload.speed, 30);

  return {
    ...(payload as Character),
    id,
    user_id: userId,
    userId,
    class: className,
    level,
    hit_points: hitPoints,
    hitPoints,
    armor_class: armorClass,
    armorClass,
    speed,
    proficiency_bonus: proficiencyBonus,
    proficiencyBonus,
    abilities,
    saving_throws: savingThrows,
    savingThrows,
    skills,
    inventory,
    equipment,
    spellcasting: spellcasting ?? undefined,
    campaigns,
    created_at: createdAt ?? '',
    updated_at: updatedAt ?? '',
    last_played: lastPlayed,
    createdAt,
    updatedAt,
    lastPlayed,
  };
};

export interface CharacterCreateRequest {
  userId: string;
  name: string;
  className: string;
  level: number;
  race: string;
  background: string;
  hitPoints: Character['hit_points'];
  armorClass: number;
  speed: number;
  proficiencyBonus: number;
  abilities: Character['abilities'];
  savingThrows: Record<string, number>;
  skills: Record<string, number>;
  inventory: InventoryItem[];
  equipment: Equipment;
  avatarUrl?: string | null;
  backstory?: string | null;
  personality?: string | null;
  ideals?: string | null;
  bonds?: string | null;
  flaws?: string | null;
  spellcasting?: SpellcastingInfo | null;
  campaigns?: string[] | null;
}

export type CharacterUpdateRequest = Partial<CharacterCreateRequest> & {
  class?: string;
  hit_points?: Character['hit_points'];
  proficiency_bonus?: number;
  armor_class?: number;
  saving_throws?: Record<string, number>;
  hitPoints?: Character['hit_points'];
  savingThrows?: Record<string, number>;
  spellcasting?: SpellcastingInfo | null;
  campaigns?: string[] | null;
};

const buildCharacterRequestBody = (
  payload: CharacterCreateRequest | CharacterUpdateRequest,
): Record<string, unknown> => {
  const body: Record<string, unknown> = {};

  if ('userId' in payload && payload.userId !== undefined) {
    body.user_id = payload.userId;
  }

  if ('name' in payload && payload.name !== undefined) {
    body.name = payload.name;
  }

  const classSource =
    'className' in payload && payload.className !== undefined
      ? payload.className
      : 'class' in payload && payload.class !== undefined
        ? payload.class
        : undefined;

  if (classSource !== undefined) {
    body.character_class = classSource;
  }

  if ('level' in payload && payload.level !== undefined) {
    body.level = payload.level;
  }

  if ('race' in payload && payload.race !== undefined) {
    body.race = payload.race;
  }

  if ('background' in payload && payload.background !== undefined) {
    body.background = payload.background;
  }

  if ('hitPoints' in payload && payload.hitPoints !== undefined) {
    body.hit_points = payload.hitPoints;
  } else if ('hit_points' in payload && payload.hit_points !== undefined) {
    body.hit_points = payload.hit_points;
  }

  if ('armorClass' in payload && payload.armorClass !== undefined) {
    body.armor_class = payload.armorClass;
  } else if ('armor_class' in payload && payload.armor_class !== undefined) {
    body.armor_class = payload.armor_class;
  }

  if ('speed' in payload && payload.speed !== undefined) {
    body.speed = payload.speed;
  }

  if ('proficiencyBonus' in payload && payload.proficiencyBonus !== undefined) {
    body.proficiency_bonus = payload.proficiencyBonus;
  } else if ('proficiency_bonus' in payload && payload.proficiency_bonus !== undefined) {
    body.proficiency_bonus = payload.proficiency_bonus;
  }

  if ('abilities' in payload && payload.abilities !== undefined) {
    body.abilities = payload.abilities;
  }

  if ('savingThrows' in payload && payload.savingThrows !== undefined) {
    body.saving_throws = payload.savingThrows;
  } else if ('saving_throws' in payload && payload.saving_throws !== undefined) {
    body.saving_throws = payload.saving_throws;
  }

  if ('skills' in payload && payload.skills !== undefined) {
    body.skills = payload.skills;
  }

  if ('inventory' in payload && payload.inventory !== undefined) {
    body.inventory = payload.inventory;
  }

  if ('equipment' in payload && payload.equipment !== undefined) {
    body.equipment = payload.equipment;
  }

  if ('avatarUrl' in payload) {
    body.avatar_url = payload.avatarUrl ?? null;
  }

  if ('backstory' in payload) {
    body.backstory = payload.backstory ?? null;
  }

  if ('personality' in payload) {
    body.personality = payload.personality ?? null;
  }

  if ('ideals' in payload) {
    body.ideals = payload.ideals ?? null;
  }

  if ('bonds' in payload) {
    body.bonds = payload.bonds ?? null;
  }

  if ('flaws' in payload) {
    body.flaws = payload.flaws ?? null;
  }

  if ('spellcasting' in payload) {
    body.spellcasting = payload.spellcasting ?? null;
  }

  if ('campaigns' in payload) {
    body.campaigns = payload.campaigns ?? null;
  }

  return body;
};

const mapCharactersResponse = (payload: unknown): Character[] => {
  if (!payload || typeof payload !== 'object') {
    return [];
  }

  const rows = (payload as { characters?: unknown }).characters;
  if (!Array.isArray(rows)) {
    return [];
  }

  return rows.map((row) => mapCharacterFromServer(row as Record<string, unknown>));
};

export async function listUserCharacters(
  userId: string,
  options: ApiRequestOptions = {},
): Promise<Character[]> {
  const data = await fetchJson<{ characters?: unknown[] }>(
    `/api/users/${userId}/characters`,
    { method: 'GET', signal: options.signal },
    'Failed to load characters',
  );

  return mapCharactersResponse(data ?? {});
}

export async function getCharacter(
  characterId: string,
  options: ApiRequestOptions = {},
): Promise<Character | null> {
  const data = await fetchJson<{ character?: Record<string, unknown> }>(
    `/api/characters/${characterId}`,
    { method: 'GET', signal: options.signal },
    'Failed to load character',
  );

  if (!data?.character) {
    return null;
  }

  return mapCharacterFromServer(data.character);
}

export async function createCharacter(
  payload: CharacterCreateRequest,
  options: ApiRequestOptions = {},
): Promise<Character> {
  const body = buildCharacterRequestBody(payload);

  const data = await fetchJson<{ character?: Record<string, unknown> }>(
    '/api/characters',
    buildJsonRequestInit('POST', body, options),
    'Failed to create character',
  );

  const response = ensurePayload(data, 'Character creation response missing payload');
  if (!response.character) {
    throw new Error('Character creation response missing character');
  }

  return mapCharacterFromServer(response.character);
}

export async function updateCharacter(
  characterId: string,
  updates: CharacterUpdateRequest,
  options: ApiRequestOptions = {},
): Promise<Character> {
  const body = buildCharacterRequestBody(updates);

  const data = await fetchJson<{ character?: Record<string, unknown> }>(
    `/api/characters/${characterId}`,
    buildJsonRequestInit('PUT', body, options),
    'Failed to update character',
  );

  const response = ensurePayload(data, 'Character update response missing payload');
  if (!response.character) {
    throw new Error('Character update response missing character');
  }

  return mapCharacterFromServer(response.character);
}

export async function deleteCharacter(
  characterId: string,
  options: ApiRequestOptions = {},
): Promise<void> {
  await fetchJson(
    `/api/characters/${characterId}`,
    { method: 'DELETE', signal: options.signal },
    'Failed to delete character',
  );
}
