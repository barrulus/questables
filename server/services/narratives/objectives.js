import { sanitizeUserInput } from '../../utils/sanitization.js';
import { MARKDOWN_FIELDS } from '../../objectives/objective-validation.js';
import { NARRATIVE_TYPES } from '../../llm/index.js';

export const OBJECTIVE_RETURNING_FIELDS = `
  id,
  campaign_id,
  parent_id,
  title,
  description_md,
  treasure_md,
  combat_md,
  npcs_md,
  rumours_md,
  location_type,
  location_burg_id,
  location_marker_id,
  ST_AsGeoJSON(location_pin)::json AS location_pin_geo,
  order_index,
  is_major,
  slug,
  created_at,
  updated_at,
  created_by,
  updated_by
`;

const parseJsonColumn = (value) => {
  if (!value) return null;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch (error) {
      return null;
    }
  }
  return value;
};

export const formatObjectiveRow = (row) => {
  if (!row) {
    return null;
  }

  const locationGeo = parseJsonColumn(row.location_pin_geo);
  const location = row.location_type
    ? {
        type: row.location_type,
        pin: row.location_type === 'pin' ? locationGeo : null,
        burgId: row.location_burg_id ?? null,
        markerId: row.location_marker_id ?? null,
      }
    : null;

  return {
    id: row.id,
    campaignId: row.campaign_id,
    parentId: row.parent_id ?? null,
    title: row.title,
    descriptionMd: row.description_md ?? null,
    treasureMd: row.treasure_md ?? null,
    combatMd: row.combat_md ?? null,
    npcsMd: row.npcs_md ?? null,
    rumoursMd: row.rumours_md ?? null,
    location,
    orderIndex: typeof row.order_index === 'number' ? row.order_index : 0,
    isMajor: Boolean(row.is_major),
    slug: row.slug ?? null,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at,
    createdBy: row.created_by ?? null,
    updatedBy: row.updated_by ?? null,
  };
};

export const fetchObjectiveById = async (client, objectiveId) => {
  const { rows } = await client.query(
    `SELECT ${OBJECTIVE_RETURNING_FIELDS}
       FROM public.campaign_objectives
      WHERE id = $1
      LIMIT 1`,
    [objectiveId],
  );
  return rows[0] ?? null;
};

export const fetchObjectiveWithCampaign = async (client, objectiveId) => {
  const { rows } = await client.query(
    `SELECT o.*, c.dm_user_id
       FROM public.campaign_objectives o
       JOIN public.campaigns c ON c.id = o.campaign_id
      WHERE o.id = $1
      LIMIT 1`,
    [objectiveId],
  );
  return rows[0] ?? null;
};

export const fetchObjectiveDescendantIds = async (client, objectiveId) => {
  const { rows } = await client.query(
    `WITH RECURSIVE tree AS (
        SELECT id
          FROM public.campaign_objectives
         WHERE parent_id = $1
        UNION ALL
        SELECT child.id
          FROM public.campaign_objectives child
          JOIN tree t ON child.parent_id = t.id
      )
      SELECT id FROM tree`,
    [objectiveId],
  );
  return rows.map((row) => row.id);
};

export const OBJECTIVE_ASSIST_FIELDS = {
  description: {
    column: 'description_md',
    narrativeType: NARRATIVE_TYPES.OBJECTIVE_DESCRIPTION,
    label: 'Objective Description',
  },
  treasure: {
    column: 'treasure_md',
    narrativeType: NARRATIVE_TYPES.OBJECTIVE_TREASURE,
    label: 'Treasure Hooks',
  },
  combat: {
    column: 'combat_md',
    narrativeType: NARRATIVE_TYPES.OBJECTIVE_COMBAT,
    label: 'Combat Planning',
  },
  npcs: {
    column: 'npcs_md',
    narrativeType: NARRATIVE_TYPES.OBJECTIVE_NPCS,
    label: 'NPC Brief',
  },
  rumours: {
    column: 'rumours_md',
    narrativeType: NARRATIVE_TYPES.OBJECTIVE_RUMOURS,
    label: 'Rumours',
  },
};

const formatObjectiveLocationSummary = (objective) => {
  if (!objective.location) {
    return 'Location: not specified.';
  }

  if (objective.location.type === 'pin') {
    const coords = Array.isArray(objective.location.pin?.coordinates)
      ? objective.location.pin.coordinates.map((coord) => Number(coord).toFixed(2)).join(', ')
      : 'unknown';
    return `Location: Pin at [${coords}] (SRID 0).`;
  }

  if (objective.location.type === 'burg') {
    return `Location: Linked burg ID ${objective.location.burgId}.`;
  }

  if (objective.location.type === 'marker') {
    return `Location: Linked marker ID ${objective.location.markerId}.`;
  }

  return 'Location: not specified.';
};

const snakeToCamel = (value) => value.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());

export const buildObjectiveAssistSections = ({ objective, parentObjective, fieldConfig }) => {
  const sections = [];

  const summaryParts = [
    `Title: ${objective.title}`,
    objective.isMajor ? 'Flag: Major objective' : null,
    typeof objective.orderIndex === 'number' ? `Order index: ${objective.orderIndex}` : null,
  ].filter(Boolean);

  if (parentObjective) {
    summaryParts.push(`Parent: ${parentObjective.title} (ID: ${parentObjective.id})`);
  }

  sections.push({
    title: 'Objective Summary',
    content: summaryParts.join('\n') || objective.title,
  });

  sections.push({
    title: 'Objective Location',
    content: formatObjectiveLocationSummary(objective),
  });

  const existingFieldKey = snakeToCamel(fieldConfig.column);
  const existingFieldValue = objective[existingFieldKey] || 'None recorded yet.';
  sections.push({
    title: `Existing ${fieldConfig.label}`,
    content: existingFieldValue,
  });

  const otherMarkdown = MARKDOWN_FIELDS
    .filter((field) => field !== fieldConfig.column)
    .map((field) => {
      const key = snakeToCamel(field);
      const value = objective[key];
      return `- ${field.replace('_', ' ')}: ${value ? value.slice(0, 160) : 'None'}`;
    })
    .join('\n');

  sections.push({
    title: 'Other Objective Notes',
    content: otherMarkdown,
  });

  return sections;
};

export const sanitizeAssistFocus = (value) => {
  if (typeof value !== 'string') return null;
  const trimmed = sanitizeUserInput(value, 400).trim();
  return trimmed.length > 0 ? trimmed : null;
};

export const stripThinkTags = (value) => {
  if (typeof value !== 'string') {
    return value;
  }
  return value.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
};
