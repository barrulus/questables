/**
 * Open5e SRD Data Import Script
 *
 * Imports D&D 5e SRD reference data from the Open5e v2 API into PostgreSQL.
 * Usage: node server/scripts/import-srd-data.js [--api-url URL] [--documents srd-2014,srd-2024]
 */

import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load env files
for (const f of [
  join(__dirname, '..', '.env.local'),
  join(__dirname, '..', '.env'),
  join(__dirname, '..', '..', '.env.local'),
  join(__dirname, '..', '..', '.env'),
]) {
  if (existsSync(f)) dotenv.config({ path: f, override: true });
}

import { Pool } from 'pg';

// Parse CLI arguments
const args = process.argv.slice(2);
const getArg = (flag) => {
  const idx = args.indexOf(flag);
  return idx >= 0 && idx + 1 < args.length ? args[idx + 1] : null;
};

const API_BASE = getArg('--api-url') || 'https://api.open5e.com';
const DOCUMENTS = (getArg('--documents') || 'srd-2014,srd-2024').split(',').map(d => d.trim());
const PAGE_SIZE = 50;
const RETRY_DELAY = 200;
const MAX_RETRIES = 3;

const pool = new Pool({
  host: process.env.DATABASE_HOST,
  port: parseInt(process.env.DATABASE_PORT || '5432'),
  database: process.env.DATABASE_NAME || process.env.PGDATABASE,
  user: process.env.DATABASE_USER || process.env.PGUSER,
  password: process.env.DATABASE_PASSWORD,
  ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false,
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchPage(url, retries = MAX_RETRIES) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const resp = await fetch(url);
      if (resp.status === 429) {
        const wait = RETRY_DELAY * Math.pow(2, attempt);
        console.warn(`  Rate limited, waiting ${wait}ms...`);
        await sleep(wait);
        continue;
      }
      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status}: ${resp.statusText} for ${url}`);
      }
      return resp.json();
    } catch (err) {
      if (attempt === retries) throw err;
      await sleep(RETRY_DELAY * attempt);
    }
  }
}

async function fetchAllPages(endpoint, params = {}) {
  const all = [];
  const qs = new URLSearchParams({ format: 'json', limit: String(PAGE_SIZE), ...params });
  let url = `${API_BASE}/v2/${endpoint}/?${qs}`;

  while (url) {
    const data = await fetchPage(url);
    if (data.results) {
      all.push(...data.results);
    }
    url = data.next || null;
    if (url) await sleep(RETRY_DELAY);
  }

  return all;
}

function filterByDocuments(items) {
  return items.filter(item => {
    const docKey = item.document?.key;
    return docKey && DOCUMENTS.includes(docKey);
  });
}

function getSourceKey(item) {
  return item.document?.key || null;
}

// =============================================================================
// PHASE 0: Lookup tables
// =============================================================================

async function importAbilities(client) {
  // Seed the 6 standard abilities - these are used as FK targets
  const abilities = [
    { key: 'str', name: 'Strength', desc: 'Strength measures physical power.' },
    { key: 'dex', name: 'Dexterity', desc: 'Dexterity measures agility.' },
    { key: 'con', name: 'Constitution', desc: 'Constitution measures endurance.' },
    { key: 'int', name: 'Intelligence', desc: 'Intelligence measures reasoning and memory.' },
    { key: 'wis', name: 'Wisdom', desc: 'Wisdom measures perception and insight.' },
    { key: 'cha', name: 'Charisma', desc: 'Charisma measures force of personality.' },
  ];

  // Also try from API
  try {
    const apiAbilities = await fetchAllPages('abilities');
    const filtered = filterByDocuments(apiAbilities);
    for (const a of filtered) {
      const existing = abilities.find(ab => ab.name.toLowerCase() === a.name.toLowerCase());
      if (!existing) {
        abilities.push({ key: a.key, name: a.name, desc: a.desc || '', source_key: getSourceKey(a) });
      }
    }
  } catch (e) {
    console.warn('  Could not fetch abilities from API, using defaults');
  }

  for (const a of abilities) {
    await client.query(
      `INSERT INTO srd_abilities (key, name, desc_text, source_key)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (key) DO UPDATE SET name = EXCLUDED.name, desc_text = EXCLUDED.desc_text`,
      [a.key, a.name, a.desc || '', a.source_key || null],
    );
  }
  console.log(`  Abilities: ${abilities.length}`);
}

async function importDamageTypes(client) {
  const items = filterByDocuments(await fetchAllPages('damagetypes'));
  for (const item of items) {
    await client.query(
      `INSERT INTO srd_damage_types (key, name, desc_text, source_key)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (key) DO UPDATE SET name = EXCLUDED.name, desc_text = EXCLUDED.desc_text`,
      [item.key, item.name, item.desc || '', getSourceKey(item)],
    );
  }
  console.log(`  Damage types: ${items.length}`);
}

async function importSpellSchools(client) {
  const items = filterByDocuments(await fetchAllPages('spellschools'));
  for (const item of items) {
    await client.query(
      `INSERT INTO srd_spell_schools (key, name, desc_text, source_key)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (key) DO UPDATE SET name = EXCLUDED.name, desc_text = EXCLUDED.desc_text`,
      [item.key, item.name, item.desc || '', getSourceKey(item)],
    );
  }
  console.log(`  Spell schools: ${items.length}`);
}

async function importConditions(client) {
  const items = filterByDocuments(await fetchAllPages('conditions'));
  for (const item of items) {
    await client.query(
      `INSERT INTO srd_conditions (key, name, descriptions, source_key)
       VALUES ($1, $2, $3::jsonb, $4)
       ON CONFLICT (key) DO UPDATE SET name = EXCLUDED.name, descriptions = EXCLUDED.descriptions`,
      [item.key, item.name, JSON.stringify(item.desc || ''), getSourceKey(item)],
    );
  }
  console.log(`  Conditions: ${items.length}`);
}

async function importSizes(client) {
  const items = filterByDocuments(await fetchAllPages('sizes'));
  const sizeRanks = { tiny: 1, small: 2, medium: 3, large: 4, huge: 5, gargantuan: 6 };
  const spaceDiameters = { tiny: 2.5, small: 5, medium: 5, large: 10, huge: 15, gargantuan: 20 };
  for (const item of items) {
    const nameLower = item.name.toLowerCase();
    await client.query(
      `INSERT INTO srd_sizes (key, name, rank, space_diameter, source_key)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (key) DO UPDATE SET name = EXCLUDED.name, rank = EXCLUDED.rank, space_diameter = EXCLUDED.space_diameter`,
      [item.key, item.name, sizeRanks[nameLower] || 0, spaceDiameters[nameLower] || 5, getSourceKey(item)],
    );
  }
  console.log(`  Sizes: ${items.length}`);
}

async function importLanguages(client) {
  const items = filterByDocuments(await fetchAllPages('languages'));
  const exoticLanguages = new Set([
    'abyssal', 'celestial', 'deep speech', 'draconic', 'infernal',
    'primordial', 'sylvan', 'undercommon',
  ]);
  for (const item of items) {
    await client.query(
      `INSERT INTO srd_languages (key, name, is_exotic, source_key)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (key) DO UPDATE SET name = EXCLUDED.name, is_exotic = EXCLUDED.is_exotic`,
      [item.key, item.name, exoticLanguages.has(item.name.toLowerCase()), getSourceKey(item)],
    );
  }
  console.log(`  Languages: ${items.length}`);
}

async function importAlignments(client) {
  const items = filterByDocuments(await fetchAllPages('alignments'));
  for (const item of items) {
    await client.query(
      `INSERT INTO srd_alignments (key, name, source_key)
       VALUES ($1, $2, $3)
       ON CONFLICT (key) DO UPDATE SET name = EXCLUDED.name`,
      [item.key, item.name, getSourceKey(item)],
    );
  }
  console.log(`  Alignments: ${items.length}`);
}

async function importItemCategories(client) {
  const items = filterByDocuments(await fetchAllPages('itemcategories'));
  for (const item of items) {
    await client.query(
      `INSERT INTO srd_item_categories (key, name, source_key)
       VALUES ($1, $2, $3)
       ON CONFLICT (key) DO UPDATE SET name = EXCLUDED.name`,
      [item.key, item.name, getSourceKey(item)],
    );
  }
  console.log(`  Item categories: ${items.length}`);
}

async function importItemRarities(client) {
  const items = filterByDocuments(await fetchAllPages('itemrarities'));
  const rarityRanks = { common: 1, uncommon: 2, rare: 3, 'very rare': 4, legendary: 5, artifact: 6 };
  for (const item of items) {
    await client.query(
      `INSERT INTO srd_item_rarities (key, name, rank, source_key)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (key) DO UPDATE SET name = EXCLUDED.name, rank = EXCLUDED.rank`,
      [item.key, item.name, rarityRanks[item.name.toLowerCase()] || 0, getSourceKey(item)],
    );
  }
  console.log(`  Item rarities: ${items.length}`);
}

async function importWeaponProperties(client) {
  const items = filterByDocuments(await fetchAllPages('weaponproperties'));
  for (const item of items) {
    await client.query(
      `INSERT INTO srd_weapon_properties (key, name, desc_text, source_key)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (key) DO UPDATE SET name = EXCLUDED.name, desc_text = EXCLUDED.desc_text`,
      [item.key, item.name, item.desc || '', getSourceKey(item)],
    );
  }
  console.log(`  Weapon properties: ${items.length}`);
}

// =============================================================================
// PHASE 1: Entity tables
// =============================================================================

async function importClasses(client) {
  const items = filterByDocuments(await fetchAllPages('classes'));
  for (const item of items) {
    const subclassOfKey = item.subclass_of?.key || null;
    const features = Array.isArray(item.features) ? item.features.map(f => ({
      key: f.key,
      name: f.name,
      desc: f.desc,
      feature_type: f.feature_type,
      gained_at: f.gained_at,
    })) : [];

    await client.query(
      `INSERT INTO srd_classes (key, name, desc_text, hit_dice, caster_type, subclass_of_key, features, source_key)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)
       ON CONFLICT (key) DO UPDATE SET
         name = EXCLUDED.name, desc_text = EXCLUDED.desc_text, hit_dice = EXCLUDED.hit_dice,
         caster_type = EXCLUDED.caster_type, subclass_of_key = EXCLUDED.subclass_of_key,
         features = EXCLUDED.features, source_key = EXCLUDED.source_key`,
      [
        item.key, item.name, item.desc || '', item.hit_dice || null,
        (item.caster_type || 'NONE').toUpperCase(),
        subclassOfKey,
        JSON.stringify(features),
        getSourceKey(item),
      ],
    );
  }
  console.log(`  Classes: ${items.length}`);
  return items;
}

async function importSpecies(client) {
  const items = filterByDocuments(await fetchAllPages('species'));
  for (const item of items) {
    const subspeciesOfKey = item.subspecies_of
      ? (typeof item.subspecies_of === 'string'
          ? item.subspecies_of.split('/').filter(Boolean).pop() || null
          : item.subspecies_of.key || null)
      : null;

    const traits = Array.isArray(item.traits) ? item.traits.map(t => ({
      name: t.name,
      desc: t.desc,
      type: t.type || null,
    })) : [];

    await client.query(
      `INSERT INTO srd_species (key, name, desc_text, is_subspecies, subspecies_of_key, traits, source_key)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)
       ON CONFLICT (key) DO UPDATE SET
         name = EXCLUDED.name, desc_text = EXCLUDED.desc_text, is_subspecies = EXCLUDED.is_subspecies,
         subspecies_of_key = EXCLUDED.subspecies_of_key, traits = EXCLUDED.traits, source_key = EXCLUDED.source_key`,
      [
        item.key, item.name, item.desc || '', item.is_subspecies || false,
        subspeciesOfKey, JSON.stringify(traits), getSourceKey(item),
      ],
    );
  }
  console.log(`  Species: ${items.length}`);
}

async function importBackgrounds(client) {
  const items = filterByDocuments(await fetchAllPages('backgrounds'));
  for (const item of items) {
    const benefits = Array.isArray(item.benefits) ? item.benefits.map(b => ({
      name: b.name,
      desc: b.desc,
      type: b.type || null,
    })) : [];

    await client.query(
      `INSERT INTO srd_backgrounds (key, name, desc_text, benefits, source_key)
       VALUES ($1, $2, $3, $4::jsonb, $5)
       ON CONFLICT (key) DO UPDATE SET
         name = EXCLUDED.name, desc_text = EXCLUDED.desc_text, benefits = EXCLUDED.benefits, source_key = EXCLUDED.source_key`,
      [item.key, item.name, item.desc || '', JSON.stringify(benefits), getSourceKey(item)],
    );
  }
  console.log(`  Backgrounds: ${items.length}`);
}

async function importFeats(client) {
  const items = filterByDocuments(await fetchAllPages('feats'));
  for (const item of items) {
    const benefits = Array.isArray(item.benefits) ? item.benefits : [];
    await client.query(
      `INSERT INTO srd_feats (key, name, desc_text, feat_type, prerequisite, benefits, source_key)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)
       ON CONFLICT (key) DO UPDATE SET
         name = EXCLUDED.name, desc_text = EXCLUDED.desc_text, feat_type = EXCLUDED.feat_type,
         prerequisite = EXCLUDED.prerequisite, benefits = EXCLUDED.benefits, source_key = EXCLUDED.source_key`,
      [
        item.key, item.name, item.desc || '', item.type || null,
        item.prerequisite || null, JSON.stringify(benefits), getSourceKey(item),
      ],
    );
  }
  console.log(`  Feats: ${items.length}`);
}

// =============================================================================
// PHASE 2: Items, Spells + junction tables
// =============================================================================

async function importItems(client) {
  const items = filterByDocuments(await fetchAllPages('items'));
  for (const item of items) {
    // Ensure category exists
    if (item.category?.key) {
      await client.query(
        `INSERT INTO srd_item_categories (key, name)
         VALUES ($1, $2)
         ON CONFLICT (key) DO NOTHING`,
        [item.category.key, item.category.name || item.category.key],
      );
    }
    // Ensure rarity exists
    if (item.rarity?.key) {
      await client.query(
        `INSERT INTO srd_item_rarities (key, name)
         VALUES ($1, $2)
         ON CONFLICT (key) DO NOTHING`,
        [item.rarity.key, item.rarity.name || item.rarity.key],
      );
    }

    await client.query(
      `INSERT INTO srd_items (key, name, desc_text, category_key, rarity_key, cost, weight, weight_unit, requires_attunement, source_key)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (key) DO UPDATE SET
         name = EXCLUDED.name, desc_text = EXCLUDED.desc_text, category_key = EXCLUDED.category_key,
         rarity_key = EXCLUDED.rarity_key, cost = EXCLUDED.cost, weight = EXCLUDED.weight,
         weight_unit = EXCLUDED.weight_unit, requires_attunement = EXCLUDED.requires_attunement, source_key = EXCLUDED.source_key`,
      [
        item.key, item.name, item.desc || '',
        item.category?.key || null, item.rarity?.key || null,
        item.cost || null, item.weight || null, item.weight_unit || 'lb',
        item.requires_attunement || false, getSourceKey(item),
      ],
    );
  }
  console.log(`  Items: ${items.length}`);
}

async function importSpells(client) {
  const items = filterByDocuments(await fetchAllPages('spells'));
  for (const item of items) {
    // Ensure school exists
    if (item.school?.key) {
      await client.query(
        `INSERT INTO srd_spell_schools (key, name)
         VALUES ($1, $2)
         ON CONFLICT (key) DO NOTHING`,
        [item.school.key, item.school.name || item.school.key],
      );
    }

    const damageTypes = Array.isArray(item.damage_types) ? item.damage_types.map(dt => dt.key || dt.name || dt) : [];

    await client.query(
      `INSERT INTO srd_spells (key, name, desc_text, level, school_key, casting_time, range_text, range, duration,
        concentration, ritual, verbal, somatic, material, material_specified, damage_roll, damage_types,
        saving_throw_ability, attack_roll, source_key)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17::jsonb,$18,$19,$20)
       ON CONFLICT (key) DO UPDATE SET
         name=EXCLUDED.name, desc_text=EXCLUDED.desc_text, level=EXCLUDED.level, school_key=EXCLUDED.school_key,
         casting_time=EXCLUDED.casting_time, range_text=EXCLUDED.range_text, range=EXCLUDED.range,
         duration=EXCLUDED.duration, concentration=EXCLUDED.concentration, ritual=EXCLUDED.ritual,
         verbal=EXCLUDED.verbal, somatic=EXCLUDED.somatic, material=EXCLUDED.material,
         material_specified=EXCLUDED.material_specified, damage_roll=EXCLUDED.damage_roll,
         damage_types=EXCLUDED.damage_types, saving_throw_ability=EXCLUDED.saving_throw_ability,
         attack_roll=EXCLUDED.attack_roll, source_key=EXCLUDED.source_key`,
      [
        item.key, item.name, item.desc || '', item.level ?? 0,
        item.school?.key || null, item.casting_time || null, item.range_text || null,
        item.range || null, item.duration || null,
        item.concentration || false, item.ritual || false,
        item.verbal || false, item.somatic || false, item.material || false,
        item.material_specified || null, item.damage_roll || null,
        JSON.stringify(damageTypes),
        item.saving_throw_ability || null, item.attack_roll || false,
        getSourceKey(item),
      ],
    );
  }
  console.log(`  Spells: ${items.length}`);
  return items;
}

async function importClassJunctions(client, classes) {
  let savingThrowCount = 0;
  let primaryAbilityCount = 0;

  // Map ability names to keys
  const abilityNameToKey = {
    strength: 'str', dexterity: 'dex', constitution: 'con',
    intelligence: 'int', wisdom: 'wis', charisma: 'cha',
    str: 'str', dex: 'dex', con: 'con', int: 'int', wis: 'wis', cha: 'cha',
  };

  for (const cls of classes) {
    // Saving throws
    if (Array.isArray(cls.saving_throws)) {
      await client.query('DELETE FROM srd_class_saving_throws WHERE class_key = $1', [cls.key]);
      for (const st of cls.saving_throws) {
        const abilityKey = typeof st === 'string'
          ? abilityNameToKey[st.toLowerCase()]
          : abilityNameToKey[(st.key || st.name || '').toLowerCase()];
        if (abilityKey) {
          await client.query(
            `INSERT INTO srd_class_saving_throws (class_key, ability_key) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
            [cls.key, abilityKey],
          );
          savingThrowCount++;
        }
      }
    }

    // Primary abilities
    if (Array.isArray(cls.primary_abilities)) {
      await client.query('DELETE FROM srd_class_primary_abilities WHERE class_key = $1', [cls.key]);
      for (const pa of cls.primary_abilities) {
        const abilityKey = typeof pa === 'string'
          ? abilityNameToKey[pa.toLowerCase()]
          : abilityNameToKey[(pa.key || pa.name || '').toLowerCase()];
        if (abilityKey) {
          await client.query(
            `INSERT INTO srd_class_primary_abilities (class_key, ability_key) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
            [cls.key, abilityKey],
          );
          primaryAbilityCount++;
        }
      }
    }
  }
  console.log(`  Class saving throws: ${savingThrowCount}, primary abilities: ${primaryAbilityCount}`);
}

// =============================================================================
// PHASE 3: Weapons, Armor, Spell-class junctions
// =============================================================================

async function importWeapons(client) {
  const items = filterByDocuments(await fetchAllPages('weapons'));
  for (const item of items) {
    // Ensure damage type exists
    if (item.damage_type?.key) {
      await client.query(
        `INSERT INTO srd_damage_types (key, name)
         VALUES ($1, $2)
         ON CONFLICT (key) DO NOTHING`,
        [item.damage_type.key, item.damage_type.name || item.damage_type.key],
      );
    }

    const properties = Array.isArray(item.properties) ? item.properties.map(p => ({
      key: p.property?.key || p.key,
      name: p.property?.name || p.name,
      detail: p.detail || null,
    })) : [];

    // Try to find matching item key
    const itemKey = item.key ? item.key.replace(/_weapon$/, '') : null;

    await client.query(
      `INSERT INTO srd_weapons (key, name, item_key, damage_dice, damage_type_key, range, long_range, is_simple, properties, source_key)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10)
       ON CONFLICT (key) DO UPDATE SET
         name=EXCLUDED.name, item_key=EXCLUDED.item_key, damage_dice=EXCLUDED.damage_dice,
         damage_type_key=EXCLUDED.damage_type_key, range=EXCLUDED.range, long_range=EXCLUDED.long_range,
         is_simple=EXCLUDED.is_simple, properties=EXCLUDED.properties, source_key=EXCLUDED.source_key`,
      [
        item.key, item.name, null,
        item.damage_dice || null, item.damage_type?.key || null,
        item.range ? parseInt(item.range) || null : null,
        item.long_range ? parseInt(item.long_range) || null : null,
        item.is_simple ?? true,
        JSON.stringify(properties),
        getSourceKey(item),
      ],
    );
  }
  console.log(`  Weapons: ${items.length}`);
}

async function importArmor(client) {
  const items = filterByDocuments(await fetchAllPages('armor'));
  for (const item of items) {
    await client.query(
      `INSERT INTO srd_armor (key, name, item_key, ac_base, ac_add_dexmod, ac_cap_dexmod, category, grants_stealth_disadvantage, strength_score_required, source_key)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (key) DO UPDATE SET
         name=EXCLUDED.name, item_key=EXCLUDED.item_key, ac_base=EXCLUDED.ac_base,
         ac_add_dexmod=EXCLUDED.ac_add_dexmod, ac_cap_dexmod=EXCLUDED.ac_cap_dexmod,
         category=EXCLUDED.category, grants_stealth_disadvantage=EXCLUDED.grants_stealth_disadvantage,
         strength_score_required=EXCLUDED.strength_score_required, source_key=EXCLUDED.source_key`,
      [
        item.key, item.name, null,
        item.ac_base || null, item.ac_add_dexmod || false, item.ac_cap_dexmod || null,
        item.category || null, item.grants_stealth_disadvantage || false,
        item.strength_score_required || null, getSourceKey(item),
      ],
    );
  }
  console.log(`  Armor: ${items.length}`);
}

async function importSpellClassJunctions(client, spells) {
  let count = 0;
  for (const spell of spells) {
    if (!Array.isArray(spell.classes)) continue;

    await client.query('DELETE FROM srd_spell_classes WHERE spell_key = $1', [spell.key]);

    for (const cls of spell.classes) {
      const classKey = typeof cls === 'string' ? cls : cls.key;
      if (!classKey) continue;

      // Only insert if the class exists
      const classExists = await client.query('SELECT 1 FROM srd_classes WHERE key = $1', [classKey]);
      if (classExists.rows.length > 0) {
        await client.query(
          `INSERT INTO srd_spell_classes (spell_key, class_key) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
          [spell.key, classKey],
        );
        count++;
      }
    }
  }
  console.log(`  Spell-class junctions: ${count}`);
}

