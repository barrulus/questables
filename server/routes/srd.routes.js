import { Router } from 'express';
import { query as dbQuery } from '../db/pool.js';
import { computeStats } from '../services/srd/stats-engine.js';
import { logError } from '../utils/logger.js';

const router = Router();

/** Default source fallback: try requested source, then srd-2024, then any. */
function sourceWithFallback(source) {
  return source || 'srd-2024';
}

// GET /api/srd/species
router.get('/species', async (req, res) => {
  try {
    const { source } = req.query;
    const conditions = [];
    const params = [];
    let paramIdx = 1;

    if (source) {
      conditions.push(`document_source = $${paramIdx++}`);
      params.push(source);
    }

    let sql = 'SELECT * FROM srd_species';
    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ');
    }
    sql += ' ORDER BY is_subspecies ASC, name ASC';

    const result = await dbQuery(sql, params, { label: 'srd.species.list' });
    res.json({ species: result.rows });
  } catch (error) {
    logError('SRD species list failed', error);
    res.status(500).json({ error: 'Failed to fetch species' });
  }
});

// GET /api/srd/species/:key
router.get('/species/:key', async (req, res) => {
  try {
    const source = sourceWithFallback(req.query.source);
    const result = await dbQuery(
      `SELECT s.*,
        (SELECT json_agg(sub.*) FROM srd_species sub WHERE sub.subspecies_of_key = s.key AND sub.document_source = s.document_source) AS subspecies
       FROM srd_species s WHERE s.key = $1 AND s.document_source = $2`,
      [req.params.key, source],
      { label: 'srd.species.get' },
    );

    // Fallback: try any source if not found
    if (result.rows.length === 0) {
      const fallback = await dbQuery(
        `SELECT s.*,
          (SELECT json_agg(sub.*) FROM srd_species sub WHERE sub.subspecies_of_key = s.key AND sub.document_source = s.document_source) AS subspecies
         FROM srd_species s WHERE s.key = $1 ORDER BY CASE WHEN s.document_source = 'srd-2024' THEN 0 WHEN s.document_source = 'srd-2014' THEN 1 ELSE 2 END LIMIT 1`,
        [req.params.key],
        { label: 'srd.species.get.fallback' },
      );
      if (fallback.rows.length === 0) {
        return res.status(404).json({ error: 'Species not found' });
      }
      return res.json({ species: fallback.rows[0] });
    }

    res.json({ species: result.rows[0] });
  } catch (error) {
    logError('SRD species get failed', error);
    res.status(500).json({ error: 'Failed to fetch species' });
  }
});

// GET /api/srd/classes
router.get('/classes', async (req, res) => {
  try {
    const { source } = req.query;
    const conditions = [];
    const params = [];
    let paramIdx = 1;

    if (source) {
      conditions.push(`document_source = $${paramIdx++}`);
      params.push(source);
    }

    let sql = 'SELECT * FROM srd_classes';
    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ');
    }
    sql += ' ORDER BY subclass_of_key NULLS FIRST, name ASC';

    const result = await dbQuery(sql, params, { label: 'srd.classes.list' });
    res.json({ classes: result.rows });
  } catch (error) {
    logError('SRD classes list failed', error);
    res.status(500).json({ error: 'Failed to fetch classes' });
  }
});

// GET /api/srd/classes/:key
router.get('/classes/:key', async (req, res) => {
  try {
    const source = sourceWithFallback(req.query.source);
    const result = await dbQuery(
      `SELECT c.*,
        (SELECT json_agg(row_to_json(st)) FROM srd_class_saving_throws st WHERE st.class_key = c.key AND st.document_source = c.document_source) AS saving_throws_list,
        (SELECT json_agg(row_to_json(pa)) FROM srd_class_primary_abilities pa WHERE pa.class_key = c.key AND pa.document_source = c.document_source) AS primary_abilities_list,
        (SELECT json_agg(sub.*) FROM srd_classes sub WHERE sub.subclass_of_key = c.key AND sub.document_source = c.document_source) AS subclasses
       FROM srd_classes c WHERE c.key = $1 AND c.document_source = $2`,
      [req.params.key, source],
      { label: 'srd.classes.get' },
    );

    if (result.rows.length === 0) {
      const fallback = await dbQuery(
        `SELECT c.*,
          (SELECT json_agg(row_to_json(st)) FROM srd_class_saving_throws st WHERE st.class_key = c.key AND st.document_source = c.document_source) AS saving_throws_list,
          (SELECT json_agg(row_to_json(pa)) FROM srd_class_primary_abilities pa WHERE pa.class_key = c.key AND pa.document_source = c.document_source) AS primary_abilities_list,
          (SELECT json_agg(sub.*) FROM srd_classes sub WHERE sub.subclass_of_key = c.key AND sub.document_source = c.document_source) AS subclasses
         FROM srd_classes c WHERE c.key = $1 ORDER BY CASE WHEN c.document_source = 'srd-2024' THEN 0 WHEN c.document_source = 'srd-2014' THEN 1 ELSE 2 END LIMIT 1`,
        [req.params.key],
        { label: 'srd.classes.get.fallback' },
      );
      if (fallback.rows.length === 0) {
        return res.status(404).json({ error: 'Class not found' });
      }
      return res.json({ class: fallback.rows[0] });
    }

    res.json({ class: result.rows[0] });
  } catch (error) {
    logError('SRD class get failed', error);
    res.status(500).json({ error: 'Failed to fetch class' });
  }
});

