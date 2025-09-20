import { LLMServiceError } from '../errors.js';

const parseJson = (value, fallback) => {
  if (value === null || value === undefined) {
    return fallback;
  }
  if (typeof value === 'object') {
    return value;
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    try {
      return JSON.parse(value);
    } catch (error) {
      return fallback;
    }
  }
  return fallback;
};

const nullIfEmpty = (value) => {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') {
    return value.trim().length === 0 ? null : value.trim();
  }
  return value;
};

const mapCampaignRow = (row) => {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    description: nullIfEmpty(row.description),
    status: row.status,
    system: row.system,
    setting: row.setting,
    dm: {
      id: row.dm_user_id,
      username: row.dm_username,
      email: row.dm_email,
      roles: Array.isArray(row.dm_roles) ? row.dm_roles : [],
      avatarUrl: nullIfEmpty(row.dm_avatar_url),
    },
    worldMapId: row.world_map_id,
    levelRange: parseJson(row.level_range, null),
    maxPlayers: row.max_players,
    isPublic: row.is_public,
    allowSpectators: row.allow_spectators,
    autoApproveJoinRequests: row.auto_approve_join_requests,
    experienceType: row.experience_type,
    restingRules: row.resting_rules,
    deathSaveRules: row.death_save_rules,
    createdAt: row.created_at?.toISOString?.() ?? null,
    updatedAt: row.updated_at?.toISOString?.() ?? null,
    lastActivityAt: row.last_activity?.toISOString?.() ?? null,
  };
};

const mapSessionRow = (row) => {
  if (!row) return null;
  return {
    id: row.id,
    campaignId: row.campaign_id,
    number: row.session_number,
    title: row.title,
    summary: nullIfEmpty(row.summary),
    dmNotes: nullIfEmpty(row.dm_notes),
    status: row.status,
    scheduledAt: row.scheduled_at?.toISOString?.() ?? null,
    startedAt: row.started_at?.toISOString?.() ?? null,
    endedAt: row.ended_at?.toISOString?.() ?? null,
    durationMinutes: row.duration,
    experienceAwarded: row.experience_awarded,
    treasureAwarded: parseJson(row.treasure_awarded, []),
    createdAt: row.created_at?.toISOString?.() ?? null,
    updatedAt: row.updated_at?.toISOString?.() ?? null,
  };
};

const mapCharacterRow = (row) => {
  if (!row) return null;
  return {
    id: row.character_id,
    name: row.character_name,
    class: row.character_class,
    level: typeof row.level === 'number' ? row.level : Number(row.level ?? 0),
    race: row.race,
    background: nullIfEmpty(row.background),
    hitPoints: parseJson(row.hit_points, null),
    armorClass: row.armor_class,
    speed: row.speed,
    proficiencyBonus: row.proficiency_bonus,
    abilities: parseJson(row.abilities, {}),
    savingThrows: parseJson(row.saving_throws, {}),
    skills: parseJson(row.skills, {}),
    inventory: parseJson(row.inventory, []),
    equipment: parseJson(row.equipment, {}),
    avatarUrl: nullIfEmpty(row.avatar_url),
    personality: nullIfEmpty(row.personality),
    ideals: nullIfEmpty(row.ideals),
    bonds: nullIfEmpty(row.bonds),
    flaws: nullIfEmpty(row.flaws),
    spellcasting: parseJson(row.spellcasting, null),
    lastPlayedAt: row.last_played?.toISOString?.() ?? null,
  };
};

const mapPlayerRow = (row) => {
  if (!row) return null;
  return {
    id: row.user_id,
    username: row.username,
    email: row.email,
    roles: Array.isArray(row.user_roles) ? row.user_roles : [],
    status: row.user_status,
    timezone: row.timezone,
  };
};

const mapLocationRow = (row) => {
  if (!row) return null;
  return {
    id: row.id,
    campaignId: row.campaign_id,
    name: row.name,
    description: nullIfEmpty(row.description),
    type: row.type,
    mapUrl: nullIfEmpty(row.map_url),
    gridSize: row.grid_size,
    worldMapId: row.world_map_id,
    linkedBurgId: row.linked_burg_id,
    isDiscovered: row.is_discovered,
    features: parseJson(row.features, []),
    parentLocation: row.parent_location_id
      ? {
          id: row.parent_location_id,
          name: row.parent_name || null,
        }
      : null,
    hazards: parseJson(row.hazards, []),
    encounters: parseJson(row.encounters, []),
    createdAt: row.created_at?.toISOString?.() ?? null,
    updatedAt: row.updated_at?.toISOString?.() ?? null,
  };
};

