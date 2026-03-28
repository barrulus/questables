/**
 * World-Building Service — collaborative CD + LLM world creation.
 *
 * Aggregates map data (states, cultures, religions, major settlements) and
 * feeds it to the LLM with world-building prompts to generate geopolitical
 * overviews, history, cultural lore, and regional backstories.
 *
 * Anti-trope mechanisms inspired by home_dnd: randomised unique elements,
 * varied conflict sources, avoiding common fantasy clichés.
 */

import { query } from '../../db/pool.js';
import { logInfo } from '../../utils/logger.js';

// ── Anti-trope elements ─────────────────────────────────────────────────────

const CONFLICT_SOURCES = [
  'resource scarcity', 'ideological schism', 'succession crisis', 'trade war',
  'religious reformation', 'plague aftermath', 'magical catastrophe', 'cultural assimilation',
  'border dispute', 'refugee crisis', 'technological disruption', 'environmental collapse',
  'ancient pact broken', 'prophecy misinterpreted', 'generational feud', 'colonial legacy',
];

const UNIQUE_ELEMENTS = [
  'a currency based on favours not coin', 'an annual festival that inverts social hierarchy',
  'a legal system based on trial by craft', 'a tradition of naming children after weather',
  'a universal sign language used between cultures', 'seasonal migrations of the entire populace',
  'an economy driven by monster parts trade', 'architecture that grows from living stone',
  'a taboo against written history', 'a caste system based on magical aptitude',
  'a democracy run by lottery', 'ancestor spirits that physically manifest',
];

const AVOID_TROPES = [
  'evil dark lords with no motivation', 'chosen one prophecies', 'noble savage stereotypes',
  'all elves are wise, all dwarves are grumpy', 'single-biome kingdoms', 'perfectly good vs evil factions',
  'convenient amnesia', 'all religions are either benevolent or evil cults',
];

function pickRandom(arr, count = 1) {
  const shuffled = [...arr].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count);
}

// ── System prompts ──────────────────────────────────────────────────────────

const WORLD_BUILD_BASE = `You are a D&D 5e world builder creating rich, nuanced setting content for a campaign.

ANTI-TROPE GUIDELINES:
- Avoid these clichés: ${pickRandom(AVOID_TROPES, 3).join('; ')}
- Include at least one unexpected element: ${pickRandom(UNIQUE_ELEMENTS, 1)[0]}
- Use this conflict driver as inspiration: ${pickRandom(CONFLICT_SOURCES, 1)[0]}

RULES:
- Ground everything in the provided map data — use real settlement names, populations, geography.
- Create interconnected content — factions should reference settlements, history should reference geography.
- Maintain internal consistency — don't contradict the map data.
- Write engaging, specific content — avoid generic fantasy filler.
- Respond with well-structured prose, using markdown headers and bullet points where appropriate.`;

const SECTION_PROMPTS = {
  geopolitical: `Generate a geopolitical overview for this world.

Include:
- Major power blocs and their relationships (alliances, rivalries, cold wars)
- Key political figures and their agendas
- Trade relationships based on the route network
- Border tensions and disputed territories
- The balance of power — who is ascendant, who is declining?

Use the state/province data from the map to ground every claim.`,

  history: `Generate a historical timeline for this world.

Include:
- 3-5 major historical eras with evocative names
- Founding events that explain the current political map
- A catastrophe or transformation that reshaped the world
- How geography influenced the rise and fall of civilisations (river valleys, mountain barriers, coastal empires)
- Legends that may or may not be true — hooks for adventure

Reference actual settlements and geographic features.`,

  cultures: `Generate cultural profiles for the peoples of this world.

For each major culture in the map data:
- Name and geographic distribution
- Values, customs, and social structure
- Relationship to other cultures (trade, rivalry, kinship)
- Distinctive art, cuisine, or technology
- Taboos and sacred practices
- How geography shaped the culture (coastal peoples differ from mountain folk)`,

  religions: `Generate religious traditions for this world.

For each religion present in the map data:
- Core beliefs and cosmology
- Clergy structure and holy sites
- Relationship to political power
- Popular vs orthodox practice
- Tensions with other faiths
- Sacred calendar and major festivals`,

  regions: `Generate regional backstories for the major territories in this world.

For each state/province:
- Ruling house or government structure
- Notable figures (ruler, general, merchant prince, rebel leader)
- Local customs that differ from neighbours
- Economic basis (what do they produce, trade, lack?)
- Current internal challenges
- How the terrain shapes daily life`,

  factions: `Generate major factions and organisations that operate across this world.

Include 4-6 factions:
- Name and purpose
- Leadership and membership
- Headquarters and areas of influence
- Goals and methods
- Rivals and allies among other factions
- Secret agendas or internal divisions
- How players might encounter or join them`,
};

// ── Map data aggregation ────────────────────────────────────────────────────

