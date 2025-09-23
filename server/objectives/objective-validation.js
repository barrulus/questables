class ObjectiveValidationError extends Error {
  constructor(code, message, meta = {}) {
    super(message);
    this.name = 'ObjectiveValidationError';
    this.code = code;
    this.meta = meta;
  }
}

const MARKDOWN_FIELDS = ['description_md', 'treasure_md', 'combat_md', 'npcs_md', 'rumours_md'];

const CAMEL_TO_SNAKE_MAP = new Map([
  ['descriptionMd', 'description_md'],
  ['treasureMd', 'treasure_md'],
  ['combatMd', 'combat_md'],
  ['npcsMd', 'npcs_md'],
  ['rumoursMd', 'rumours_md'],
]);

const isUuid = (value) => typeof value === 'string' && /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/.test(value);

const isFiniteNumber = (value) => typeof value === 'number' && Number.isFinite(value);

const normalizeBoolean = (value) => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'yes'].includes(normalized)) return true;
    if (['false', '0', 'no'].includes(normalized)) return false;
  }
  if (typeof value === 'number') {
    if (value === 1) return true;
    if (value === 0) return false;
  }
  return null;
};

const createValidationError = (code, message, meta) => new ObjectiveValidationError(code, message, meta);

const sanitizeText = (value, { field, required = false, maxLength = 255 }) => {
  if (value === undefined || value === null) {
    if (required) throw createValidationError('missing_field', `${field} is required.`);
    return null;
  }

  if (typeof value !== 'string') {
    throw createValidationError('invalid_field_type', `${field} must be a string.`);
  }

  const trimmed = value.trim();
  if (!trimmed) {
    if (required) throw createValidationError('invalid_field', `${field} cannot be blank.`);
    return null;
  }

  if (trimmed.length > maxLength) {
    throw createValidationError('field_too_long', `${field} cannot exceed ${maxLength} characters.`);
  }

  return trimmed;
};

