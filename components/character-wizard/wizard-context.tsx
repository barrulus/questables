import { createContext, useContext, useReducer, type ReactNode } from 'react';
import type { AbilityName } from '../../utils/srd/types';
import type { ComputeStatsResponse } from '../../utils/srd/types';
import type { AbilityScoreMethod } from '../../utils/srd/constants';

export const WIZARD_STEPS = [
  { key: 'species', label: 'Species' },
  { key: 'class', label: 'Class' },
  { key: 'abilities', label: 'Ability Scores' },
  { key: 'background', label: 'Background' },
  { key: 'equipment-spells', label: 'Equipment & Spells' },
  { key: 'identity', label: 'Identity' },
  { key: 'review', label: 'Review' },
] as const;

export type WizardStepKey = typeof WIZARD_STEPS[number]['key'];

export interface WizardState {
  currentStep: number;
  sourceKey: string;

  // Step 1: Species
  speciesKey: string | null;
  subraceKey: string | null;

  // Step 2: Class
  classKey: string | null;

  // Step 3: Ability Scores
  abilityScoreMethod: AbilityScoreMethod | null;
  baseAbilities: Record<AbilityName, number>;

  // Step 4: Background
  backgroundKey: string | null;
  chosenSkills: string[];
  chosenLanguages: string[];

  // Step 5: Equipment & Spells
  chosenEquipment: string[];
  chosenCantrips: string[];
  chosenSpells: string[];

  // Step 6: Identity
  name: string;
  alignment: string | null;
  personality: string;
  ideals: string;
  bonds: string;
  flaws: string;
  backstory: string;

  // Computed stats (from server)
  computedStats: ComputeStatsResponse | null;
}

const DEFAULT_ABILITIES: Record<AbilityName, number> = {
  strength: 10, dexterity: 10, constitution: 10,
  intelligence: 10, wisdom: 10, charisma: 10,
};

export const initialWizardState: WizardState = {
  currentStep: 0,
  sourceKey: 'srd-2024',
  speciesKey: null,
  subraceKey: null,
  classKey: null,
  abilityScoreMethod: null,
  baseAbilities: { ...DEFAULT_ABILITIES },
  backgroundKey: null,
  chosenSkills: [],
  chosenLanguages: ['Common'],
  chosenEquipment: [],
  chosenCantrips: [],
  chosenSpells: [],
  name: '',
  alignment: null,
  personality: '',
  ideals: '',
  bonds: '',
  flaws: '',
  backstory: '',
  computedStats: null,
};

export type WizardAction =
  | { type: 'SET_STEP'; step: number }
  | { type: 'SET_SOURCE'; sourceKey: string }
  | { type: 'SET_SPECIES'; speciesKey: string | null; subraceKey?: string | null }
  | { type: 'SET_SUBRACE'; subraceKey: string | null }
  | { type: 'SET_CLASS'; classKey: string | null }
  | { type: 'SET_ABILITY_METHOD'; method: AbilityScoreMethod }
  | { type: 'SET_ABILITIES'; abilities: Record<AbilityName, number> }
  | { type: 'SET_BACKGROUND'; backgroundKey: string | null }
  | { type: 'SET_SKILLS'; skills: string[] }
  | { type: 'SET_LANGUAGES'; languages: string[] }
  | { type: 'SET_EQUIPMENT'; equipment: string[] }
  | { type: 'SET_CANTRIPS'; cantrips: string[] }
  | { type: 'SET_SPELLS'; spells: string[] }
  | { type: 'SET_IDENTITY'; field: 'name' | 'alignment' | 'personality' | 'ideals' | 'bonds' | 'flaws' | 'backstory'; value: string }
  | { type: 'SET_COMPUTED_STATS'; stats: ComputeStatsResponse | null }
  | { type: 'LOAD_DRAFT'; state: Partial<WizardState> }
  | { type: 'RESET' };

