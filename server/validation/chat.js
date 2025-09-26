import { body } from 'express-validator';

export const validateChatMessage = [
  body('content')
    .isLength({ min: 1, max: 2000 })
    .withMessage('Message must be 1-2000 characters'),
  body('message_type')
    .optional()
    .isIn(['text', 'dice_roll', 'system', 'ooc'])
    .withMessage('Invalid message type'),
];
