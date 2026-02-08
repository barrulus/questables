import { Router } from 'express';
import { requireAuth, requireCharacterOwnership } from '../auth-middleware.js';
import { getClient, query as dbQuery } from '../db/pool.js';
import { validateCharacter } from '../validation/characters.js';
import { handleValidationErrors, validateUUID } from '../validation/common.js';
import { logError, logInfo } from '../utils/logger.js';

const router = Router();

const checkCharacterOwnership = async (req, res, next) => {
  const { id } = req.params;
  const { user_id: bodyUserId } = req.body;
  const userId = bodyUserId || req.headers['x-user-id'];

  if (!userId) {
    return res.status(401).json({ error: 'User ID required for character access' });
  }

  try {
    const result = await dbQuery('SELECT user_id FROM characters WHERE id = $1', [id], {
      label: 'characters.fetch-owner',
    });

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Character not found' });
    }

    if (result.rows[0].user_id !== userId) {
      return res.status(403).json({ error: 'Access denied. You can only access your own characters' });
    }

    next();
  } catch (error) {
    logError('Character ownership check failed', error, { characterId: id, userId });
    res.status(500).json({ error: 'Authorization check failed' });
  }
};

router.post('/', requireAuth, validateCharacter, handleValidationErrors, async (req, res) => {
  const {
    user_id,
    name,
    character_class,
    level,
    race,
    background,
    hit_points,
    armor_class,
    speed,
    proficiency_bonus,
    abilities,
    saving_throws,
    skills,
    inventory,
    equipment,
    avatar_url,
    backstory,
    personality,
    ideals,
    bonds,
    flaws,
    spellcasting,
    species_key,
    class_key,
    background_key,
    subrace,
    subclass,
    experience_points,
    alignment,
    inspiration,
    death_saves,
    conditions,
    languages,
    proficiencies,
    ability_score_method,
    creation_state,
  } = req.body;

  if (!user_id || !name || !character_class || !race || !background) {
    return res.status(400).json({
      error: 'Required fields: user_id, name, character_class, race, background',
    });
  }

  let client;
  try {
    client = await getClient({ label: 'characters.create' });
    const result = await client.query(
      `
      INSERT INTO characters (
        user_id, name, class, level, race, background, hit_points, armor_class, speed,
        proficiency_bonus, abilities, saving_throws, skills, inventory, equipment,
        avatar_url, backstory, personality, ideals, bonds, flaws, spellcasting,
        species_key, class_key, background_key, subrace, subclass,
        experience_points, alignment, inspiration, death_saves, conditions,
        languages, proficiencies, ability_score_method, creation_state
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22,
              $23, $24, $25, $26, $27, $28, $29, $30, $31::jsonb, $32::jsonb, $33::jsonb, $34::jsonb, $35, $36::jsonb)
      RETURNING *
    `,
      [
        user_id,
        name,
        character_class,
        level || 1,
        race,
        background,
        JSON.stringify(hit_points || { current: 0, max: 0, temporary: 0 }),
        armor_class || 10,
        speed || 30,
        proficiency_bonus || 2,
        JSON.stringify(
          abilities || {
            strength: 10,
            dexterity: 10,
            constitution: 10,
            intelligence: 10,
            wisdom: 10,
            charisma: 10,
          },
        ),
        JSON.stringify(saving_throws || {}),
        JSON.stringify(skills || {}),
        JSON.stringify(inventory || []),
        JSON.stringify(equipment || {}),
        avatar_url,
        backstory,
        personality,
        ideals,
        bonds,
        flaws,
        JSON.stringify(spellcasting),
        species_key || null,
        class_key || null,
        background_key || null,
        subrace || null,
        subclass || null,
        experience_points || 0,
        alignment || null,
        inspiration || false,
        JSON.stringify(death_saves || { successes: 0, failures: 0 }),
        JSON.stringify(conditions || []),
        JSON.stringify(languages || ['Common']),
        JSON.stringify(proficiencies || {}),
        ability_score_method || null,
        creation_state ? JSON.stringify(creation_state) : null,
      ],
    );

    logInfo('Character created', {
      telemetryEvent: 'character.created',
      characterId: result.rows[0]?.id,
      userId: user_id,
    });

    res.status(201).json({ character: result.rows[0] });
  } catch (error) {
    logError('Character creation failed', error, { userId: user_id });
    res.status(500).json({ error: 'Failed to create character' });
  } finally {
    client?.release();
  }
});

