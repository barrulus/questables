import { useState, useEffect, useRef, useCallback } from 'react';
import { ArrowLeft } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '../ui/button';
import { WizardProvider, useWizard, WIZARD_STEPS } from './wizard-context';
import type { WizardState } from './wizard-context';
import { useComputedStats } from './use-computed-stats';
import { WizardLayout } from './wizard-layout';
import { WizardFooter } from './wizard-footer';
import { CharacterPreview } from './preview/character-preview';
import { StepSpecies } from './steps/step-species';
import { StepClass } from './steps/step-class';
import { StepAbilityScores } from './steps/step-ability-scores';
import { StepBackground } from './steps/step-background';
import { StepEquipmentSpells } from './steps/step-equipment-spells';
import { StepIdentity } from './steps/step-identity';
import { StepReview } from './steps/step-review';
import { createCharacter, getUserDraft, saveDraft, updateCharacter } from '../../utils/api/characters';
import { resolveEquipmentToInventory } from '../../utils/srd/resolve-equipment';

interface CharacterCreationWizardProps {
  user: {
    id: string;
    username: string;
  };
  onBack: () => void;
  onCharacterCreated: () => void;
}

/** Keys from WizardState that are serializable and should be persisted in the draft. */
const serializeWizardState = (state: WizardState): Record<string, unknown> => {
  // Omit computedStats — it is derived and recomputed on load
  const { computedStats: _, ...rest } = state;
  return rest as Record<string, unknown>;
};

/** Restore a draft payload back into a partial WizardState for LOAD_DRAFT. */
const deserializeDraftState = (raw: Record<string, unknown>): Partial<WizardState> => {
  // Only pick recognized wizard keys to avoid injecting stale/unknown fields
  const draft: Partial<WizardState> = {};

  if (typeof raw.currentStep === 'number') draft.currentStep = raw.currentStep;
  if (typeof raw.documentSource === 'string') draft.documentSource = raw.documentSource;
  if (typeof raw.speciesKey === 'string' || raw.speciesKey === null) draft.speciesKey = raw.speciesKey as string | null;
  if (typeof raw.subraceKey === 'string' || raw.subraceKey === null) draft.subraceKey = raw.subraceKey as string | null;
  if (typeof raw.classKey === 'string' || raw.classKey === null) draft.classKey = raw.classKey as string | null;
  if (typeof raw.abilityScoreMethod === 'string' || raw.abilityScoreMethod === null) draft.abilityScoreMethod = raw.abilityScoreMethod as WizardState['abilityScoreMethod'];
  if (raw.baseAbilities && typeof raw.baseAbilities === 'object') draft.baseAbilities = raw.baseAbilities as WizardState['baseAbilities'];
  if (typeof raw.backgroundKey === 'string' || raw.backgroundKey === null) draft.backgroundKey = raw.backgroundKey as string | null;
  if (Array.isArray(raw.chosenSkills)) draft.chosenSkills = raw.chosenSkills as string[];
  if (Array.isArray(raw.chosenLanguages)) draft.chosenLanguages = raw.chosenLanguages as string[];
  if (Array.isArray(raw.chosenEquipment)) draft.chosenEquipment = raw.chosenEquipment as string[];
  if (Array.isArray(raw.chosenCantrips)) draft.chosenCantrips = raw.chosenCantrips as string[];
  if (Array.isArray(raw.chosenSpells)) draft.chosenSpells = raw.chosenSpells as string[];
  if (typeof raw.name === 'string') draft.name = raw.name;
  if (typeof raw.alignment === 'string' || raw.alignment === null) draft.alignment = raw.alignment as string | null;
  if (typeof raw.personality === 'string') draft.personality = raw.personality;
  if (typeof raw.ideals === 'string') draft.ideals = raw.ideals;
  if (typeof raw.bonds === 'string') draft.bonds = raw.bonds;
  if (typeof raw.flaws === 'string') draft.flaws = raw.flaws;
  if (typeof raw.backstory === 'string') draft.backstory = raw.backstory;

  return draft;
};