function wizardReducer(state: WizardState, action: WizardAction): WizardState {
  switch (action.type) {
    case 'SET_STEP':
      return { ...state, currentStep: action.step };

    case 'SET_SOURCE':
      return {
        ...state,
        sourceKey: action.sourceKey,
        // Reset selections that depend on source
        speciesKey: null,
        subraceKey: null,
        classKey: null,
        backgroundKey: null,
        chosenEquipment: [],
        chosenCantrips: [],
        chosenSpells: [],
        computedStats: null,
      };

    case 'SET_SPECIES':
      return {
        ...state,
        speciesKey: action.speciesKey,
        subraceKey: action.subraceKey ?? null,
        computedStats: null,
      };

    case 'SET_SUBRACE':
      return { ...state, subraceKey: action.subraceKey, computedStats: null };

    case 'SET_CLASS':
      return {
        ...state,
        classKey: action.classKey,
        // Reset class-dependent selections
        chosenEquipment: [],
        chosenCantrips: [],
        chosenSpells: [],
        computedStats: null,
      };

    case 'SET_ABILITY_METHOD':
      return {
        ...state,
        abilityScoreMethod: action.method,
        baseAbilities: { ...DEFAULT_ABILITIES },
        computedStats: null,
      };

    case 'SET_ABILITIES':
      return { ...state, baseAbilities: action.abilities, computedStats: null };

    case 'SET_BACKGROUND':
      return {
        ...state,
        backgroundKey: action.backgroundKey,
        chosenSkills: [],
        computedStats: null,
      };

    case 'SET_SKILLS':
      return { ...state, chosenSkills: action.skills, computedStats: null };

    case 'SET_LANGUAGES':
      return { ...state, chosenLanguages: action.languages, computedStats: null };

    case 'SET_EQUIPMENT':
      return { ...state, chosenEquipment: action.equipment };

    case 'SET_CANTRIPS':
      return { ...state, chosenCantrips: action.cantrips };

    case 'SET_SPELLS':
      return { ...state, chosenSpells: action.spells };

    case 'SET_IDENTITY':
      return { ...state, [action.field]: action.value };

    case 'SET_COMPUTED_STATS':
      return { ...state, computedStats: action.stats };

    case 'LOAD_DRAFT':
      return { ...state, ...action.state };

    case 'RESET':
      return { ...initialWizardState };

    default:
      return state;
  }
}

interface WizardContextValue {
  state: WizardState;
  dispatch: React.Dispatch<WizardAction>;
  canGoNext: boolean;
  canGoBack: boolean;
  goNext: () => void;
  goBack: () => void;
  goToStep: (step: number) => void;
}

const WizardContext = createContext<WizardContextValue | null>(null);

export function WizardProvider({ children, initialState }: { children: ReactNode; initialState?: Partial<WizardState> }) {
  const [state, dispatch] = useReducer(wizardReducer, {
    ...initialWizardState,
    ...initialState,
  });

  const canGoNext = state.currentStep < WIZARD_STEPS.length - 1;
  const canGoBack = state.currentStep > 0;

  const goNext = () => {
    if (canGoNext) {
      dispatch({ type: 'SET_STEP', step: state.currentStep + 1 });
    }
  };

  const goBack = () => {
    if (canGoBack) {
      dispatch({ type: 'SET_STEP', step: state.currentStep - 1 });
    }
  };

  const goToStep = (step: number) => {
    if (step >= 0 && step < WIZARD_STEPS.length) {
      dispatch({ type: 'SET_STEP', step });
    }
  };

  return (
    <WizardContext.Provider value={{ state, dispatch, canGoNext, canGoBack, goNext, goBack, goToStep }}>
      {children}
    </WizardContext.Provider>
  );
}

export function useWizard(): WizardContextValue {
  const ctx = useContext(WizardContext);
  if (!ctx) {
    throw new Error('useWizard must be used within a WizardProvider');
  }
  return ctx;
}