/**
 * Aggregate map data into a structured summary for the LLM.
 */
export async function aggregateWorldData(worldMapId) {
  // States (grouped from burgs)
  const { rows: states } = await query(
    `SELECT statefull AS name,
            COUNT(*) AS burg_count,
            SUM(population) AS total_population,
            COUNT(*) FILTER (WHERE capital) AS capitals,
            COUNT(*) FILTER (WHERE port) AS ports,
            COUNT(*) FILTER (WHERE citadel) AS citadels,
            COUNT(*) FILTER (WHERE temple) AS temples,
            array_agg(DISTINCT culture) FILTER (WHERE culture IS NOT NULL) AS cultures,
            array_agg(DISTINCT religion) FILTER (WHERE religion IS NOT NULL) AS religions
       FROM public.maps_burgs
      WHERE world_id = $1 AND statefull IS NOT NULL
      GROUP BY statefull
      ORDER BY SUM(population) DESC NULLS LAST`,
    [worldMapId],
    { label: 'world-build.states' },
  );

  // Major burgs
  const { rows: majorBurgs } = await query(
    `SELECT name, statefull, population, capital, port, citadel, walls, temple, plaza, culture, religion
       FROM public.maps_burgs
      WHERE world_id = $1 AND (capital = true OR population > 5000)
      ORDER BY population DESC NULLS LAST
      LIMIT 20`,
    [worldMapId],
    { label: 'world-build.major-burgs' },
  );

  // Cultures
  const { rows: cultures } = await query(
    `SELECT culture AS name, COUNT(*) AS burg_count, SUM(population) AS total_population
       FROM public.maps_burgs
      WHERE world_id = $1 AND culture IS NOT NULL
      GROUP BY culture
      ORDER BY SUM(population) DESC NULLS LAST`,
    [worldMapId],
    { label: 'world-build.cultures' },
  );

  // Religions
  const { rows: religions } = await query(
    `SELECT religion AS name, COUNT(*) AS burg_count, SUM(population) AS total_population
       FROM public.maps_burgs
      WHERE world_id = $1 AND religion IS NOT NULL
      GROUP BY religion
      ORDER BY SUM(population) DESC NULLS LAST`,
    [worldMapId],
    { label: 'world-build.religions' },
  );

  // Major routes
  const { rows: routes } = await query(
    `SELECT name, type FROM public.maps_routes
      WHERE world_id = $1 AND name IS NOT NULL
      ORDER BY type, name
      LIMIT 20`,
    [worldMapId],
    { label: 'world-build.routes' },
  );

  // Major rivers
  const { rows: rivers } = await query(
    `SELECT name, type, length FROM public.maps_rivers
      WHERE world_id = $1 AND name IS NOT NULL
      ORDER BY length DESC NULLS LAST
      LIMIT 15`,
    [worldMapId],
    { label: 'world-build.rivers' },
  );

  return { states, majorBurgs, cultures, religions, routes, rivers };
}

/**
 * Format aggregated world data into a prompt section.
 */
function formatWorldDataForPrompt(data) {
  const sections = [];

  if (data.states.length) {
    const stateLines = data.states.map((s) => {
      const features = [
        s.capitals > 0 && `${s.capitals} capital(s)`,
        s.ports > 0 && `${s.ports} port(s)`,
        s.citadels > 0 && `${s.citadels} citadel(s)`,
        s.temples > 0 && `${s.temples} temple(s)`,
      ].filter(Boolean);
      return `- **${s.name}**: ${s.burg_count} settlements, pop. ~${Number(s.total_population || 0).toLocaleString()}. ${features.join(', ') || 'no notable features'}. Cultures: ${s.cultures?.join(', ') || '?'}. Religions: ${s.religions?.join(', ') || '?'}`;
    });
    sections.push(`## States & Territories\n${stateLines.join('\n')}`);
  }

  if (data.majorBurgs.length) {
    const burgLines = data.majorBurgs.map((b) => {
      const features = [b.capital && 'CAPITAL', b.port && 'port', b.citadel && 'citadel', b.walls && 'walled', b.temple && 'temple', b.plaza && 'plaza'].filter(Boolean);
      return `- **${b.name}** (${b.statefull || '?'}): pop. ${b.population?.toLocaleString() || '?'}, ${features.join(', ') || 'no features'}. Culture: ${b.culture || '?'}, Religion: ${b.religion || '?'}`;
    });
    sections.push(`## Major Settlements\n${burgLines.join('\n')}`);
  }

  if (data.cultures.length) {
    const cultureLines = data.cultures.map((c) => `- **${c.name}**: ${c.burg_count} settlements, pop. ~${Number(c.total_population || 0).toLocaleString()}`);
    sections.push(`## Cultures\n${cultureLines.join('\n')}`);
  }

  if (data.religions.length) {
    const relLines = data.religions.map((r) => `- **${r.name}**: ${r.burg_count} settlements, pop. ~${Number(r.total_population || 0).toLocaleString()}`);
    sections.push(`## Religions\n${relLines.join('\n')}`);
  }

  if (data.routes.length) {
    const routeLines = data.routes.map((r) => `- ${r.name} (${r.type || 'road'})`);
    sections.push(`## Trade Routes\n${routeLines.join('\n')}`);
  }

  if (data.rivers.length) {
    const riverLines = data.rivers.map((r) => `- ${r.name} (${r.type || 'river'}${r.length ? `, ${Math.round(r.length)}km` : ''})`);
    sections.push(`## Major Rivers\n${riverLines.join('\n')}`);
  }

  return sections.join('\n\n');
}

