import { CheckCircle2, Lock } from 'lucide-react';
import { cn } from '../ui/utils';
import { useWizard, WIZARD_STEPS } from './wizard-context';

export function WizardSidebar() {
  const { state, goToStep } = useWizard();
  const { currentStep } = state;

  return (
    <div className="w-56 bg-card border-r p-6">
      <div className="space-y-1">
        {WIZARD_STEPS.map((step, index) => {
          const stepNumber = index + 1;
          const isActive = currentStep === index;
          const isCompleted = currentStep > index;
          const isLocked = !isActive && !isCompleted;
          const canClick = isActive || isCompleted;

          return (
            <button
              key={step.key}
              onClick={() => canClick && goToStep(index)}
              disabled={!canClick}
              className={cn(
                'w-full flex items-center gap-3 px-3 py-2.5 rounded-md text-left transition-colors',
                isActive && 'bg-primary text-primary-foreground',
                !isActive && isCompleted && 'hover:bg-accent',
                isLocked && 'opacity-50 cursor-not-allowed'
              )}
            >
              <div className="flex-shrink-0">
                {isCompleted ? (
                  <CheckCircle2 className="h-5 w-5 text-green-500" />
                ) : isLocked ? (
                  <Lock className="h-5 w-5 text-muted-foreground" />
                ) : (
                  <div
                    className={cn(
                      'h-5 w-5 rounded-full border-2 flex items-center justify-center text-xs font-semibold',
                      isActive
                        ? 'border-primary-foreground text-primary-foreground'
                        : 'border-muted-foreground text-muted-foreground'
                    )}
                  >
                    {stepNumber}
                  </div>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">{step.label}</div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