// =============================================================================
// Main execution
// =============================================================================

async function main() {
  console.log('=== Open5e SRD Data Import ===');
  console.log(`API: ${API_BASE}`);
  console.log(`Documents: ${DOCUMENTS.join(', ')}`);
  console.log('');

  const client = await pool.connect();

  try {
    // Phase 0: Lookup tables
    console.log('Phase 0: Importing lookup tables...');
    await client.query('BEGIN');
    await importAbilities(client);
    await importDamageTypes(client);
    await importSpellSchools(client);
    await importConditions(client);
    await importSizes(client);
    await importLanguages(client);
    await importAlignments(client);
    await importItemCategories(client);
    await importItemRarities(client);
    await importWeaponProperties(client);
    await client.query('COMMIT');
    console.log('Phase 0 complete.\n');

    // Phase 1: Entity tables
    console.log('Phase 1: Importing entity tables...');
    await client.query('BEGIN');
    const classes = await importClasses(client);
    await importSpecies(client);
    await importBackgrounds(client);
    await importFeats(client);
    await client.query('COMMIT');
    console.log('Phase 1 complete.\n');

    // Phase 2: Items, Spells, and class junctions
    console.log('Phase 2: Importing items, spells, and class junctions...');
    await client.query('BEGIN');
    await importItems(client);
    const spells = await importSpells(client);
    await importClassJunctions(client, classes);
    await client.query('COMMIT');
    console.log('Phase 2 complete.\n');

    // Phase 3: Weapons, Armor, spell-class junctions
    console.log('Phase 3: Importing weapons, armor, and spell-class junctions...');
    await client.query('BEGIN');
    await importWeapons(client);
    await importArmor(client);
    await importSpellClassJunctions(client, spells);
    await client.query('COMMIT');
    console.log('Phase 3 complete.\n');

    console.log('=== Import complete! ===');
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch (_) { /* ignore */ }
    console.error('Import failed:', error);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

main();
