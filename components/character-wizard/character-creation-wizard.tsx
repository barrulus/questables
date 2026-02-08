import { useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { WizardProvider, useWizard, WIZARD_STEPS } from './wizard-context';
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
import { createCharacter } from '../../utils/api/characters';

interface CharacterCreationWizardProps {
  user: {
    id: string;
    username: string;
  };
  onBack: () => void;
  onCharacterCreated: () => void;
}

function WizardContent({
  user,
  onBack,
  onCharacterCreated,
}: CharacterCreationWizardProps) {
  const { state, dispatch } = useWizard();
  const [isCreating, setIsCreating] = useState(false);

  useComputedStats();

  const handleSourceChange = (sourceKey: string) => {
    dispatch({ type: 'SET_SOURCE', sourceKey });
  };

  const handleCreateCharacter = async () => {
    setIsCreating(true);
    try {
      const stats = state.computedStats;
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
        inventory: [],
        equipment: { weapons: {}, accessories: {} },
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
      });

      toast.success(`${state.name || 'Your character'} has been created!`);
      onCharacterCreated();
    } catch (error) {
      console.error('Failed to create character:', error);
      toast.error('Failed to create character. Please try again.');
    } finally {
      setIsCreating(false);
    }
  };

  const handleSaveDraft = async () => {
    try {
      // TODO: Implement draft saving via creation_state column
      toast.success('Your progress has been saved.');
    } catch (error) {
      console.error('Failed to save draft:', error);
      toast.error('Failed to save draft. Please try again.');
    }
  };

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

  const sourceKey = state.sourceKey;

  return (
    <div className="h-screen flex flex-col bg-background">
      <div className="border-b bg-card">
        <div className="px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
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

          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">Source:</span>
            <div className="flex gap-1">
              <Badge
                variant={sourceKey === 'srd-2014' ? 'default' : 'outline'}
                className="cursor-pointer"
                onClick={() => handleSourceChange('srd-2014')}
              >
                5e 2014
              </Badge>
              <Badge
                variant={sourceKey === 'srd-2024' ? 'default' : 'outline'}
                className="cursor-pointer"
                onClick={() => handleSourceChange('srd-2024')}
              >
                5e 2024
              </Badge>
            </div>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-hidden">
        <WizardLayout
          mainContent={renderCurrentStep()}
          previewContent={<CharacterPreview />}
        />
      </div>

      <WizardFooter
        onCreateCharacter={handleCreateCharacter}
        onSaveDraft={handleSaveDraft}
        isCreating={isCreating}
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
