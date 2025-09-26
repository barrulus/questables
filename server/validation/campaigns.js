import { body } from 'express-validator';
import { parseLevelRangeInput } from '../services/campaigns/utils.js';

export const validateCampaign = [
  body('name')
    .isLength({ min: 1, max: 100 })
    .withMessage('Campaign name must be 1-100 characters'),
  body('description')
    .optional()
    .isLength({ max: 2000 })
    .withMessage('Description cannot exceed 2000 characters'),
  body('maxPlayers')
    .optional()
    .isInt({ min: 1, max: 20 })
    .withMessage('Max players must be between 1 and 20'),
  body('levelRange')
    .optional()
    .custom((value) => {
      parseLevelRangeInput(value);
      return true;
    })
    .withMessage('Level range must include integer min/max between 1 and 20'),
  body('system')
    .optional()
    .isLength({ max: 50 })
    .withMessage('System name cannot exceed 50 characters'),
  body('worldMapId')
    .optional({ nullable: true })
    .isUUID()
    .withMessage('World map ID must be a valid UUID when provided'),
];
