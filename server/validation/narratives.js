import { body, param } from 'express-validator';
import { VALID_SENTIMENTS } from '../llm/npc-interaction-utils.js';

export const narrativeBaseValidators = [
  param('campaignId')
    .isUUID()
    .withMessage('campaignId must be a valid UUID'),
  body('sessionId')
    .optional({ checkFalsy: true })
    .isUUID()
    .withMessage('sessionId must be a valid UUID'),
  body('focus')
    .optional({ checkFalsy: true })
    .isString()
    .isLength({ max: 500 })
    .withMessage('focus must be a string up to 500 characters'),
  body('metadata')
    .optional()
    .isObject()
    .withMessage('metadata must be an object'),
  body('provider')
    .optional()
    .isObject()
    .withMessage('provider must be an object'),
  body('parameters')
    .optional()
    .isObject()
    .withMessage('parameters must be an object'),
];

export const npcNarrativeValidators = [
  body('npcId')
    .isUUID()
    .withMessage('npcId is required and must be a valid UUID'),
  body('interaction')
    .optional()
    .isObject()
    .withMessage('interaction must be an object when provided'),
  body('interaction.summary')
    .optional({ checkFalsy: true })
    .isString()
    .isLength({ max: 1000 })
    .withMessage('interaction.summary must be a string up to 1000 characters'),
  body('interaction.sentiment')
    .optional({ checkFalsy: true })
    .isString()
    .custom((value) => VALID_SENTIMENTS.has(value.toLowerCase()))
    .withMessage('interaction.sentiment must be one of positive, negative, neutral, or mixed'),
  body('interaction.trustDelta')
    .optional()
    .isInt({ min: -10, max: 10 })
    .withMessage('interaction.trustDelta must be an integer between -10 and 10'),
  body('interaction.tags')
    .optional()
    .isArray()
    .withMessage('interaction.tags must be an array of strings'),
  body('interaction.relationshipChanges')
    .optional()
    .isArray()
    .withMessage('interaction.relationshipChanges must be an array'),
  body('interaction.relationshipChanges.*.targetId')
    .optional({ checkFalsy: true })
    .isUUID()
    .withMessage('relationshipChanges.targetId must be a valid UUID'),
  body('interaction.relationshipChanges.*.targetType')
    .optional({ checkFalsy: true })
    .isString()
    .isIn(['npc', 'character'])
    .withMessage('relationshipChanges.targetType must be npc or character'),
  body('interaction.relationshipChanges.*.relationshipType')
    .optional({ checkFalsy: true })
    .isString()
    .isIn(['ally', 'enemy', 'neutral', 'romantic', 'family', 'business'])
    .withMessage('relationshipChanges.relationshipType must be a recognised relationship type'),
  body('interaction.relationshipChanges.*.delta')
    .optional()
    .isInt({ min: -5, max: 5 })
    .withMessage('relationshipChanges.delta must be an integer between -5 and 5'),
];

export const actionNarrativeValidators = [
  body('action')
    .isObject()
    .withMessage('action details are required for action narratives'),
  body('action.type')
    .optional({ checkFalsy: true })
    .isString()
    .withMessage('action.type must be a string when provided'),
  body('action.result')
    .optional({ checkFalsy: true })
    .isString()
    .withMessage('action.result must be a string when provided'),
];

export const questNarrativeValidators = [
  body('questSeeds')
    .optional()
    .isArray()
    .withMessage('questSeeds must be an array when provided'),
];

export const objectiveAssistValidators = [
  body('focus')
    .optional()
    .isString()
    .isLength({ max: 400 })
    .withMessage('focus must be a string up to 400 characters when provided'),
  body('provider')
    .optional()
    .isObject()
    .withMessage('provider must be an object when provided'),
  body('provider.name')
    .optional({ checkFalsy: true })
    .isString()
    .withMessage('provider.name must be a string when provided'),
  body('provider.model')
    .optional({ checkFalsy: true })
    .isString()
    .withMessage('provider.model must be a string when provided'),
  body('provider.options')
    .optional({ checkFalsy: true })
    .isObject()
    .withMessage('provider.options must be an object when provided'),
  body('parameters')
    .optional({ checkFalsy: true })
    .isObject()
    .withMessage('parameters must be an object when provided'),
];
