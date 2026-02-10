/**
 * Open5e SRD Data Import Script — Per-Source Storage
 *
 * Fetches D&D 5e SRD reference data from the v2 Open5e API and stores
 * each source document as separate rows (no merging across sources).
 *
 * Usage: node server/scripts/import-srd-data.js [--api-url URL]
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
const V2_DOCUMENTS = ['srd-2014', 'srd-2024', 'a5e-ag'];
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

// =============================================================================
// Helpers
// =============================================================================

function slugify(name) {
  return name.toLowerCase().trim()
    .replace(/['']/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function docKey(item) {
  return item.document?.key || item.document_slug || null;
}

// =============================================================================
// API Fetching
// =============================================================================

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

async function fetchAllV2(endpoint, params = {}) {
  const all = [];
  const qs = new URLSearchParams({
    format: 'json',
    limit: String(PAGE_SIZE),
    document__key__in: V2_DOCUMENTS.join(','),
    ...params,
  });
  let url = `${API_BASE}/v2/${endpoint}/?${qs}`;

  while (url) {
    const data = await fetchPage(url);
    if (data.results) all.push(...data.results);
    url = data.next || null;
    if (url) await sleep(RETRY_DELAY);
  }
  return all;
}

// =============================================================================
// PHASE 1 — Lookup tables (deduplicated by name, no document_source)
// =============================================================================

async function importLookups(client, v2Data) {
  // Abilities — seed standard 6 plus any from API
  const abilities = [
    { key: 'str', name: 'Strength', desc: 'Strength measures physical power.' },
    { key: 'dex', name: 'Dexterity', desc: 'Dexterity measures agility.' },
    { key: 'con', name: 'Constitution', desc: 'Constitution measures endurance.' },
    { key: 'int', name: 'Intelligence', desc: 'Intelligence measures reasoning and memory.' },
    { key: 'wis', name: 'Wisdom', desc: 'Wisdom measures perception and insight.' },
    { key: 'cha', name: 'Charisma', desc: 'Charisma measures force of personality.' },
  ];
  for (const a of v2Data.abilities) {
    if (!abilities.find(ab => ab.name.toLowerCase() === a.name.toLowerCase())) {
      abilities.push({ key: a.key, name: a.name, desc: a.desc || '' });
    }
  }
  for (const a of abilities) {
    await client.query(
      `INSERT INTO srd_abilities (key, name, desc_text)
       VALUES ($1, $2, $3)
       ON CONFLICT (key) DO UPDATE SET name = EXCLUDED.name, desc_text = EXCLUDED.desc_text`,
      [a.key, a.name, a.desc || ''],
    );
  }
  console.log(`  Abilities: ${abilities.length}`);

  // Damage types — deduplicate by name
  const dtSeen = new Set();
  for (const item of v2Data.damageTypes) {
    const key = slugify(item.name);
    if (dtSeen.has(key)) continue;
    dtSeen.add(key);
    await client.query(
      `INSERT INTO srd_damage_types (key, name, desc_text)
       VALUES ($1, $2, $3)
       ON CONFLICT (key) DO UPDATE SET name = EXCLUDED.name, desc_text = EXCLUDED.desc_text`,
      [key, item.name, item.desc || ''],
    );
  }
  console.log(`  Damage types: ${dtSeen.size}`);

  // Spell schools
  const ssSeen = new Set();
  for (const item of v2Data.spellSchools) {
    const key = slugify(item.name);
    if (ssSeen.has(key)) continue;
    ssSeen.add(key);
    await client.query(
      `INSERT INTO srd_spell_schools (key, name, desc_text)
       VALUES ($1, $2, $3)
       ON CONFLICT (key) DO UPDATE SET name = EXCLUDED.name, desc_text = EXCLUDED.desc_text`,
      [key, item.name, item.desc || ''],
    );
  }
  console.log(`  Spell schools: ${ssSeen.size}`);

  // Conditions
  const condSeen = new Set();
  for (const item of v2Data.conditions) {
    const key = slugify(item.name);
    if (condSeen.has(key)) continue;
    condSeen.add(key);
    await client.query(
      `INSERT INTO srd_conditions (key, name, descriptions)
       VALUES ($1, $2, $3::jsonb)
       ON CONFLICT (key) DO UPDATE SET name = EXCLUDED.name, descriptions = EXCLUDED.descriptions`,
      [key, item.name, JSON.stringify(item.desc || '')],
    );
  }
  console.log(`  Conditions: ${condSeen.size}`);

  // Sizes
  const sizeRanks = { tiny: 1, small: 2, medium: 3, large: 4, huge: 5, gargantuan: 6 };
  const spaceDiameters = { tiny: 2.5, small: 5, medium: 5, large: 10, huge: 15, gargantuan: 20 };
  const sizeSeen = new Set();
  for (const item of v2Data.sizes) {
    const key = slugify(item.name);
    if (sizeSeen.has(key)) continue;
    sizeSeen.add(key);
    const nameLower = item.name.toLowerCase();
    await client.query(
      `INSERT INTO srd_sizes (key, name, rank, space_diameter)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (key) DO UPDATE SET name = EXCLUDED.name, rank = EXCLUDED.rank, space_diameter = EXCLUDED.space_diameter`,
      [key, item.name, sizeRanks[nameLower] || 0, spaceDiameters[nameLower] || 5],
    );
  }
  console.log(`  Sizes: ${sizeSeen.size}`);

  // Languages
  const exoticLanguages = new Set([
    'abyssal', 'celestial', 'deep speech', 'draconic', 'infernal',
    'primordial', 'sylvan', 'undercommon',
  ]);
  const langSeen = new Set();
  for (const item of v2Data.languages) {
    const key = slugify(item.name);
    if (langSeen.has(key)) continue;
    langSeen.add(key);
    await client.query(
      `INSERT INTO srd_languages (key, name, is_exotic)
       VALUES ($1, $2, $3)
       ON CONFLICT (key) DO UPDATE SET name = EXCLUDED.name, is_exotic = EXCLUDED.is_exotic`,
      [key, item.name, exoticLanguages.has(item.name.toLowerCase())],
    );
  }
  console.log(`  Languages: ${langSeen.size}`);

  // Alignments
  const alignSeen = new Set();
  for (const item of v2Data.alignments) {
    const key = slugify(item.name);
    if (alignSeen.has(key)) continue;
    alignSeen.add(key);
    await client.query(
      `INSERT INTO srd_alignments (key, name)
       VALUES ($1, $2)
       ON CONFLICT (key) DO UPDATE SET name = EXCLUDED.name`,
      [key, item.name],
    );
  }
  console.log(`  Alignments: ${alignSeen.size}`);

  // Item categories
  const catSeen = new Set();
  for (const item of v2Data.itemCategories) {
    const key = slugify(item.name);
    if (catSeen.has(key)) continue;
    catSeen.add(key);
    await client.query(
      `INSERT INTO srd_item_categories (key, name)
       VALUES ($1, $2)
       ON CONFLICT (key) DO UPDATE SET name = EXCLUDED.name`,
      [key, item.name],
    );
  }
  console.log(`  Item categories: ${catSeen.size}`);

  // Item rarities
  const rarityRanks = { common: 1, uncommon: 2, rare: 3, 'very rare': 4, legendary: 5, artifact: 6 };
  const rarSeen = new Set();
  for (const item of v2Data.itemRarities) {
    const key = slugify(item.name);
    if (rarSeen.has(key)) continue;
    rarSeen.add(key);
    await client.query(
      `INSERT INTO srd_item_rarities (key, name, rank)
       VALUES ($1, $2, $3)
       ON CONFLICT (key) DO UPDATE SET name = EXCLUDED.name, rank = EXCLUDED.rank`,
      [key, item.name, rarityRanks[item.name.toLowerCase()] || 0],
    );
  }
  console.log(`  Item rarities: ${rarSeen.size}`);

  // Weapon properties
  const wpSeen = new Set();
  for (const item of v2Data.weaponProperties) {
    const key = slugify(item.name);
    if (wpSeen.has(key)) continue;
    wpSeen.add(key);
    await client.query(
      `INSERT INTO srd_weapon_properties (key, name, desc_text)
       VALUES ($1, $2, $3)
       ON CONFLICT (key) DO UPDATE SET name = EXCLUDED.name, desc_text = EXCLUDED.desc_text`,
      [key, item.name, item.desc || ''],
    );
  }
  console.log(`  Weapon properties: ${wpSeen.size}`);
}

// =============================================================================
// PHASE 2 — Entity tables (per-source, no merging)
// =============================================================================

async function importSpecies(client, v2Species) {
  await client.query('DELETE FROM srd_species WHERE document_source != \'merged\'');

  // Insert parents first, then children
  const parents = v2Species.filter(s => !s.is_subspecies);
  const children = v2Species.filter(s => s.is_subspecies);
  let count = 0;

  for (const item of [...parents, ...children]) {
    const source = docKey(item);
    if (!source) continue;
    const key = slugify(item.name);

    const rawSubOf = item.subspecies_of;
    const subspeciesOfKey = rawSubOf
      ? (typeof rawSubOf === 'string'
          ? slugify(rawSubOf.split('/').filter(Boolean).pop() || '')
          : slugify(rawSubOf.name || rawSubOf.key || ''))
      : null;

    // Preserve all source-specific fields in traits
    const traits = Array.isArray(item.traits) ? item.traits.map(t => ({
      name: t.name,
      desc: t.desc,
      type: t.type || null,
      order: t.order ?? null,
    })) : [];

    await client.query(
      `INSERT INTO srd_species (key, name, desc_text, is_subspecies, subspecies_of_key, traits, document_source)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)
       ON CONFLICT (key, document_source) DO UPDATE SET
         name = EXCLUDED.name, desc_text = EXCLUDED.desc_text, is_subspecies = EXCLUDED.is_subspecies,
         subspecies_of_key = EXCLUDED.subspecies_of_key, traits = EXCLUDED.traits`,
      [key, item.name, item.desc || '', item.is_subspecies || false, subspeciesOfKey, JSON.stringify(traits), source],
    );
    count++;
  }
  console.log(`  Species: ${count}`);
}

async function importClasses(client, v2Classes) {
  await client.query('DELETE FROM srd_spell_classes WHERE document_source != \'merged\'');
  await client.query('DELETE FROM srd_class_saving_throws WHERE document_source != \'merged\'');
  await client.query('DELETE FROM srd_class_primary_abilities WHERE document_source != \'merged\'');
  await client.query('DELETE FROM srd_classes WHERE document_source != \'merged\'');

  const parentClasses = v2Classes.filter(c => !c.subclass_of);
  const subclasses = v2Classes.filter(c => c.subclass_of);
  let count = 0;

  const abilityNameToKey = {
    strength: 'str', dexterity: 'dex', constitution: 'con',
    intelligence: 'int', wisdom: 'wis', charisma: 'cha',
    str: 'str', dex: 'dex', con: 'con', int: 'int', wis: 'wis', cha: 'cha',
  };

  for (const item of [...parentClasses, ...subclasses]) {
    const source = docKey(item);
    if (!source) continue;
    const key = slugify(item.name);

    // Preserve all source-specific fields in features
    const features = Array.isArray(item.features) ? item.features.map(f => ({
      key: f.key,
      name: f.name,
      desc: f.desc,
      feature_type: f.feature_type || null,
      gained_at: f.gained_at || null,
    })) : [];

    const subclassOfKey = item.subclass_of?.key
      ? slugify(item.subclass_of.name || item.subclass_of.key)
      : null;

    const casterType = (item.caster_type || 'NONE').toUpperCase();

    await client.query(
      `INSERT INTO srd_classes (key, name, desc_text, hit_dice, caster_type, subclass_of_key, features, document_source)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)
       ON CONFLICT (key, document_source) DO UPDATE SET
         name = EXCLUDED.name, desc_text = EXCLUDED.desc_text, hit_dice = EXCLUDED.hit_dice,
         caster_type = EXCLUDED.caster_type, subclass_of_key = EXCLUDED.subclass_of_key,
         features = EXCLUDED.features`,
      [key, item.name, item.desc || '', item.hit_dice, casterType, subclassOfKey, JSON.stringify(features), source],
    );
    count++;

    // Junction: saving throws
    if (Array.isArray(item.saving_throws)) {
      for (const st of item.saving_throws) {
        const ak = typeof st === 'string'
          ? abilityNameToKey[st.toLowerCase()]
          : abilityNameToKey[(st.key || st.name || '').toLowerCase()];
        if (ak) {
          await client.query(
            `INSERT INTO srd_class_saving_throws (class_key, ability_key, document_source)
             VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
            [key, ak, source],
          );
        }
      }
    }

    // Junction: primary abilities
    if (Array.isArray(item.primary_abilities)) {
      for (const pa of item.primary_abilities) {
        const ak = typeof pa === 'string'
          ? abilityNameToKey[pa.toLowerCase()]
          : abilityNameToKey[(pa.key || pa.name || '').toLowerCase()];
        if (ak) {
          await client.query(
            `INSERT INTO srd_class_primary_abilities (class_key, ability_key, document_source)
             VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
            [key, ak, source],
          );
        }
      }
    }
  }
  console.log(`  Classes: ${count}`);
}

async function importBackgrounds(client, v2Backgrounds) {
  await client.query('DELETE FROM srd_backgrounds WHERE document_source != \'merged\'');

  let count = 0;
  for (const item of v2Backgrounds) {
    const source = docKey(item);
    if (!source) continue;
    const key = slugify(item.name);

    const benefits = Array.isArray(item.benefits) ? item.benefits.map(b => ({
      name: b.name,
      desc: b.desc,
      type: b.type || null,
    })) : [];

    // Synthesize desc from benefits if missing
    let desc = item.desc || '';
    if (!desc && benefits.length > 0) {
      desc = benefits
        .filter(b => b.desc)
        .map(b => `**${b.name}.** ${b.desc}`)
        .join('\n\n');
    }

    await client.query(
      `INSERT INTO srd_backgrounds (key, name, desc_text, benefits, document_source)
       VALUES ($1, $2, $3, $4::jsonb, $5)
       ON CONFLICT (key, document_source) DO UPDATE SET
         name = EXCLUDED.name, desc_text = EXCLUDED.desc_text, benefits = EXCLUDED.benefits`,
      [key, item.name, desc, JSON.stringify(benefits), source],
    );
    count++;
  }
  console.log(`  Backgrounds: ${count}`);
}

async function importFeats(client, v2Feats) {
  await client.query('DELETE FROM srd_feats WHERE document_source != \'merged\'');

  let count = 0;
  for (const item of v2Feats) {
    const source = docKey(item);
    if (!source) continue;
    const key = slugify(item.name);

    const benefits = Array.isArray(item.benefits) ? item.benefits : [];

    await client.query(
      `INSERT INTO srd_feats (key, name, desc_text, feat_type, prerequisite, benefits, document_source)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)
       ON CONFLICT (key, document_source) DO UPDATE SET
         name = EXCLUDED.name, desc_text = EXCLUDED.desc_text, feat_type = EXCLUDED.feat_type,
         prerequisite = EXCLUDED.prerequisite, benefits = EXCLUDED.benefits`,
      [key, item.name, item.desc || '', item.type || null, item.prerequisite || null, JSON.stringify(benefits), source],
    );
    count++;
  }
  console.log(`  Feats: ${count}`);
}

async function importSpells(client, v2Spells) {
  await client.query('DELETE FROM srd_spell_classes WHERE document_source != \'merged\'');
  await client.query('DELETE FROM srd_spells WHERE document_source != \'merged\'');

  let count = 0;
  let scCount = 0;

  for (const item of v2Spells) {
    const source = docKey(item);
    if (!source) continue;
    const key = slugify(item.name);

    // Ensure school exists
    const schoolKey = item.school?.key ? slugify(item.school.name || item.school.key) : null;
    if (schoolKey) {
      await client.query(
        `INSERT INTO srd_spell_schools (key, name) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING`,
        [schoolKey, item.school.name || schoolKey],
      );
    }

    const damageTypes = Array.isArray(item.damage_types)
      ? item.damage_types.map(dt => dt.key || dt.name || dt)
      : [];

    await client.query(
      `INSERT INTO srd_spells (key, name, desc_text, level, school_key, casting_time, range_text, range, duration,
        concentration, ritual, verbal, somatic, material, material_specified, damage_roll, damage_types,
        saving_throw_ability, attack_roll, document_source)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17::jsonb,$18,$19,$20)
       ON CONFLICT (key, document_source) DO UPDATE SET
         name=EXCLUDED.name, desc_text=EXCLUDED.desc_text, level=EXCLUDED.level, school_key=EXCLUDED.school_key,
         casting_time=EXCLUDED.casting_time, range_text=EXCLUDED.range_text, range=EXCLUDED.range,
         duration=EXCLUDED.duration, concentration=EXCLUDED.concentration, ritual=EXCLUDED.ritual,
         verbal=EXCLUDED.verbal, somatic=EXCLUDED.somatic, material=EXCLUDED.material,
         material_specified=EXCLUDED.material_specified, damage_roll=EXCLUDED.damage_roll,
         damage_types=EXCLUDED.damage_types, saving_throw_ability=EXCLUDED.saving_throw_ability,
         attack_roll=EXCLUDED.attack_roll`,
      [
        key, item.name, item.desc || '', item.level ?? 0,
        schoolKey, item.casting_time || null, item.range_text || null,
        item.range || null, item.duration || null,
        item.concentration || false, item.ritual || false,
        item.verbal || false, item.somatic || false, item.material || false,
        item.material_specified || null, item.damage_roll || null,
        JSON.stringify(damageTypes),
        item.saving_throw_ability || null, item.attack_roll || false,
        source,
      ],
    );
    count++;

    // Spell-class junctions
    if (Array.isArray(item.classes)) {
      for (const cls of item.classes) {
        const ck = typeof cls === 'string' ? slugify(cls) : slugify(cls.name || cls.key || '');
        if (!ck) continue;
        // Only insert if the class exists for this source
        const exists = await client.query(
          'SELECT 1 FROM srd_classes WHERE key = $1 AND document_source = $2',
          [ck, source],
        );
        if (exists.rows.length > 0) {
          await client.query(
            `INSERT INTO srd_spell_classes (spell_key, class_key, document_source)
             VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
            [key, ck, source],
          );
          scCount++;
        }
      }
    }
  }
  console.log(`  Spells: ${count}, spell-class junctions: ${scCount}`);
}

async function importItems(client, v2Items) {
  await client.query('DELETE FROM srd_weapons WHERE document_source != \'merged\'');
  await client.query('DELETE FROM srd_armor WHERE document_source != \'merged\'');
  await client.query('DELETE FROM srd_items WHERE document_source != \'merged\'');

  let count = 0;
  for (const item of v2Items) {
    const source = docKey(item);
    if (!source) continue;
    const key = slugify(item.name);

    const catKey = item.category?.key ? slugify(item.category.name || item.category.key) : null;
    const rarKey = item.rarity?.key ? slugify(item.rarity.name || item.rarity.key) : null;

    // Ensure category and rarity exist
    if (catKey) {
      await client.query(
        `INSERT INTO srd_item_categories (key, name) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING`,
        [catKey, item.category.name || catKey],
      );
    }
    if (rarKey) {
      await client.query(
        `INSERT INTO srd_item_rarities (key, name) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING`,
        [rarKey, item.rarity.name || rarKey],
      );
    }

    await client.query(
      `INSERT INTO srd_items (key, name, desc_text, category_key, rarity_key, cost, weight, weight_unit, requires_attunement, document_source)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (key, document_source) DO UPDATE SET
         name = EXCLUDED.name, desc_text = EXCLUDED.desc_text, category_key = EXCLUDED.category_key,
         rarity_key = EXCLUDED.rarity_key, cost = EXCLUDED.cost, weight = EXCLUDED.weight,
         weight_unit = EXCLUDED.weight_unit, requires_attunement = EXCLUDED.requires_attunement`,
      [
        key, item.name, item.desc || '',
        catKey, rarKey,
        item.cost || null, item.weight || null, item.weight_unit || 'lb',
        item.requires_attunement || false,
        source,
      ],
    );
    count++;
  }
  console.log(`  Items: ${count}`);
}

async function importWeapons(client, v2Weapons, v2Items) {
  // Build per-source item key lookup
  const itemKeys = new Set();
  for (const item of v2Items) {
    const source = docKey(item);
    if (source) itemKeys.add(`${slugify(item.name)}:${source}`);
  }

  let count = 0;
  for (const item of v2Weapons) {
    const source = docKey(item);
    if (!source) continue;
    const key = slugify(item.name);

    const dtKey = item.damage_type?.key ? slugify(item.damage_type.name || item.damage_type.key) : null;
    if (dtKey) {
      await client.query(
        `INSERT INTO srd_damage_types (key, name) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING`,
        [dtKey, item.damage_type.name || dtKey],
      );
    }

    const itemKey = itemKeys.has(`${key}:${source}`) ? key : null;
    const properties = Array.isArray(item.properties) ? item.properties.map(p => ({
      key: p.property?.key || p.key,
      name: p.property?.name || p.name,
      detail: p.detail || null,
    })) : [];

    await client.query(
      `INSERT INTO srd_weapons (key, name, item_key, damage_dice, damage_type_key, range, long_range, is_simple, properties, document_source)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10)
       ON CONFLICT (key, document_source) DO UPDATE SET
         name=EXCLUDED.name, item_key=EXCLUDED.item_key, damage_dice=EXCLUDED.damage_dice,
         damage_type_key=EXCLUDED.damage_type_key, range=EXCLUDED.range, long_range=EXCLUDED.long_range,
         is_simple=EXCLUDED.is_simple, properties=EXCLUDED.properties`,
      [
        key, item.name, itemKey,
        item.damage_dice || null, dtKey,
        item.range ? parseInt(item.range) || null : null,
        item.long_range ? parseInt(item.long_range) || null : null,
        item.is_simple ?? true,
        JSON.stringify(properties),
        source,
      ],
    );
    count++;
  }
  console.log(`  Weapons: ${count}`);
}

async function importArmor(client, v2Armor, v2Items) {
  const itemKeys = new Set();
  for (const item of v2Items) {
    const source = docKey(item);
    if (source) itemKeys.add(`${slugify(item.name)}:${source}`);
  }

  let count = 0;
  for (const item of v2Armor) {
    const source = docKey(item);
    if (!source) continue;
    const key = slugify(item.name);
    const itemKey = itemKeys.has(`${key}:${source}`) ? key : null;

    await client.query(
      `INSERT INTO srd_armor (key, name, item_key, ac_base, ac_add_dexmod, ac_cap_dexmod, category, grants_stealth_disadvantage, strength_score_required, document_source)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (key, document_source) DO UPDATE SET
         name=EXCLUDED.name, item_key=EXCLUDED.item_key, ac_base=EXCLUDED.ac_base,
         ac_add_dexmod=EXCLUDED.ac_add_dexmod, ac_cap_dexmod=EXCLUDED.ac_cap_dexmod,
         category=EXCLUDED.category, grants_stealth_disadvantage=EXCLUDED.grants_stealth_disadvantage,
         strength_score_required=EXCLUDED.strength_score_required`,
      [
        key, item.name, itemKey,
        item.ac_base || null, item.ac_add_dexmod || false, item.ac_cap_dexmod || null,
        item.category || null, item.grants_stealth_disadvantage || false,
        item.strength_score_required || null,
        source,
      ],
    );
    count++;
  }
  console.log(`  Armor: ${count}`);
}

// =============================================================================
// PHASE 3 — Data migration for existing characters
// =============================================================================

async function migrateExistingData(client) {
  // Set srd_document_source for existing characters that don't have it
  const { rowCount } = await client.query(
    `UPDATE characters SET srd_document_source = 'srd-2024' WHERE srd_document_source IS NULL`,
  );
  if (rowCount > 0) {
    console.log(`  Set srd_document_source for ${rowCount} existing characters`);
  }

  // Null out any character FKs pointing to keys that don't exist in any source
  const orphanSpecies = await client.query(
    `UPDATE characters SET species_key = NULL
     WHERE species_key IS NOT NULL AND species_key NOT IN (SELECT DISTINCT key FROM srd_species)
     RETURNING id`,
  );
  const orphanClass = await client.query(
    `UPDATE characters SET class_key = NULL
     WHERE class_key IS NOT NULL AND class_key NOT IN (SELECT DISTINCT key FROM srd_classes)
     RETURNING id`,
  );
  const orphanBg = await client.query(
    `UPDATE characters SET background_key = NULL
     WHERE background_key IS NOT NULL AND background_key NOT IN (SELECT DISTINCT key FROM srd_backgrounds)
     RETURNING id`,
  );
  const orphanTotal = orphanSpecies.rowCount + orphanClass.rowCount + orphanBg.rowCount;
  if (orphanTotal > 0) {
    console.log(`  Cleared ${orphanTotal} orphaned character FK references`);
  }

  // Clean up old merged data now that per-source data exists
  // Check if per-source data was actually imported before deleting merged
  const { rows: sourceCheck } = await client.query(
    `SELECT COUNT(*) as cnt FROM srd_species WHERE document_source != 'merged'`,
  );
  if (parseInt(sourceCheck[0].cnt) > 0) {
    const tables = ['srd_spell_classes', 'srd_class_saving_throws', 'srd_class_primary_abilities'];
    for (const t of tables) {
      await client.query(`DELETE FROM ${t} WHERE document_source = 'merged'`);
    }
    const entityTables = [
      'srd_weapons', 'srd_armor', 'srd_items', 'srd_spells',
      'srd_feats', 'srd_backgrounds', 'srd_classes', 'srd_species',
    ];
    for (const t of entityTables) {
      await client.query(`DELETE FROM ${t} WHERE document_source = 'merged'`);
    }
    console.log(`  Cleaned up merged (legacy) data`);
  }
}

// =============================================================================
// Main execution
// =============================================================================

async function main() {
  console.log('=== Open5e SRD Data Import (Per-Source Storage) ===');
  console.log(`API: ${API_BASE}`);
  console.log(`v2 documents: ${V2_DOCUMENTS.join(', ')}`);
  console.log('');

  // --- Fetch all data ---
  console.log('Fetching all data from Open5e v2...');

  const [
    v2Abilities, v2DamageTypes, v2SpellSchools, v2Conditions, v2Sizes,
    v2Languages, v2Alignments, v2ItemCategories, v2ItemRarities, v2WeaponProperties,
    v2Species, v2Classes, v2Backgrounds, v2Feats, v2Spells, v2Items,
    v2Weapons, v2Armor,
  ] = await Promise.all([
    fetchAllV2('abilities'),
    fetchAllV2('damagetypes'),
    fetchAllV2('spellschools'),
    fetchAllV2('conditions'),
    fetchAllV2('sizes'),
    fetchAllV2('languages'),
    fetchAllV2('alignments'),
    fetchAllV2('itemcategories'),
    fetchAllV2('itemrarities'),
    fetchAllV2('weaponproperties'),
    fetchAllV2('species'),
    fetchAllV2('classes'),
    fetchAllV2('backgrounds'),
    fetchAllV2('feats'),
    fetchAllV2('spells'),
    fetchAllV2('items'),
    fetchAllV2('weapons'),
    fetchAllV2('armor'),
  ]);

  console.log(`  v2: ${v2Species.length} species, ${v2Classes.length} classes, ${v2Backgrounds.length} backgrounds, ${v2Spells.length} spells, ${v2Items.length} items`);
  console.log('Fetch complete.\n');

  const client = await pool.connect();

  try {
    // Phase 1: Lookup tables
    console.log('Phase 1: Importing lookup tables...');
    await client.query('BEGIN');
    await importLookups(client, {
      abilities: v2Abilities, damageTypes: v2DamageTypes, spellSchools: v2SpellSchools,
      conditions: v2Conditions, sizes: v2Sizes, languages: v2Languages,
      alignments: v2Alignments, itemCategories: v2ItemCategories,
      itemRarities: v2ItemRarities, weaponProperties: v2WeaponProperties,
    });
    await client.query('COMMIT');
    console.log('Phase 1 complete.\n');

    // Phase 2: Entity tables (per-source)
    console.log('Phase 2: Importing entity tables (per-source)...');
    await client.query('BEGIN');
    await importSpecies(client, v2Species);
    await importClasses(client, v2Classes);
    await importBackgrounds(client, v2Backgrounds);
    await importFeats(client, v2Feats);
    await client.query('COMMIT');
    console.log('Phase 2 complete.\n');

    // Phase 3: Items, spells, weapons, armor
    console.log('Phase 3: Importing items, spells, weapons, armor...');
    await client.query('BEGIN');
    await importItems(client, v2Items);
    await importSpells(client, v2Spells);
    await importWeapons(client, v2Weapons, v2Items);
    await importArmor(client, v2Armor, v2Items);
    await client.query('COMMIT');
    console.log('Phase 3 complete.\n');

    // Phase 4: Data migration
    console.log('Phase 4: Migrating existing data...');
    await client.query('BEGIN');
    await migrateExistingData(client);
    await client.query('COMMIT');
    console.log('Phase 4 complete.\n');

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
