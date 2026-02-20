import { body } from 'express-validator';

export const validateChatMessage = [
  body('content')
    .isLength({ min: 1, max: 2000 })
    .withMessage('Message must be 1-2000 characters'),
  body('message_type')
    .optional()
    .isIn(['text', 'dice_roll', 'system', 'ooc'])
    .withMessage('Invalid message type'),
  body('channel_type')
    .optional()
    .isIn(['party', 'private', 'dm_whisper', 'dm_broadcast'])
    .withMessage('channel_type must be party, private, dm_whisper, or dm_broadcast'),
  body('channel_target_user_id')
    .optional({ nullable: true })
    .isUUID()
    .withMessage('channel_target_user_id must be a valid UUID'),
];
