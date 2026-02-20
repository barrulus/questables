import { useState } from "react";
import { Card, CardContent } from "../ui/card";
import { Button } from "../ui/button";
import { CheckCircle, Circle, Upload } from "lucide-react";
import { SvgUploadStep } from "./svg-upload-step";
import { LayerUploadStep } from "./layer-upload-step";
import { WizardSummary } from "./wizard-summary";

type LayerStatus = "pending" | "uploading" | "complete" | "skipped" | "error";

interface LayerResult {
  rowCount: number;
  status: LayerStatus;
}

interface MapWizardState {
  step: number;
  worldId: string | null;
  worldName: string;
  description: string;
  dimensions: { width: number; height: number } | null;
  metersPerPixel: number | null;
  layerResults: Record<string, LayerResult>;
}

const LAYER_STEPS = [
  { type: "cells" as const, label: "Cells", description: "Terrain and biome cell polygons" },
  { type: "burgs" as const, label: "Burgs", description: "Towns, cities, and settlements" },
  { type: "routes" as const, label: "Routes", description: "Roads, trails, and sea routes" },
  { type: "rivers" as const, label: "Rivers", description: "Rivers and waterways" },
  { type: "markers" as const, label: "Markers", description: "Points of interest and map markers" },
];

const STEP_LABELS = ["SVG Map", ...LAYER_STEPS.map((l) => l.label), "Summary"];

interface MapUploadWizardProps {
  userId: string;
  onClose: () => void;
}

export function MapUploadWizard({ userId, onClose }: MapUploadWizardProps) {
  const [state, setState] = useState<MapWizardState>({
    step: 0,
    worldId: null,
    worldName: "",
    description: "",
    dimensions: null,
    metersPerPixel: null,
    layerResults: Object.fromEntries(
      LAYER_STEPS.map((l) => [l.type, { rowCount: 0, status: "pending" as LayerStatus }])
    ),
  });

  const handleSvgComplete = (result: {
    worldId: string;
    name: string;
    width: number;
    height: number;
    metersPerPixel: number | null;
  }) => {
    setState((prev) => ({
      ...prev,
      step: 1,
      worldId: result.worldId,
      worldName: result.name,
      dimensions: { width: result.width, height: result.height },
      metersPerPixel: result.metersPerPixel,
    }));
  };

  const handleLayerComplete = (layerType: string, rowCount: number) => {
    setState((prev) => ({
      ...prev,
      step: prev.step + 1,
      layerResults: {
        ...prev.layerResults,
        [layerType]: { rowCount, status: "complete" as LayerStatus },
      },
    }));
  };

  const handleLayerSkip = (layerType: string) => {
    setState((prev) => ({
      ...prev,
      step: prev.step + 1,
      layerResults: {
        ...prev.layerResults,
        [layerType]: { rowCount: 0, status: "skipped" as LayerStatus },
      },
    }));
  };

  const currentLayerIndex = state.step - 1;
  const isSummaryStep = state.step === LAYER_STEPS.length + 1;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <Upload className="w-5 h-5" />
            Upload World Map
          </h3>
          <p className="text-sm text-muted-foreground">
            Upload your Azgaar&apos;s FMG exports step by step.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={onClose}>
          Cancel
        </Button>
      </div>

      {/* Step progress */}
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
                    <Circle
                      className={`w-4 h-4 ${isCurrent ? "text-primary" : "text-muted-foreground/40"}`}
                    />
                  )}
                  <span
                    className={`text-xs ${
                      isCurrent ? "font-semibold text-primary" : isDone ? "text-green-600" : "text-muted-foreground"
                    }`}
                  >
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

      {/* Step content */}
      {state.step === 0 && (
        <SvgUploadStep userId={userId} onComplete={handleSvgComplete} />
      )}

      {state.step >= 1 && !isSummaryStep && state.worldId && (
        <LayerUploadStep
          key={LAYER_STEPS[currentLayerIndex].type}
          worldId={state.worldId}
          layerType={LAYER_STEPS[currentLayerIndex].type}
          label={LAYER_STEPS[currentLayerIndex].label}
          description={LAYER_STEPS[currentLayerIndex].description}
          onComplete={(result) => handleLayerComplete(LAYER_STEPS[currentLayerIndex].type, result.rowCount)}
          onSkip={() => handleLayerSkip(LAYER_STEPS[currentLayerIndex].type)}
        />
      )}

      {isSummaryStep && (
        <WizardSummary
          worldName={state.worldName}
          dimensions={state.dimensions}
          metersPerPixel={state.metersPerPixel}
          layerResults={state.layerResults}
          onDone={onClose}
        />
      )}
    </div>
  );
}
