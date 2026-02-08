# Character Creation Wizard

A 7-step guided wizard for creating D&D 5e characters using SRD data.

## Components

```
components/character-wizard/
├── character-creation-wizard.tsx   # Main wizard shell
├── wizard-context.tsx              # State management (useReducer)
├── wizard-layout.tsx               # Two-column layout with scroll
├── wizard-sidebar.tsx              # Step navigation sidebar
├── wizard-footer.tsx               # Back/Next/Create buttons
├── markdown-text.tsx               # Markdown renderer for SRD text
├── use-srd-data.ts                 # SRD data fetching hook
├── use-computed-stats.ts           # Server-side stat computation hook
├── steps/
│   ├── step-species.tsx            # Step 1: Species selection
│   ├── step-class.tsx              # Step 2: Class selection
│   ├── step-ability-scores.tsx     # Step 3: Ability scores
│   ├── step-background.tsx         # Step 4: Background & skills
│   ├── step-equipment-spells.tsx   # Step 5: Equipment & spells
│   ├── step-identity.tsx           # Step 6: Name, personality, backstory
│   ├── step-review.tsx             # Step 7: Review & finalize
│   └── equipment-shop.tsx          # Equipment purchase sub-component
└── preview/
    └── character-preview.tsx       # Live preview panel
```

## Wizard Steps

### Step 1: Species

Select a species (e.g., Elf, Dwarf, Human) and optionally a subspecies/subrace. Displays species traits including speed, size, and racial features with markdown-rendered descriptions.

### Step 2: Class

Choose a character class (e.g., Fighter, Wizard, Rogue). Shows class features at level 1, hit die, saving throws, and primary abilities. Features are rendered with full markdown support including tables.

### Step 3: Ability Scores

Three methods for determining ability scores:

| Method | Description |
|--------|-------------|
| Standard Array | Assign values from the set `[15, 14, 13, 12, 10, 8]` |
| Point Buy | Spend 27 points across abilities (range 8-15) |
| 4d6 Drop Lowest | Roll 4d6, drop the lowest die, for each ability |

- Standard Array and Roll use dropdown selectors with pool management
- Point Buy uses +/- buttons with remaining point tracking
- Roll All auto-assigns values to abilities in STR→CHA order; users can reassign via dropdowns
- All methods show the ability modifier next to each score

### Step 4: Background

Select a background (e.g., Sage, Criminal, Noble). Choose skill proficiencies and languages granted by the background.

### Step 5: Equipment & Spells

Two tabs:

**Equipment Tab:**
- Parses starting equipment options from class features (e.g., "(A) Chain Mail, Greatsword; (B) Leather Armor and 155 GP")
- Options presented as radio buttons labeled "Equipment Pack A/B/C" or "Starting Gold"
- Gold option opens an inline equipment shop

**Equipment Shop** (`equipment-shop.tsx`):
- Category-filtered item browser (Weapons, Armor, Adventuring Gear, Tools, etc.)
- Items fetched from `/api/srd/items` with category filtering
- +/- quantity buttons with budget tracking
- Cart summary with running total in GP/SP/CP
- Zero-cost items (magic items) filtered out

**Spells Tab** (for caster classes):
- Cantrip and spell selection filtered by class and level
- Expandable spell descriptions with full markdown rendering
- Selection limits based on class (e.g., Wizard gets 3 cantrips + 6 spells at level 1)

### Step 6: Identity

Free-form text fields for:
- Character name
- Alignment (dropdown from 9 standard alignments)
- Personality traits, ideals, bonds, flaws
- Backstory

### Step 7: Review

Summary of all selections with computed stats from the server. Displays final ability scores with racial bonuses, HP, AC, proficiency bonus, skill modifiers, and spell slots. "Create Character" button submits to `/api/characters`.

## State Management

### WizardState

```typescript
interface WizardState {
  currentStep: number;
  sourceKey: string;                              // SRD source (e.g., 'srd-2024')

  // Step 1
  speciesKey: string | null;
  subraceKey: string | null;

  // Step 2
  classKey: string | null;

  // Step 3
  abilityScoreMethod: AbilityScoreMethod | null;  // 'standard-array' | 'point-buy' | '4d6-drop-lowest'
  baseAbilities: Record<AbilityName, number>;

  // Step 4
  backgroundKey: string | null;
  chosenSkills: string[];
  chosenLanguages: string[];

  // Step 5
  chosenEquipment: string[];                      // ['pack-A'] or ['gold-B', 'itemkey:qty', ...]
  chosenCantrips: string[];
  chosenSpells: string[];

  // Step 6
  name: string;
  alignment: string | null;
  personality: string;
  ideals: string;
  bonds: string;
  flaws: string;
  backstory: string;

  // Computed
  computedStats: ComputeStatsResponse | null;
}
```

### Actions

| Action | Description |
|--------|-------------|
| `SET_STEP` | Navigate to a specific step |
| `SET_SPECIES` | Set species and optionally subrace |
| `SET_CLASS` | Set character class |
| `SET_ABILITY_METHOD` | Set ability score generation method |
| `SET_ABILITIES` | Update base ability scores |
| `SET_BACKGROUND` | Set background |
| `SET_SKILLS` | Update chosen skill proficiencies |
| `SET_LANGUAGES` | Update chosen languages |
| `SET_EQUIPMENT` | Update equipment selections |
| `SET_CANTRIPS` | Update chosen cantrips |
| `SET_SPELLS` | Update chosen spells |
| `SET_IDENTITY` | Update name, alignment, personality fields |
| `SET_COMPUTED_STATS` | Store server-computed stats |

### State Persistence Across Steps

Steps unmount when navigating away (switch statement rendering). Local `useState` values are initialized from wizard context on remount:

```typescript
// Restore state from context on remount
const [equipmentChoice, setEquipmentChoice] = useState<string>(() => {
  if (state.chosenEquipment.length > 0) {
    return state.chosenEquipment[0];  // 'pack-A' or 'gold-B'
  }
  return '';
});
```

Equipment shop cart is stored as `['gold-B', 'itemKey:qty', ...]` in `chosenEquipment` and resolved back to item names/costs on remount.

## Server-Side Stat Computation

The `use-computed-stats.ts` hook calls `POST /api/srd/compute-stats` whenever the character's class, species, abilities, or background change. The stats engine computes:

- Final ability scores with racial bonuses
- Hit points (con modifier + hit die)
- Armor class
- Movement speed
- Proficiency bonus
- All 18 skill modifiers with proficiency markers
- Saving throw modifiers
- Spellcasting stats (attack bonus, save DC, spell slots)

## Equipment Format in Context

```typescript
// Equipment pack selected
chosenEquipment: ['pack-A']

// Gold option with shop purchases
chosenEquipment: ['gold-B', 'srd-2024_longsword:1', 'srd-2024_shield:1', 'srd-2024_backpack:1']
```

## SRD Constants

```typescript
STANDARD_ARRAY = [15, 14, 13, 12, 10, 8]
POINT_BUY_COSTS = { 8: 0, 9: 1, 10: 2, 11: 3, 12: 4, 13: 5, 14: 7, 15: 9 }
POINT_BUY_TOTAL = 27
ABILITY_NAMES = ['strength', 'dexterity', 'constitution', 'intelligence', 'wisdom', 'charisma']
```