function WizardContent({
  user,
  onBack,
  onCharacterCreated,
}: CharacterCreationWizardProps) {
  const { state, dispatch } = useWizard();
  const [isCreating, setIsCreating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // Track the character ID of the current draft row (null = no draft yet)
  const [draftId, setDraftId] = useState<string | null>(null);
  const draftLoaded = useRef(false);

  useComputedStats();

  // Load existing draft on mount
  useEffect(() => {
    if (draftLoaded.current) return;
    draftLoaded.current = true;

    const controller = new AbortController();
    getUserDraft(user.id, { signal: controller.signal })
      .then((draft) => {
        if (controller.signal.aborted) return;
        if (draft?.creation_state) {
          setDraftId(draft.id);
          const restored = deserializeDraftState(draft.creation_state as Record<string, unknown>);
          dispatch({ type: 'LOAD_DRAFT', state: restored });
          toast.info('Resumed your previous draft.');
        }
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        console.warn('Could not load draft:', err);
      });

    return () => controller.abort();
  }, [user.id, dispatch]);

  const handleCreateCharacter = async () => {
    setIsCreating(true);
    try {
      const stats = state.computedStats;
      const { inventory, equipment } = await resolveEquipmentToInventory(
        state.chosenEquipment,
        state.classKey,
      );

      if (draftId) {
        // Finalize the existing draft row: clear creation_state and set all fields
        await updateCharacter(draftId, {
          name: state.name || 'Unnamed Character',
          className: state.classKey || '',
          level: 1,
          race: state.speciesKey || '',
          background: state.backgroundKey || '',
          hitPoints: stats?.hitPoints ?? { max: 10, current: 10, temporary: 0 },
          armorClass: stats?.armorClass ?? 10,
          speed: stats?.speed ?? 30,
          proficiencyBonus: stats?.proficiencyBonus ?? 2,
          abilities: stats?.abilities ?? state.baseAbilities,
          savingThrows: stats?.savingThrows
            ? Object.fromEntries(
                Object.entries(stats.savingThrows).map(([k, v]) => [k, v.modifier])
              )
            : {},
          skills: stats?.skills
            ? Object.fromEntries(
                Object.entries(stats.skills).map(([k, v]) => [k, v.modifier])
              )
            : {},
          inventory,
          equipment,
          speciesKey: state.speciesKey,
          classKey: state.classKey,
          backgroundKey: state.backgroundKey,
          subrace: state.subraceKey,
          alignment: state.alignment,
          languages: state.chosenLanguages,
          abilityScoreMethod: state.abilityScoreMethod,
          personality: state.personality || null,
          ideals: state.ideals || null,
          bonds: state.bonds || null,
          flaws: state.flaws || null,
          backstory: state.backstory || null,
          creationState: null, // Clear draft — character is finalized
        });
      } else {
        await createCharacter({
          userId: user.id,
          name: state.name || 'Unnamed Character',
          className: state.classKey || '',
          level: 1,
          race: state.speciesKey || '',
          background: state.backgroundKey || '',
          hitPoints: stats?.hitPoints ?? { max: 10, current: 10, temporary: 0 },
          armorClass: stats?.armorClass ?? 10,
          speed: stats?.speed ?? 30,
          proficiencyBonus: stats?.proficiencyBonus ?? 2,
          abilities: stats?.abilities ?? state.baseAbilities,
          savingThrows: stats?.savingThrows
            ? Object.fromEntries(
                Object.entries(stats.savingThrows).map(([k, v]) => [k, v.modifier])
              )
            : {},
          skills: stats?.skills
            ? Object.fromEntries(
                Object.entries(stats.skills).map(([k, v]) => [k, v.modifier])
              )
            : {},
          inventory,
          equipment,
          speciesKey: state.speciesKey,
          classKey: state.classKey,
          backgroundKey: state.backgroundKey,
          srdDocumentSource: state.documentSource,
          subrace: state.subraceKey,
          alignment: state.alignment,
          languages: state.chosenLanguages,
          abilityScoreMethod: state.abilityScoreMethod,
          personality: state.personality || null,
          ideals: state.ideals || null,
          bonds: state.bonds || null,
          flaws: state.flaws || null,
          backstory: state.backstory || null,
        });
      }

      toast.success(`${state.name || 'Your character'} has been created!`);
      onCharacterCreated();
    } catch (error) {
      console.error('Failed to create character:', error);
      toast.error('Failed to create character. Please try again.');
    } finally {
      setIsCreating(false);
    }
  };

  const handleSaveDraft = useCallback(async () => {
    setIsSaving(true);
    try {
      const creationState = serializeWizardState(state);
      const saved = await saveDraft(user.id, creationState, draftId);
      if (!draftId) {
        setDraftId(saved.id);
      }
      toast.success('Your progress has been saved.');
    } catch (error) {
      console.error('Failed to save draft:', error);
      toast.error('Failed to save draft. Please try again.');
    } finally {
      setIsSaving(false);
    }
  }, [state, user.id, draftId]);

  const renderCurrentStep = () => {
    const stepKey = WIZARD_STEPS[state.currentStep].key;

    switch (stepKey) {
      case 'species':
        return <StepSpecies />;
      case 'class':
        return <StepClass />;
      case 'abilities':
        return <StepAbilityScores />;
      case 'background':
        return <StepBackground />;
      case 'equipment-spells':
        return <StepEquipmentSpells />;
      case 'identity':
        return <StepIdentity />;
      case 'review':
        return <StepReview />;
      default:
        return <div>Unknown step</div>;
    }
  };

  return (
    <div className="h-screen flex flex-col bg-background">
      <div className="border-b bg-card">
        <div className="px-6 py-4 flex items-center gap-4">
          <Button
            variant="ghost"
            size="sm"
            onClick={onBack}
            className="gap-2"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Dashboard
          </Button>
          <div className="h-6 w-px bg-border" />
          <h1 className="text-2xl font-bold">Create New Character</h1>
        </div>
      </div>

      <div className="flex-1 min-h-0">
        <WizardLayout
          mainContent={renderCurrentStep()}
          previewContent={<CharacterPreview />}
        />
      </div>

      <WizardFooter
        onCreateCharacter={handleCreateCharacter}
        onSaveDraft={handleSaveDraft}
        isCreating={isCreating}
        isSaving={isSaving}
      />
    </div>
  );
}

export function CharacterCreationWizard(props: CharacterCreationWizardProps) {
  return (
    <WizardProvider>
      <WizardContent {...props} />
    </WizardProvider>
  );
}