// ── Generation ──────────────────────────────────────────────────────────────

/**
 * Generate world lore for a specific section.
 *
 * @param {object} opts
 * @param {string} opts.campaignId
 * @param {string} opts.worldMapId
 * @param {string} opts.section - One of: geopolitical, history, cultures, religions, regions, factions
 * @param {string} [opts.subsection] - Specific state/culture/religion name
 * @param {string} [opts.direction] - CD's direction/guidance for the generation
 * @param {object} opts.llmService - Enhanced LLM service (direct, no game context)
 * @returns {Promise<{ content: string, section: string, subsection?: string }>}
 */
export async function generateWorldLore({
  campaignId,
  worldMapId,
  section,
  subsection = null,
  direction = null,
  llmService,
}) {
  const sectionPrompt = SECTION_PROMPTS[section];
  if (!sectionPrompt) {
    throw new Error(`Unknown world-building section: ${section}`);
  }

  // Aggregate map data
  const worldData = await aggregateWorldData(worldMapId);
  const mapDataSection = formatWorldDataForPrompt(worldData);

  // Build the prompt
  const promptParts = [
    `## Map Data\n${mapDataSection}`,
    `## Task\n${sectionPrompt}`,
  ];

  if (subsection) {
    promptParts.push(`## Focus\nFocus specifically on: **${subsection}**`);
  }

  if (direction) {
    promptParts.push(`## Campaign Director's Guidance\n${direction}`);
  }

  const systemPrompt = WORLD_BUILD_BASE;
  const prompt = promptParts.join('\n\n');

  logInfo('Generating world lore', { campaignId, section, subsection, promptLength: prompt.length });

  const result = await llmService.generate('world_building', {
    prompt,
    systemPrompt,
  });

  const content = result.parsed?.content || result.content || '';

  return { content, section, subsection };
}

// ── CRUD ────────────────────────────────────────────────────────────────────

export async function listWorldLore(campaignId) {
  const { rows } = await query(
    `SELECT id, section, subsection, content, cd_direction, generated_by, version, created_at, updated_at
       FROM public.campaign_world_lore
      WHERE campaign_id = $1
      ORDER BY section, subsection NULLS FIRST, updated_at DESC`,
    [campaignId],
    { label: 'world-build.list' },
  );
  return rows;
}

export async function getWorldLoreById(id) {
  const { rows } = await query(
    `SELECT * FROM public.campaign_world_lore WHERE id = $1`,
    [id],
    { label: 'world-build.get' },
  );
  return rows[0] ?? null;
}

export async function upsertWorldLore({ campaignId, section, subsection, content, cdDirection, generatedBy }) {
  // Check if an entry already exists for this campaign/section/subsection
  const { rows: existing } = await query(
    `SELECT id, version FROM public.campaign_world_lore
      WHERE campaign_id = $1 AND section = $2 AND (subsection IS NOT DISTINCT FROM $3)
      LIMIT 1`,
    [campaignId, section, subsection ?? null],
    { label: 'world-build.check-existing' },
  );

  if (existing.length > 0) {
    const newVersion = (existing[0].version ?? 1) + 1;
    const { rows } = await query(
      `UPDATE public.campaign_world_lore
          SET content = $1, cd_direction = $2, generated_by = $3, version = $4
        WHERE id = $5
        RETURNING *`,
      [content, cdDirection ?? null, generatedBy ?? 'manual', newVersion, existing[0].id],
      { label: 'world-build.update' },
    );
    return rows[0];
  }

  const { rows } = await query(
    `INSERT INTO public.campaign_world_lore
       (campaign_id, section, subsection, content, cd_direction, generated_by)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [campaignId, section, subsection ?? null, content, cdDirection ?? null, generatedBy ?? 'manual'],
    { label: 'world-build.insert' },
  );
  return rows[0];
}

export async function deleteWorldLore(id) {
  const { rowCount } = await query(
    `DELETE FROM public.campaign_world_lore WHERE id = $1`,
    [id],
    { label: 'world-build.delete' },
  );
  return rowCount > 0;
}
