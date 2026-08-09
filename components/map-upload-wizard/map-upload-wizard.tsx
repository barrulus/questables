import { useState } from "react";
import { Card, CardContent } from "../ui/card";
import { Button } from "../ui/button";
import { CheckCircle, Circle, Upload } from "lucide-react";
import { FullJsonUploadStep } from "./full-json-upload-step";
import { SvgAttachStep } from "./svg-attach-step";
import { ReviewStep } from "./review-step";

interface MapWizardState {
  step: 0 | 1 | 2;
  worldId: string | null;
  worldName: string;
}

const STEP_LABELS = ["Full JSON", "SVG canvas", "Review"];

interface MapUploadWizardProps {
  // userId retained in signature for API parity with the previous wizard, even
  // though step components no longer need it (auth comes from the Bearer
  // token attached by api-client, not this prop).
  userId: string;
  onClose: () => void;
}

export function MapUploadWizard({ userId: _userId, onClose }: MapUploadWizardProps) {
  const [state, setState] = useState<MapWizardState>({
    step: 0, worldId: null, worldName: "",
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <Upload className="w-5 h-5" />
            Upload World Map
          </h3>
          <p className="text-sm text-muted-foreground">
            Upload your Azgaar&apos;s FMG export — Full JSON + optional SVG.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
      </div>

      <Card>
        <CardContent className="py-4">
          <div className="flex items-center gap-2 overflow-x-auto">
            {STEP_LABELS.map((label, i) => {
              const isDone = i < state.step;
              const isCurrent = i === state.step;
              return (
                <div key={label} className="flex items-center gap-1 shrink-0">
                  {isDone ? (
                    <CheckCircle className="w-4 h-4 text-green-500" />
                  ) : (
                    <Circle className={`w-4 h-4 ${isCurrent ? "text-primary" : "text-muted-foreground/40"}`} />
                  )}
                  <span className={`text-xs ${isCurrent ? "font-semibold text-primary" : isDone ? "text-green-600" : "text-muted-foreground"}`}>
                    {label}
                  </span>
                  {i < STEP_LABELS.length - 1 && (
                    <span className="text-muted-foreground/30 mx-1">&mdash;</span>
                  )}
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {state.step === 0 && (
        <FullJsonUploadStep
          onComplete={({ worldId, worldName }) =>
            setState({ step: 1, worldId, worldName })}
        />
      )}
      {state.step === 1 && state.worldId && (
        <SvgAttachStep
          worldId={state.worldId}
          onComplete={() => setState((p) => ({ ...p, step: 2 }))}
          onSkip={() => setState((p) => ({ ...p, step: 2 }))}
        />
      )}
      {state.step === 2 && state.worldId && (
        <ReviewStep worldId={state.worldId} onDone={onClose} />
      )}
    </div>
  );
}