// GET /api/srd/backgrounds
router.get('/backgrounds', async (req, res) => {
  try {
    const { source } = req.query;
    const conditions = [];
    const params = [];
    let paramIdx = 1;

    if (source) {
      conditions.push(`document_source = $${paramIdx++}`);
      params.push(source);
    }

    let sql = 'SELECT * FROM srd_backgrounds';
    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ');
    }
    sql += ' ORDER BY name ASC';

    const result = await dbQuery(sql, params, { label: 'srd.backgrounds.list' });
    res.json({ backgrounds: result.rows });
  } catch (error) {
    logError('SRD backgrounds list failed', error);
    res.status(500).json({ error: 'Failed to fetch backgrounds' });
  }
});

// GET /api/srd/backgrounds/:key
router.get('/backgrounds/:key', async (req, res) => {
  try {
    const source = sourceWithFallback(req.query.source);
    const result = await dbQuery(
      'SELECT * FROM srd_backgrounds WHERE key = $1 AND document_source = $2',
      [req.params.key, source],
      { label: 'srd.backgrounds.get' },
    );

    if (result.rows.length === 0) {
      const fallback = await dbQuery(
        `SELECT * FROM srd_backgrounds WHERE key = $1 ORDER BY CASE WHEN document_source = 'srd-2024' THEN 0 WHEN document_source = 'srd-2014' THEN 1 ELSE 2 END LIMIT 1`,
        [req.params.key],
        { label: 'srd.backgrounds.get.fallback' },
      );
      if (fallback.rows.length === 0) {
        return res.status(404).json({ error: 'Background not found' });
      }
      return res.json({ background: fallback.rows[0] });
    }

    res.json({ background: result.rows[0] });
  } catch (error) {
    logError('SRD background get failed', error);
    res.status(500).json({ error: 'Failed to fetch background' });
  }
});

// GET /api/srd/spells
router.get('/spells', async (req, res) => {
  try {
    const { level, ritual, source, q, school, concentration } = req.query;
    const classFilter = req.query.class;
    const limit = Math.min(parseInt(req.query.limit) || 200, 500);
    const offset = Math.max(parseInt(req.query.offset) || 0, 0);
    const conditions = [];
    const params = [];
    let paramIdx = 1;

    if (source) {
      conditions.push(`s.document_source = $${paramIdx++}`);
      params.push(source);
    }

    if (q) {
      conditions.push(`(s.name ILIKE $${paramIdx} OR s.desc_text ILIKE $${paramIdx})`);
      paramIdx++;
      params.push(`%${q}%`);
    }

    if (level !== undefined) {
      conditions.push(`s.level = $${paramIdx++}`);
      params.push(parseInt(level));
    }

    if (ritual !== undefined) {
      conditions.push(`s.ritual = $${paramIdx++}`);
      params.push(ritual === 'true');
    }

    if (concentration !== undefined) {
      conditions.push(`s.concentration = $${paramIdx++}`);
      params.push(concentration === 'true');
    }

    if (school) {
      conditions.push(`s.school_key = $${paramIdx++}`);
      params.push(school);
    }

    if (classFilter) {
      conditions.push(`EXISTS (SELECT 1 FROM srd_spell_classes sc WHERE sc.spell_key = s.key AND sc.class_key = $${paramIdx} AND sc.document_source = s.document_source)`);
      paramIdx++;
      params.push(classFilter);
    }

    let countSql = 'SELECT COUNT(*) FROM srd_spells s';
    let sql = 'SELECT s.* FROM srd_spells s';
    const whereClause = conditions.length > 0 ? ' WHERE ' + conditions.join(' AND ') : '';
    countSql += whereClause;
    sql += whereClause;
    sql += ` ORDER BY s.level ASC, s.name ASC LIMIT $${paramIdx++} OFFSET $${paramIdx++}`;
    params.push(limit, offset);

    const [countResult, result] = await Promise.all([
      dbQuery(countSql, params.slice(0, -2), { label: 'srd.spells.count' }),
      dbQuery(sql, params, { label: 'srd.spells.list' }),
    ]);

    res.json({
      spells: result.rows,
      total: parseInt(countResult.rows[0].count),
      limit,
      offset,
    });
  } catch (error) {
    logError('SRD spells list failed', error);
    res.status(500).json({ error: 'Failed to fetch spells' });
  }
});

