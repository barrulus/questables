import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { Button } from "../ui/button";
import { Badge } from "../ui/badge";
import { CheckCircle, SkipForward, MapIcon } from "lucide-react";

interface LayerResult {
  rowCount: number;
  status: string;
}

interface WizardSummaryProps {
  worldName: string;
  dimensions: { width: number; height: number } | null;
  metersPerPixel: number | null;
  layerResults: Record<string, LayerResult>;
  onDone: () => void;
}

const LAYER_LABELS: Record<string, string> = {
  cells: "Cells",
  burgs: "Burgs",
  routes: "Routes",
  rivers: "Rivers",
  markers: "Markers",
};

export function WizardSummary({
  worldName,
  dimensions,
  metersPerPixel,
  layerResults,
  onDone,
}: WizardSummaryProps) {
  const totalFeatures = Object.values(layerResults).reduce(
    (sum, r) => sum + (r.status === "complete" ? r.rowCount : 0),
    0
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <MapIcon className="w-4 h-4" />
          Upload Complete
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="p-4 bg-green-500/10 rounded-lg space-y-2">
          <div className="flex items-center gap-2">
            <CheckCircle className="w-5 h-5 text-green-500" />
            <span className="font-semibold">{worldName}</span>
          </div>
          {dimensions && (
            <p className="text-sm text-muted-foreground ml-7">
              {dimensions.width} &times; {dimensions.height} px
              {metersPerPixel != null && ` @ ${metersPerPixel} m/px`}
            </p>
          )}
          <p className="text-sm text-muted-foreground ml-7">
            {totalFeatures.toLocaleString()} total features imported
          </p>
        </div>

        <div className="space-y-2">
          <h4 className="text-sm font-medium">Layer Summary</h4>
          <div className="divide-y">
            {Object.entries(layerResults).map(([type, result]) => (
              <div key={type} className="flex items-center justify-between py-2">
                <span className="text-sm">{LAYER_LABELS[type] ?? type}</span>
                {result.status === "complete" ? (
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-muted-foreground">
                      {result.rowCount.toLocaleString()} features
                    </span>
                    <Badge variant="secondary" className="text-green-600">
                      Done
                    </Badge>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <SkipForward className="w-3 h-3 text-muted-foreground" />
                    <Badge variant="outline">Skipped</Badge>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        <Button onClick={onDone} className="w-full">
          Done
        </Button>
      </CardContent>
    </Card>
  );
}