router.get('/:id', requireAuth, async (req, res) => {
  const { id } = req.params;
  let client;
  try {
    client = await getClient({ label: 'characters.fetch' });
    const result = await client.query('SELECT * FROM characters WHERE id = $1', [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Character not found' });
    }
    res.json({ character: result.rows[0] });
  } catch (error) {
    logError('Character fetch failed', error, { characterId: id });
    res.status(500).json({ error: 'Failed to fetch character' });
  } finally {
    client?.release();
  }
});

router.put(
  '/:id',
  requireAuth,
  validateUUID('id'),
  validateCharacter,
  handleValidationErrors,
  requireCharacterOwnership,
  async (req, res) => {
    const { id } = req.params;
    const updates = { ...req.body };

    delete updates.id;
    delete updates.created_at;
    updates.updated_at = new Date().toISOString();

    const fields = Object.keys(updates);
    if (fields.length === 0) {
      return res.status(400).json({ error: 'No updates provided' });
    }

    const setClause = fields
      .map((field, index) => {
        if (
          [
            'hit_points',
            'abilities',
            'saving_throws',
            'skills',
            'inventory',
            'equipment',
            'spellcasting',
            'death_saves',
            'conditions',
            'languages',
            'proficiencies',
            'creation_state',
          ].includes(field)
        ) {
          return `${field} = $${index + 1}::jsonb`;
        }
        return `${field} = $${index + 1}`;
      })
      .join(', ');

    let client;
    try {
      client = await getClient({ label: 'characters.update' });
      const values = fields.map((field) => updates[field]);
      const result = await client.query(
        `UPDATE characters SET ${setClause} WHERE id = $${fields.length + 1} RETURNING *`,
        [...values, id],
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Character not found' });
      }

      logInfo('Character updated', {
        telemetryEvent: 'character.updated',
        characterId: id,
      });

      res.json({ character: result.rows[0] });
    } catch (error) {
      logError('Character update failed', error, { characterId: id });
      res.status(500).json({ error: 'Failed to update character' });
    } finally {
      client?.release();
    }
  },
);

router.delete('/:id', checkCharacterOwnership, async (req, res) => {
  const { id } = req.params;
  let client;
  try {
    client = await getClient({ label: 'characters.delete' });
    const result = await client.query('DELETE FROM characters WHERE id = $1 RETURNING id', [id]);

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Character not found' });
    }

    logInfo('Character deleted', {
      telemetryEvent: 'character.deleted',
      characterId: id,
    });

    res.json({ message: 'Character deleted successfully' });
  } catch (error) {
    logError('Character delete failed', error, { characterId: id });
    res.status(500).json({ error: 'Failed to delete character' });
  } finally {
    client?.release();
  }
});

export const registerCharacterRoutes = (app) => {
  app.use('/api/characters', router);

  app.get('/api/users/:userId/characters', async (req, res) => {
    const { userId } = req.params;
    let client;
    try {
      client = await getClient({ label: 'characters.by-user' });

      const charactersPromise = client.query(
        'SELECT * FROM characters WHERE user_id = $1 ORDER BY created_at DESC',
        [userId],
      );

      const tokensPromise = client.query(
        `SELECT cp.id AS player_id,
                cp.character_id,
                cp.campaign_id,
                cp.role,
                cp.visibility_state,
                cp.last_located_at,
                ST_AsGeoJSON(cp.loc_current)::json AS loc_geometry,
                ST_X(cp.loc_current) AS loc_x,
                ST_Y(cp.loc_current) AS loc_y,
                c.name AS campaign_name,
                c.status AS campaign_status
           FROM public.campaign_players cp
           JOIN public.campaigns c ON c.id = cp.campaign_id
          WHERE cp.user_id = $1
            AND cp.status = 'active'`,
        [userId],
      );

      const [characterResult, tokenResult] = await Promise.all([charactersPromise, tokensPromise]);

      const tokensByCharacter = tokenResult.rows.reduce((acc, row) => {
        if (!row.character_id) {
          return acc;
        }
        if (!acc.has(row.character_id)) {
          acc.set(row.character_id, []);
        }
        acc.get(row.character_id)?.push(row);
        return acc;
      }, new Map());

      const charactersWithTokens = characterResult.rows.map((character) => ({
        ...character,
        player_tokens: tokensByCharacter.get(character.id) ?? [],
      }));

      res.json({ characters: charactersWithTokens });
    } catch (error) {
      logError('User characters fetch failed', error, { userId });
      res.status(500).json({ error: 'Failed to fetch characters' });
    } finally {
      client?.release();
    }
  });
};