// GET /api/srd/spells/:key
router.get('/spells/:key', async (req, res) => {
  try {
    const source = sourceWithFallback(req.query.source);
    const result = await dbQuery(
      `SELECT s.*,
        (SELECT json_agg(sc.class_key) FROM srd_spell_classes sc WHERE sc.spell_key = s.key AND sc.document_source = s.document_source) AS class_keys
       FROM srd_spells s WHERE s.key = $1 AND s.document_source = $2`,
      [req.params.key, source],
      { label: 'srd.spells.get' },
    );

    if (result.rows.length === 0) {
      const fallback = await dbQuery(
        `SELECT s.*,
          (SELECT json_agg(sc.class_key) FROM srd_spell_classes sc WHERE sc.spell_key = s.key AND sc.document_source = s.document_source) AS class_keys
         FROM srd_spells s WHERE s.key = $1 ORDER BY CASE WHEN s.document_source = 'srd-2024' THEN 0 WHEN s.document_source = 'srd-2014' THEN 1 ELSE 2 END LIMIT 1`,
        [req.params.key],
        { label: 'srd.spells.get.fallback' },
      );
      if (fallback.rows.length === 0) {
        return res.status(404).json({ error: 'Spell not found' });
      }
      return res.json({ spell: fallback.rows[0] });
    }

    res.json({ spell: result.rows[0] });
  } catch (error) {
    logError('SRD spell get failed', error);
    res.status(500).json({ error: 'Failed to fetch spell' });
  }
});

// GET /api/srd/items
router.get('/items', async (req, res) => {
  try {
    const { category, source, q, rarity } = req.query;
    const limit = Math.min(parseInt(req.query.limit) || 200, 500);
    const offset = Math.max(parseInt(req.query.offset) || 0, 0);
    const conditions = [];
    const params = [];
    let paramIdx = 1;

    if (source) {
      conditions.push(`document_source = $${paramIdx++}`);
      params.push(source);
    }

    if (q) {
      conditions.push(`(name ILIKE $${paramIdx} OR desc_text ILIKE $${paramIdx})`);
      paramIdx++;
      params.push(`%${q}%`);
    }

    if (category) {
      conditions.push(`category_key = $${paramIdx++}`);
      params.push(category);
    }

    if (rarity) {
      conditions.push(`rarity_key = $${paramIdx++}`);
      params.push(rarity);
    }

    let countSql = 'SELECT COUNT(*) FROM srd_items';
    let sql = 'SELECT * FROM srd_items';
    const whereClause = conditions.length > 0 ? ' WHERE ' + conditions.join(' AND ') : '';
    countSql += whereClause;
    sql += whereClause;
    sql += ` ORDER BY name ASC LIMIT $${paramIdx++} OFFSET $${paramIdx++}`;
    params.push(limit, offset);

    const [countResult, result] = await Promise.all([
      dbQuery(countSql, params.slice(0, -2), { label: 'srd.items.count' }),
      dbQuery(sql, params, { label: 'srd.items.list' }),
    ]);

    res.json({
      items: result.rows,
      total: parseInt(countResult.rows[0].count),
      limit,
      offset,
    });
  } catch (error) {
    logError('SRD items list failed', error);
    res.status(500).json({ error: 'Failed to fetch items' });
  }
});

