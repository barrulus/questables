import { ArrowLeft, ArrowRight, Save } from 'lucide-react';
import { Button } from '../ui/button';
import { useWizard, WIZARD_STEPS } from './wizard-context';

interface WizardFooterProps {
  onCreateCharacter: () => void;
  onSaveDraft: () => void;
  isCreating: boolean;
  isSaving?: boolean;
}

export function WizardFooter({
  onCreateCharacter,
  onSaveDraft,
  isCreating,
  isSaving = false,
}: WizardFooterProps) {
  const { state, goNext, goBack, canGoNext, canGoBack } = useWizard();
  const isLastStep = state.currentStep === WIZARD_STEPS.length - 1;

  return (
    <div className="border-t bg-card relative z-10">
      <div className="px-6 py-4 flex items-center justify-between">
        <div>
          <Button
            variant="outline"
            onClick={onSaveDraft}
            disabled={isCreating || isSaving}
            className="gap-2"
          >
            <Save className="h-4 w-4" />
            {isSaving ? 'Saving...' : 'Save Draft'}
          </Button>
        </div>

        <div className="flex items-center gap-3">
          {canGoBack && (
            <Button
              variant="outline"
              onClick={goBack}
              disabled={isCreating}
              className="gap-2"
            >
              <ArrowLeft className="h-4 w-4" />
              Back
            </Button>
          )}

          {isLastStep ? (
            <Button
              onClick={onCreateCharacter}
              disabled={isCreating}
              className="gap-2"
            >
              {isCreating ? 'Creating...' : 'Create Character'}
            </Button>
          ) : (
            <Button
              onClick={goNext}
              disabled={!canGoNext || isCreating}
              className="gap-2"
            >
              Next
              <ArrowRight className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
