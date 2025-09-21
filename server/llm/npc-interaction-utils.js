import { sanitizeUserInput } from '../utils/sanitization.js';

export const VALID_SENTIMENTS = new Set(['positive', 'negative', 'neutral', 'mixed']);

const SENTIMENT_KEYWORDS = {
  positive: ['grateful', 'cheer', 'smile', 'thanks', 'relieved', 'hope', 'calm', 'trust', 'ally', 'friendly'],
  negative: ['angry', 'shout', 'threat', 'fear', 'suspicious', 'betray', 'hostile', 'resent', 'wary', 'grim'],
  mixed: ['uncertain', 'hesitant', 'conflicted', 'uneasy', 'doubt'],
};

const MAX_MEMORY_SUMMARY_LENGTH = 400;

const stripWhitespace = (value) => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : value);

const deriveSentiment = (content, explicitSentiment) => {
  if (explicitSentiment && VALID_SENTIMENTS.has(explicitSentiment.toLowerCase())) {
    return explicitSentiment.toLowerCase();
  }

  if (typeof content !== 'string' || content.trim().length === 0) {
    return 'neutral';
  }

  const text = content.toLowerCase();
  let score = 0;

  for (const keyword of SENTIMENT_KEYWORDS.positive) {
    if (text.includes(keyword)) score += 1;
  }

  for (const keyword of SENTIMENT_KEYWORDS.negative) {
    if (text.includes(keyword)) score -= 1;
  }

  if (score > 1) return 'positive';
  if (score < -1) return 'negative';

  for (const keyword of SENTIMENT_KEYWORDS.mixed) {
    if (text.includes(keyword)) {
      return 'mixed';
    }
  }

  if (score > 0) return 'positive';
  if (score < 0) return 'negative';
  return 'neutral';
};

const truncateSummary = (value) => {
  if (typeof value !== 'string') {
    return null;
  }
  const sanitized = sanitizeUserInput(value, MAX_MEMORY_SUMMARY_LENGTH) || '';
  return sanitized.trim().length > 0 ? sanitized.trim() : null;
};

const extractSummaryFromResponse = (response) => {
  if (typeof response !== 'string') {
    return null;
  }
  const cleaned = stripWhitespace(response);
  if (cleaned.length <= MAX_MEMORY_SUMMARY_LENGTH) {
    return cleaned;
  }
  return `${cleaned.slice(0, MAX_MEMORY_SUMMARY_LENGTH - 1).trim()}…`;
};

const normalizeRelationshipChanges = (changes) => {
  if (!Array.isArray(changes)) {
    return [];
  }
  return changes
    .filter((change) => change && change.targetId)
    .map((change) => ({
      targetId: change.targetId,
      targetType: (change.targetType || 'character').toLowerCase(),
      relationshipType: change.relationshipType || 'neutral',
      delta: change.delta ?? 0,
      description: change.description ? sanitizeUserInput(change.description, MAX_MEMORY_SUMMARY_LENGTH) : null,
    }))
    .filter((change) => ['npc', 'character'].includes(change.targetType));
};

export const clamp = (value, min, max) => {
  if (Number.isNaN(Number(value))) return min;
  return Math.max(min, Math.min(max, Number(value)));
};

export const deriveNpcInteraction = ({ result, interaction = {}, metadata = {} }) => {
  const summaryOverride = truncateSummary(interaction.summary) || truncateSummary(metadata.interactionSummary);
  const summary = summaryOverride || extractSummaryFromResponse(result?.content) || 'Interaction recorded without detailed summary.';

  const sentiment = deriveSentiment(
    result?.content,
    interaction.sentiment || metadata.sentiment
  );

  const trustDelta = clamp(
    interaction.trustDelta ?? metadata.trustDelta ?? (sentiment === 'positive' ? 1 : sentiment === 'negative' ? -1 : 0),
    -10,
    10
  );

  const tags = Array.isArray(interaction.tags) && interaction.tags.length > 0
    ? interaction.tags
    : Array.isArray(metadata.tags) ? metadata.tags : [];

  const relationshipChanges = normalizeRelationshipChanges(
    interaction.relationshipChanges || metadata.relationshipChanges
  );

  return {
    summary,
    sentiment,
    trustDelta,
    tags,
    relationshipChanges,
  };
};

export const NORMALIZED_MAX_SUMMARY_LENGTH = MAX_MEMORY_SUMMARY_LENGTH;