// GET /api/srd/compendium/search — Unified search across items + spells (for LLM and browser)
router.get('/compendium/search', async (req, res) => {
  try {
    const { q, type } = req.query;
    const limit = Math.min(parseInt(req.query.limit) || 20, 50);

    if (!q || typeof q !== 'string' || q.trim().length === 0) {
      return res.status(400).json({ error: 'Query parameter "q" is required' });
    }

    const searchTerm = `%${q.trim()}%`;
    const results = [];

    if (!type || type === 'spell' || type === 'any') {
      const spellResult = await dbQuery(
        `SELECT key, name, level, school_key, casting_time, range_text, duration, concentration,
                damage_roll, damage_types, saving_throw_ability, desc_text
           FROM srd_spells
          WHERE name ILIKE $1 OR desc_text ILIKE $1
          ORDER BY CASE WHEN name ILIKE $2 THEN 0 ELSE 1 END, level ASC, name ASC
          LIMIT $3`,
        [searchTerm, `${q.trim()}%`, limit],
        { label: 'srd.compendium.search.spells' },
      );
      for (const row of spellResult.rows) {
        const parts = [`Level ${row.level} ${row.school_key || 'spell'}`];
        if (row.damage_roll) parts.push(`${row.damage_roll} ${(row.damage_types || []).join('/')} damage`);
        if (row.saving_throw_ability) parts.push(`${row.saving_throw_ability} save`);
        if (row.concentration) parts.push('concentration');
        results.push({
          type: 'spell',
          key: row.key,
          name: row.name,
          summary: parts.join('. ') + '.',
          cost_gp: null,
          level: row.level,
        });
      }
    }

    if (!type || type === 'item' || type === 'any') {
      const itemResult = await dbQuery(
        `SELECT key, name, category_key, rarity_key, cost, weight, requires_attunement, desc_text
           FROM srd_items
          WHERE name ILIKE $1 OR desc_text ILIKE $1
          ORDER BY CASE WHEN name ILIKE $2 THEN 0 ELSE 1 END, name ASC
          LIMIT $3`,
        [searchTerm, `${q.trim()}%`, limit],
        { label: 'srd.compendium.search.items' },
      );
      for (const row of itemResult.rows) {
        const parts = [];
        if (row.rarity_key && row.rarity_key !== 'common') parts.push(row.rarity_key);
        if (row.category_key) parts.push(row.category_key.replace(/-/g, ' '));
        if (row.weight) parts.push(`${row.weight} lb`);
        if (row.requires_attunement) parts.push('requires attunement');
        results.push({
          type: 'item',
          key: row.key,
          name: row.name,
          summary: parts.join('. ') + (parts.length ? '.' : ''),
          cost_gp: row.cost ? parseFloat(row.cost) : null,
          level: null,
        });
      }
    }

    // Sort: exact name matches first, then alphabetical
    results.sort((a, b) => {
      const aExact = a.name.toLowerCase() === q.trim().toLowerCase() ? 0 : 1;
      const bExact = b.name.toLowerCase() === q.trim().toLowerCase() ? 0 : 1;
      if (aExact !== bExact) return aExact - bExact;
      return a.name.localeCompare(b.name);
    });

    res.json({ results: results.slice(0, limit) });
  } catch (error) {
    logError('SRD compendium search failed', error);
    res.status(500).json({ error: 'Failed to search compendium' });
  }
});

// GET /api/srd/feats
router.get('/feats', async (req, res) => {
  try {
    const { type, source } = req.query;
    const conditions = [];
    const params = [];
    let paramIdx = 1;

    if (source) {
      conditions.push(`document_source = $${paramIdx++}`);
      params.push(source);
    }

    if (type) {
      conditions.push(`feat_type = $${paramIdx++}`);
      params.push(type);
    }

    let sql = 'SELECT * FROM srd_feats';
    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ');
    }
    sql += ' ORDER BY name ASC';

    const result = await dbQuery(sql, params, { label: 'srd.feats.list' });
    res.json({ feats: result.rows });
  } catch (error) {
    logError('SRD feats list failed', error);
    res.status(500).json({ error: 'Failed to fetch feats' });
  }
});

// GET /api/srd/conditions
router.get('/conditions', async (req, res) => {
  try {
    const result = await dbQuery('SELECT * FROM srd_conditions ORDER BY name ASC', [], { label: 'srd.conditions.list' });
    res.json({ conditions: result.rows });
  } catch (error) {
    logError('SRD conditions list failed', error);
    res.status(500).json({ error: 'Failed to fetch conditions' });
  }
});