const mapNPCRelationshipRow = (row) => {
  if (!row) return null;
  return {
    id: row.id,
    targetId: row.target_id,
    targetType: row.target_type,
    relationshipType: row.relationship_type,
    description: nullIfEmpty(row.description),
    strength: typeof row.strength === 'number' ? row.strength : Number(row.strength ?? 0),
    targetName: nullIfEmpty(row.target_name),
  };
};

const mapNPCRow = (row) => {
  if (!row) return null;
  return {
    id: row.id,
    campaignId: row.campaign_id,
    name: row.name,
    description: nullIfEmpty(row.description),
    race: row.race,
    occupation: nullIfEmpty(row.occupation),
    avatarUrl: nullIfEmpty(row.avatar_url),
    appearance: nullIfEmpty(row.appearance),
    personality: row.personality,
    motivations: nullIfEmpty(row.motivations),
    secrets: nullIfEmpty(row.secrets),
    stats: parseJson(row.stats, {}),
    currentLocationId: row.current_location_id,
    relationships: Array.isArray(row.relationships)
      ? row.relationships.map(mapNPCRelationshipRow)
      : [],
    createdAt: row.created_at?.toISOString?.() ?? null,
    updatedAt: row.updated_at?.toISOString?.() ?? null,
  };
};

const mapEncounterParticipantRow = (row) => {
  if (!row) return null;
  return {
    id: row.id,
    participantId: row.participant_id,
    participantType: row.participant_type,
    name: row.name,
    initiative: row.initiative,
    hitPoints: parseJson(row.hit_points, {}),
    armorClass: row.armor_class,
    conditions: parseJson(row.conditions, []),
    hasActed: row.has_acted,
  };
};

const mapEncounterRow = (row) => {
  if (!row) return null;
  return {
    id: row.id,
    campaignId: row.campaign_id,
    sessionId: row.session_id,
    locationId: row.location_id,
    name: row.name,
    description: nullIfEmpty(row.description),
    type: row.type,
    difficulty: row.difficulty,
    status: row.status,
    initiativeOrder: parseJson(row.initiative_order, []),
    currentRound: row.current_round,
    experienceReward: row.experience_reward,
    treasureReward: parseJson(row.treasure_reward, []),
    participants: row.participants ? row.participants.map(mapEncounterParticipantRow) : [],
    createdAt: row.created_at?.toISOString?.() ?? null,
    updatedAt: row.updated_at?.toISOString?.() ?? null,
  };
};

const mapChatMessageRow = (row) => {
  if (!row) return null;
  return {
    id: row.id,
    campaignId: row.campaign_id,
    sessionId: row.session_id,
    content: row.content,
    messageType: row.message_type,
    sender: {
      id: row.sender_id,
      name: row.sender_name,
      username: row.username || null,
      characterId: row.character_id,
      characterName: row.character_name || null,
    },
    diceRoll: parseJson(row.dice_roll, null),
    isPrivate: row.is_private,
    recipients: parseJson(row.recipients, []),
    reactions: parseJson(row.reactions, []),
    createdAt: row.created_at?.toISOString?.() ?? null,
  };
};

export class LLMContextManager {
  constructor({ pool }) {
    if (!pool || typeof pool.connect !== 'function') {
      throw new Error('LLMContextManager requires a PostgreSQL pool instance');
    }
    this.pool = pool;
  }

  async buildGameContext({ campaignId, sessionId } = {}) {
    if (!campaignId) {
      throw new LLMServiceError('Campaign ID is required to build LLM context', {
        type: 'context_builder_missing_campaign',
      });
    }

    const client = await this.pool.connect();
    try {
      const campaign = await this.#loadCampaign(client, campaignId);
      if (!campaign) {
        throw new LLMServiceError('Campaign not found for context building', {
          type: 'context_builder_campaign_missing',
          campaignId,
        });
      }

      const session = await this.#loadSession(client, { campaignId, sessionId });
      const party = await this.#loadParty(client, campaignId, session);
      const locations = await this.#loadLocations(client, campaignId);
      const npcs = await this.#loadNPCs(client, campaignId);
      const encounters = await this.#loadEncounters(client, { campaignId, sessionId: session?.id });
      const recentMessages = await this.#loadRecentMessages(client, campaignId, session?.id);

      return {
        campaign,
        session,
        party,
        locations,
        npcs,
        encounters,
        chat: {
          recentMessages,
        },
        generatedAt: new Date().toISOString(),
      };
    } finally {
      client.release();
    }
  }