const sanitizeMarkdownField = (value, field) => {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') {
    throw createValidationError('invalid_markdown', `${field} must be a string when provided.`);
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const extractNumeric = (value) => {
  if (value === undefined || value === null) return null;
  const numeric = typeof value === 'string' ? Number(value) : value;
  if (!isFiniteNumber(numeric)) return null;
  return numeric;
};

const normalizeCoordinatePayload = (payload) => {
  if (!payload || typeof payload !== 'object') return null;
  const candidate = payload.target && typeof payload.target === 'object' ? payload.target : payload;
  const x = extractNumeric(
    candidate.x ?? candidate.lon ?? candidate.lng ?? candidate.longitude ?? candidate.east ?? candidate.right
  );
  const y = extractNumeric(
    candidate.y ?? candidate.lat ?? candidate.latitude ?? candidate.north ?? candidate.top
  );

  if (x === null || y === null) {
    return null;
  }

  return { x, y };
};

const validateLocationPayload = (payload) => {
  const locationType = payload.locationType ?? payload.location_type ?? null;

  const locationPin = payload.locationPin ?? payload.location_pin ?? payload.pin ?? null;
  const locationBurgId = payload.locationBurgId ?? payload.location_burg_id ?? payload.burgId ?? payload.burg_id ?? null;
  const locationMarkerId = payload.locationMarkerId ?? payload.location_marker_id ?? payload.markerId ?? payload.marker_id ?? null;

  const provided = [
    locationPin ? 'pin' : null,
    locationBurgId ? 'burg' : null,
    locationMarkerId ? 'marker' : null,
  ].filter(Boolean);

  const locationFieldProvided =
    Object.prototype.hasOwnProperty.call(payload, 'locationType') ||
    Object.prototype.hasOwnProperty.call(payload, 'location_type') ||
    Object.prototype.hasOwnProperty.call(payload, 'locationPin') ||
    Object.prototype.hasOwnProperty.call(payload, 'location_pin') ||
    Object.prototype.hasOwnProperty.call(payload, 'locationBurgId') ||
    Object.prototype.hasOwnProperty.call(payload, 'location_burg_id') ||
    Object.prototype.hasOwnProperty.call(payload, 'locationMarkerId') ||
    Object.prototype.hasOwnProperty.call(payload, 'location_marker_id');

  if (!locationType && provided.length === 0) {
    return locationFieldProvided ? { type: null, pin: null, burgId: null, markerId: null } : null;
  }

  const normalizedType = locationType ? String(locationType).trim().toLowerCase() : null;
  if (!normalizedType) {
    throw createValidationError('invalid_location', 'locationType must be provided when location data is sent.');
  }

  if (!['pin', 'burg', 'marker'].includes(normalizedType)) {
    throw createValidationError('invalid_location', `Unsupported location type: ${normalizedType}.`);
  }

  if (new Set(provided).size > 1) {
    throw createValidationError('invalid_location', 'Only one location target (pin, burg, or marker) may be provided.');
  }

  if (normalizedType === 'pin') {
    const pin = normalizeCoordinatePayload(locationPin || payload);
    if (!pin) {
      throw createValidationError('invalid_location', 'Pin objectives require numeric x/y coordinates.');
    }
    return { type: 'pin', pin, burgId: null, markerId: null };
  }

  if (normalizedType === 'burg') {
    if (!isUuid(locationBurgId)) {
      throw createValidationError('invalid_location', 'Burg objectives require a valid burg UUID.');
    }
    return { type: 'burg', pin: null, burgId: locationBurgId, markerId: null };
  }

  if (normalizedType === 'marker') {
    if (!isUuid(locationMarkerId)) {
      throw createValidationError('invalid_location', 'Marker objectives require a valid marker UUID.');
    }
    return { type: 'marker', pin: null, burgId: null, markerId: locationMarkerId };
  }

  throw createValidationError('invalid_location', `Unsupported location type: ${normalizedType}.`);
};

const sanitizeOrderIndex = (value) => {
  if (value === undefined || value === null) return null;
  const numeric = Number(value);
  if (!Number.isInteger(numeric)) {
    throw createValidationError('invalid_order_index', 'orderIndex must be an integer when provided.');
  }
  if (numeric < 0 || numeric > 100000) {
    throw createValidationError('invalid_order_index', 'orderIndex must be between 0 and 100000.');
  }
  return numeric;
};

const validateParentRelationship = ({
  parentId,
  campaignId,
  parentObjective,
  ancestorIds = [],
  selfId = null,
}) => {
  if (!parentId) return null;

  if (!isUuid(parentId)) {
    throw createValidationError('invalid_parent', 'parentId must be a valid UUID.');
  }

  if (selfId && parentId === selfId) {
    throw createValidationError('invalid_parent', 'An objective cannot reference itself as a parent.');
  }

  if (ancestorIds.includes(parentId)) {
    throw createValidationError('invalid_parent', 'Parent cycle detected in objective tree.');
  }

  if (!parentObjective) {
    return parentId;
  }

  if (parentObjective.campaign_id && parentObjective.campaign_id !== campaignId) {
    throw createValidationError('invalid_parent', 'Parent objective belongs to a different campaign.');
  }

  return parentId;
};

export const sanitizeObjectivePayload = (
  payload,
  {
    requireTitle = true,
    campaignId,
    parentObjective = null,
    ancestorIds = [],
    selfId = null,
  } = {},
) => {
  if (!payload || typeof payload !== 'object') {
    throw createValidationError('invalid_payload', 'Objective payload must be an object.');
  }

  const sanitized = {};

  const title = sanitizeText(payload.title ?? payload.name, {
    field: 'title',
    required: requireTitle,
    maxLength: 255,
  });
  if (title !== null) {
    sanitized.title = title;
  }

  const parentFieldProvided =
    Object.prototype.hasOwnProperty.call(payload, 'parentId') ||
    Object.prototype.hasOwnProperty.call(payload, 'parent_id');

  const parentId = validateParentRelationship({
    parentId: payload.parentId ?? payload.parent_id ?? null,
    campaignId,
    parentObjective,
    ancestorIds,
    selfId,
  });
  if (parentId || parentFieldProvided) sanitized.parentId = parentId;

  const orderIndex = sanitizeOrderIndex(payload.orderIndex ?? payload.order_index);
  if (orderIndex !== null) sanitized.orderIndex = orderIndex;

  const markdown = {};
  for (const field of MARKDOWN_FIELDS) {
    const camelKey = [...CAMEL_TO_SNAKE_MAP.entries()].find(([, snake]) => snake === field)?.[0];
    const hasField = Object.prototype.hasOwnProperty.call(payload, field)
      || (camelKey ? Object.prototype.hasOwnProperty.call(payload, camelKey) : false);
    if (!hasField) {
      continue;
    }
    const rawValue = payload[field] ?? (camelKey ? payload[camelKey] : undefined);
    const sanitizedValue = sanitizeMarkdownField(rawValue, field);
    markdown[field] = sanitizedValue;
  }

  if (Object.keys(markdown).length > 0) {
    sanitized.markdown = markdown;
  }

  const location = validateLocationPayload(payload);
  if (location !== null) {
    sanitized.location = location;
  }

  const isMajorObjective = normalizeBoolean(payload.isMajor ?? payload.is_major);
  if (isMajorObjective !== null) {
    sanitized.isMajor = isMajorObjective;
  }

  const slug = payload.slug ? sanitizeText(payload.slug, { field: 'slug', required: false, maxLength: 120 }) : null;
  if (slug) sanitized.slug = slug.toLowerCase();

  return sanitized;
};

export {
  ObjectiveValidationError,
  MARKDOWN_FIELDS,
  sanitizeMarkdownField,
  validateLocationPayload,
  sanitizeOrderIndex,
  validateParentRelationship,
};

export default {
  ObjectiveValidationError,
  sanitizeObjectivePayload,
  sanitizeMarkdownField,
  validateLocationPayload,
  sanitizeOrderIndex,
  validateParentRelationship,
};
