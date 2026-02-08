import { body } from 'express-validator';

export const validateCharacter = [
  body('name')
    .isLength({ min: 1, max: 50 })
    .withMessage('Character name must be 1-50 characters'),
  body('race')
    .isLength({ min: 1, max: 30 })
    .withMessage('Race must be 1-30 characters'),
  body('character_class')
    .isLength({ min: 1, max: 30 })
    .withMessage('Class must be 1-30 characters'),
  body('level')
    .isInt({ min: 1, max: 20 })
    .withMessage('Level must be between 1 and 20'),
  body('abilities.strength')
    .isInt({ min: 1, max: 30 })
    .withMessage('Strength must be between 1 and 30'),
  body('abilities.dexterity')
    .isInt({ min: 1, max: 30 })
    .withMessage('Dexterity must be between 1 and 30'),
  body('abilities.constitution')
    .isInt({ min: 1, max: 30 })
    .withMessage('Constitution must be between 1 and 30'),
  body('abilities.intelligence')
    .isInt({ min: 1, max: 30 })
    .withMessage('Intelligence must be between 1 and 30'),
  body('abilities.wisdom')
    .isInt({ min: 1, max: 30 })
    .withMessage('Wisdom must be between 1 and 30'),
  body('abilities.charisma')
    .isInt({ min: 1, max: 30 })
    .withMessage('Charisma must be between 1 and 30'),
  body('hit_points.max')
    .isInt({ min: 1 })
    .withMessage('Max HP must be at least 1'),
  body('hit_points.current')
    .isInt({ min: -100 })
    .withMessage('Current HP cannot be less than -100'),
  body('armor_class')
    .isInt({ min: 1, max: 30 })
    .withMessage('Armor Class must be between 1 and 30'),
  body('proficiency_bonus')
    .isInt({ min: 2, max: 6 })
    .withMessage('Proficiency bonus must be between 2 and 6'),
  body('species_key').optional({ values: 'null' }).isString().withMessage('Species key must be a string'),
  body('class_key').optional({ values: 'null' }).isString().withMessage('Class key must be a string'),
  body('background_key').optional({ values: 'null' }).isString().withMessage('Background key must be a string'),
  body('subrace').optional({ values: 'null' }).isString().isLength({ max: 100 }).withMessage('Subrace must be <= 100 characters'),
  body('subclass').optional({ values: 'null' }).isString().isLength({ max: 100 }).withMessage('Subclass must be <= 100 characters'),
  body('experience_points').optional().isInt({ min: 0 }).withMessage('Experience points must be >= 0'),
  body('alignment').optional({ values: 'null' }).isString().isLength({ max: 30 }).withMessage('Alignment must be <= 30 characters'),
  body('inspiration').optional().isBoolean().withMessage('Inspiration must be a boolean'),
  body('ability_score_method').optional({ values: 'null' }).isString().isLength({ max: 30 }).withMessage('Ability score method must be <= 30 characters'),
];