  async #loadCampaign(client, campaignId) {
    const result = await client.query(
      `SELECT c.*, 
              dm.username AS dm_username,
              dm.email AS dm_email,
              dm.avatar_url AS dm_avatar_url,
              dm.roles AS dm_roles
         FROM public.campaigns c
         JOIN public.user_profiles dm ON dm.id = c.dm_user_id
        WHERE c.id = $1`,
      [campaignId]
    );
    return mapCampaignRow(result.rows[0]);
  }

  async #loadSession(client, { campaignId, sessionId }) {
    let row;
    if (sessionId) {
      const sessionResult = await client.query(
        `SELECT *
           FROM public.sessions
          WHERE id = $1 AND campaign_id = $2`,
        [sessionId, campaignId]
      );
      row = sessionResult.rows[0];
    } else {
      const sessionResult = await client.query(
        `SELECT *
           FROM public.sessions
          WHERE campaign_id = $1
          ORDER BY (status = 'active') DESC, session_number DESC
          LIMIT 1`,
        [campaignId]
      );
      row = sessionResult.rows[0];
    }

    if (!row) {
      return null;
    }

    const session = mapSessionRow(row);

    const participantResult = await client.query(
      `SELECT sp.*, 
              ch.id AS character_id,
              ch.name AS character_name,
              ch.class AS character_class,
              ch.level,
              ch.race,
              ch.background,
              ch.hit_points,
              ch.armor_class,
              ch.speed,
              ch.proficiency_bonus,
              ch.abilities,
              ch.saving_throws,
              ch.skills,
              ch.inventory,
              ch.equipment,
              ch.avatar_url,
              ch.personality,
              ch.ideals,
              ch.bonds,
              ch.flaws,
              ch.spellcasting,
              ch.last_played,
              up.id AS user_id,
              up.username,
              up.email,
              up.roles AS user_roles,
              up.status AS user_status,
              up.timezone
         FROM public.session_participants sp
         JOIN public.characters ch ON ch.id = sp.character_id
         JOIN public.user_profiles up ON up.id = sp.user_id
        WHERE sp.session_id = $1
        ORDER BY ch.name ASC` ,
      [session.id]
    );

    const participants = participantResult.rows.map((participantRow) => ({
      character: mapCharacterRow(participantRow),
      player: mapPlayerRow(participantRow),
      attendanceStatus: participantRow.attendance_status,
      characterLevelStart: participantRow.character_level_start,
      characterLevelEnd: participantRow.character_level_end,
    }));

    return {
      ...session,
      participants,
    };
  }

  async #loadParty(client, campaignId, session) {
    const result = await client.query(
      `SELECT cp.*, 
              ch.id AS character_id,
              ch.name AS character_name,
              ch.class AS character_class,
              ch.level,
              ch.race,
              ch.background,
              ch.hit_points,
              ch.armor_class,
              ch.speed,
              ch.proficiency_bonus,
              ch.abilities,
              ch.saving_throws,
              ch.skills,
              ch.inventory,
              ch.equipment,
              ch.avatar_url,
              ch.personality,
              ch.ideals,
              ch.bonds,
              ch.flaws,
              ch.spellcasting,
              ch.last_played,
              up.id AS user_id,
              up.username,
              up.email,
              up.roles AS user_roles,
              up.status AS user_status,
              up.timezone
         FROM public.campaign_players cp
         JOIN public.characters ch ON ch.id = cp.character_id
         JOIN public.user_profiles up ON up.id = cp.user_id
        WHERE cp.campaign_id = $1
        ORDER BY ch.name ASC` ,
      [campaignId]
    );

    const activeCharacterIds = new Set(
      session?.participants?.map((participant) => participant.character.id) ?? []
    );

    return result.rows.map((row) => ({
      character: mapCharacterRow(row),
      player: mapPlayerRow(row),
      status: row.status,
      role: row.role,
      joinedAt: row.joined_at?.toISOString?.() ?? null,
      isInCurrentSession: activeCharacterIds.has(row.character_id),
    }));
  }

  async #loadLocations(client, campaignId) {
    const result = await client.query(
      `SELECT l.*, parent.name AS parent_name
         FROM public.locations l
         LEFT JOIN public.locations parent ON parent.id = l.parent_location_id
        WHERE l.campaign_id = $1
        ORDER BY l.is_discovered DESC, l.name ASC` ,
      [campaignId]
    );
    return result.rows.map(mapLocationRow);
  }

  async #loadNPCs(client, campaignId) {
    const result = await client.query(
      `SELECT n.*
         FROM public.npcs n
        WHERE n.campaign_id = $1
        ORDER BY n.name ASC` ,
      [campaignId]
    );

    if (result.rows.length === 0) {
      return [];
    }

    const npcIds = result.rows.map((row) => row.id);
    const relationshipsResult = await client.query(
      `SELECT r.*, 
              COALESCE(target_char.name, target_npc.name) AS target_name
         FROM public.npc_relationships r
         LEFT JOIN public.characters target_char ON (r.target_type = 'character' AND target_char.id = r.target_id)
         LEFT JOIN public.npcs target_npc ON (r.target_type = 'npc' AND target_npc.id = r.target_id)
        WHERE r.npc_id = ANY($1::uuid[])` ,
      [npcIds]
    );

    const relationshipsByNpc = relationshipsResult.rows.reduce((acc, relationshipRow) => {
      const key = relationshipRow.npc_id;
      if (!acc.has(key)) {
        acc.set(key, []);
      }
      acc.get(key).push(relationshipRow);
      return acc;
    }, new Map());

    return result.rows.map((row) =>
      mapNPCRow({
        ...row,
        relationships: relationshipsByNpc.get(row.id) || [],
      })
    );
  }

  async #loadEncounters(client, { campaignId, sessionId }) {
    const params = [campaignId];
    const whereClauses = ['e.campaign_id = $1'];

    if (sessionId) {
      params.push(sessionId);
      whereClauses.push(`(e.session_id = $${params.length} OR e.session_id IS NULL)`);
    }

    const encountersResult = await client.query(
      `SELECT e.*
         FROM public.encounters e
        WHERE ${whereClauses.join(' AND ')}
          AND e.status IN ('active', 'planned')
        ORDER BY e.status DESC, e.updated_at DESC` ,
      params
    );

    if (encountersResult.rows.length === 0) {
      return [];
    }

    const encounterIds = encountersResult.rows.map((row) => row.id);
    const participantsResult = await client.query(
      `SELECT ep.*
         FROM public.encounter_participants ep
        WHERE ep.encounter_id = ANY($1::uuid[])` ,
      [encounterIds]
    );

    const participantsByEncounter = participantsResult.rows.reduce((acc, participantRow) => {
      const key = participantRow.encounter_id;
      if (!acc.has(key)) {
        acc.set(key, []);
      }
      acc.get(key).push(mapEncounterParticipantRow(participantRow));
      return acc;
    }, new Map());

    return encountersResult.rows.map((row) =>
      mapEncounterRow({
        ...row,
        participants: participantsByEncounter.get(row.id) || [],
      })
    );
  }

  async #loadRecentMessages(client, campaignId, sessionId) {
    const params = [campaignId];
    const whereClauses = ['m.campaign_id = $1'];

    if (sessionId) {
      params.push(sessionId);
      whereClauses.push('(m.session_id = $2 OR m.session_id IS NULL)');
    }

    const messagesResult = await client.query(
      `SELECT m.*, 
              u.username,
              c.name AS character_name
         FROM public.chat_messages m
         LEFT JOIN public.user_profiles u ON u.id = m.sender_id
         LEFT JOIN public.characters c ON c.id = m.character_id
        WHERE ${whereClauses.join(' AND ')}
        ORDER BY m.created_at DESC
        LIMIT 20` ,
      params
    );

    return messagesResult.rows.map(mapChatMessageRow);
  }
}

export default LLMContextManager;
