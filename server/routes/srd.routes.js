import { Router } from 'express';
import { query as dbQuery } from '../db/pool.js';
import { computeStats } from '../services/srd/stats-engine.js';
import { logError } from '../utils/logger.js';

const router = Router();

// GET /api/srd/species
router.get('/species', async (req, res) => {
  try {
    const { source } = req.query;
    let sql = 'SELECT * FROM srd_species';
    const params = [];

    if (source) {
      sql += ' WHERE source_key = $1';
      params.push(source);
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
    const result = await dbQuery(
      `SELECT s.*,
        (SELECT json_agg(sub.*) FROM srd_species sub WHERE sub.subspecies_of_key = s.key) AS subspecies
       FROM srd_species s WHERE s.key = $1`,
      [req.params.key],
      { label: 'srd.species.get' },
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Species not found' });
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
    let sql = 'SELECT * FROM srd_classes';
    const params = [];

    if (source) {
      sql += ' WHERE source_key = $1';
      params.push(source);
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
    const result = await dbQuery(
      `SELECT c.*,
        (SELECT json_agg(row_to_json(st)) FROM srd_class_saving_throws st WHERE st.class_key = c.key) AS saving_throws_list,
        (SELECT json_agg(row_to_json(pa)) FROM srd_class_primary_abilities pa WHERE pa.class_key = c.key) AS primary_abilities_list,
        (SELECT json_agg(sub.*) FROM srd_classes sub WHERE sub.subclass_of_key = c.key) AS subclasses
       FROM srd_classes c WHERE c.key = $1`,
      [req.params.key],
      { label: 'srd.classes.get' },
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Class not found' });
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
    let sql = 'SELECT * FROM srd_backgrounds';
    const params = [];

    if (source) {
      sql += ' WHERE source_key = $1';
      params.push(source);
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
    const result = await dbQuery(
      'SELECT * FROM srd_backgrounds WHERE key = $1',
      [req.params.key],
      { label: 'srd.backgrounds.get' },
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Background not found' });
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
    const { source, level, ritual } = req.query;
    const classFilter = req.query.class;
    const conditions = [];
    const params = [];
    let paramIdx = 1;

    if (source) {
      conditions.push(`s.source_key = $${paramIdx++}`);
      params.push(source);
    }

    if (level !== undefined) {
      conditions.push(`s.level = $${paramIdx++}`);
      params.push(parseInt(level));
    }

    if (ritual !== undefined) {
      conditions.push(`s.ritual = $${paramIdx++}`);
      params.push(ritual === 'true');
    }

    if (classFilter) {
      conditions.push(`EXISTS (SELECT 1 FROM srd_spell_classes sc WHERE sc.spell_key = s.key AND sc.class_key = $${paramIdx++})`);
      params.push(classFilter);
    }

    let sql = 'SELECT s.* FROM srd_spells s';
    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ');
    }
    sql += ' ORDER BY s.level ASC, s.name ASC';

    const result = await dbQuery(sql, params, { label: 'srd.spells.list' });
    res.json({ spells: result.rows });
  } catch (error) {
    logError('SRD spells list failed', error);
    res.status(500).json({ error: 'Failed to fetch spells' });
  }
});

// GET /api/srd/spells/:key
router.get('/spells/:key', async (req, res) => {
  try {
    const result = await dbQuery(
      `SELECT s.*,
        (SELECT json_agg(sc.class_key) FROM srd_spell_classes sc WHERE sc.spell_key = s.key) AS class_keys
       FROM srd_spells s WHERE s.key = $1`,
      [req.params.key],
      { label: 'srd.spells.get' },
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Spell not found' });
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
    const { source, category } = req.query;
    const conditions = [];
    const params = [];
    let paramIdx = 1;

    if (source) {
      conditions.push(`source_key = $${paramIdx++}`);
      params.push(source);
    }

    if (category) {
      conditions.push(`category_key = $${paramIdx++}`);
      params.push(category);
    }

    let sql = 'SELECT * FROM srd_items';
    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ');
    }
    sql += ' ORDER BY name ASC';

    const result = await dbQuery(sql, params, { label: 'srd.items.list' });
    res.json({ items: result.rows });
  } catch (error) {
    logError('SRD items list failed', error);
    res.status(500).json({ error: 'Failed to fetch items' });
  }
});

// GET /api/srd/feats
router.get('/feats', async (req, res) => {
  try {
    const { source, type } = req.query;
    const conditions = [];
    const params = [];
    let paramIdx = 1;

    if (source) {
      conditions.push(`source_key = $${paramIdx++}`);
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
      chosenSkills, chosenLanguages,
    } = req.body;

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
          (SELECT array_agg(st.ability_key) FROM srd_class_saving_throws st WHERE st.class_key = c.key) AS save_profs
         FROM srd_classes c WHERE c.key = $1`,
        [classKey],
        { label: 'srd.compute.class' },
      );

      if (classResult.rows.length > 0) {
        const cls = classResult.rows[0];
        hitDice = cls.hit_dice || 'd8';
        casterType = cls.caster_type || 'NONE';
        savingThrowProficiencies = cls.save_profs || [];
      }
    }

    // Fetch species racial bonuses from traits
    let racialBonuses = {};
    if (speciesKey) {
      const speciesResult = await dbQuery(
        'SELECT traits FROM srd_species WHERE key = $1',
        [speciesKey],
        { label: 'srd.compute.species' },
      );

      if (speciesResult.rows.length > 0) {
        const traits = speciesResult.rows[0].traits || [];
        // Parse ability score bonuses from trait descriptions
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