// POST /api/srd/compute-stats
router.post('/compute-stats', async (req, res) => {
  try {
    const {
      speciesKey, classKey, backgroundKey,
      level, baseAbilities, abilityScoreMethod,
      chosenSkills, chosenLanguages, documentSource,
    } = req.body;

    const source = documentSource || 'srd-2024';

    if (!baseAbilities || !level) {
      return res.status(400).json({ error: 'baseAbilities and level are required' });
    }

    // Fetch class info for hit dice and caster type
    let hitDice = 'd8';
    let casterType = 'NONE';
    let savingThrowProficiencies = [];

    if (classKey) {
      const classResult = await dbQuery(
        `SELECT c.hit_dice, c.caster_type,
          (SELECT array_agg(st.ability_key) FROM srd_class_saving_throws st WHERE st.class_key = c.key AND st.document_source = c.document_source) AS save_profs
         FROM srd_classes c WHERE c.key = $1 AND c.document_source = $2`,
        [classKey, source],
        { label: 'srd.compute.class' },
      );

      // Fallback to any source
      const row = classResult.rows.length > 0
        ? classResult.rows[0]
        : (await dbQuery(
            `SELECT c.hit_dice, c.caster_type,
              (SELECT array_agg(st.ability_key) FROM srd_class_saving_throws st WHERE st.class_key = c.key AND st.document_source = c.document_source) AS save_profs
             FROM srd_classes c WHERE c.key = $1 ORDER BY CASE WHEN c.document_source = 'srd-2024' THEN 0 WHEN c.document_source = 'srd-2014' THEN 1 ELSE 2 END LIMIT 1`,
            [classKey],
            { label: 'srd.compute.class.fallback' },
          )).rows[0];

      if (row) {
        hitDice = row.hit_dice || 'd8';
        casterType = row.caster_type || 'NONE';
        savingThrowProficiencies = row.save_profs || [];
      }
    }

    // Fetch species racial bonuses from traits
    let racialBonuses = {};
    if (speciesKey) {
      const speciesResult = await dbQuery(
        'SELECT traits FROM srd_species WHERE key = $1 AND document_source = $2',
        [speciesKey, source],
        { label: 'srd.compute.species' },
      );

      const row = speciesResult.rows.length > 0
        ? speciesResult.rows[0]
        : (await dbQuery(
            `SELECT traits FROM srd_species WHERE key = $1 ORDER BY CASE WHEN document_source = 'srd-2024' THEN 0 WHEN document_source = 'srd-2014' THEN 1 ELSE 2 END LIMIT 1`,
            [speciesKey],
            { label: 'srd.compute.species.fallback' },
          )).rows[0];

      if (row) {
        const traits = row.traits || [];
        for (const trait of traits) {
          if (!trait.desc) continue;
          const abilityMatches = trait.desc.match(/\+(\d+)\s+(Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma)/gi);
          if (abilityMatches) {
            for (const match of abilityMatches) {
              const parts = match.match(/\+(\d+)\s+(\w+)/i);
              if (parts) {
                const bonus = parseInt(parts[1]);
                const ability = parts[2].toLowerCase();
                racialBonuses[ability] = (racialBonuses[ability] || 0) + bonus;
              }
            }
          }
        }
      }
    }

    // Map saving throw ability keys to full ability names
    const abilityKeyToName = {
      str: 'strength', dex: 'dexterity', con: 'constitution',
      int: 'intelligence', wis: 'wisdom', cha: 'charisma',
      strength: 'strength', dexterity: 'dexterity', constitution: 'constitution',
      intelligence: 'intelligence', wisdom: 'wisdom', charisma: 'charisma',
    };

    const normalizedSaveProfs = savingThrowProficiencies
      .map(k => abilityKeyToName[k.toLowerCase()])
      .filter(Boolean);

    const stats = computeStats({
      baseAbilities,
      level,
      hitDice,
      casterType,
      classKey,
      savingThrowProficiencies: normalizedSaveProfs,
      skillProficiencies: chosenSkills || [],
      languages: chosenLanguages || ['Common'],
      racialBonuses,
    });

    res.json(stats);
  } catch (error) {
    logError('Stats computation failed', error);
    res.status(500).json({ error: 'Failed to compute stats' });
  }
});

export const registerSrdRoutes = (app) => {
  app.use('/api/srd', router);
};
