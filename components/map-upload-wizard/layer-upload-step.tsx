import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { Button } from "../ui/button";
import { Alert, AlertDescription } from "../ui/alert";
import { CheckCircle, Loader2, Upload, SkipForward } from "lucide-react";
import { apiFetch, readErrorMessage, readJsonBody } from "../../utils/api-client";

interface LayerUploadStepProps {
  worldId: string;
  layerType: "cells" | "burgs" | "routes" | "rivers" | "markers";
  label: string;
  description: string;
  onComplete: (result: { rowCount: number }) => void;
  onSkip: () => void;
}

export function LayerUploadStep({
  worldId,
  layerType,
  label,
  description,
  onComplete,
  onSkip,
}: LayerUploadStepProps) {
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ rowCount: number } | null>(null);

  const handleUpload = async () => {
    if (!file) return;

    setUploading(true);
    setError(null);

    try {
      const formData = new FormData();
      formData.append("geojsonFile", file);
      formData.append("layerType", layerType);

      const response = await apiFetch(`/api/upload/map/${worldId}/layer`, {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const message = await readErrorMessage(response, "Layer upload failed");
        throw new Error(message);
      }

      const data = await readJsonBody<{ rowCount: number }>(response);
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const handleContinue = () => {
    if (result) onComplete(result);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Upload className="w-4 h-4" />
          Upload {label} Layer
        </CardTitle>
        <p className="text-sm text-muted-foreground">{description}</p>
      </CardHeader>
      <CardContent className="space-y-4">
        {!result ? (
          <>
            <div
              className={`border-2 border-dashed rounded-lg p-6 text-center transition-colors ${
                file ? "border-green-500/50 bg-green-500/5" : "border-muted-foreground/25 hover:border-muted-foreground/50"
              } ${uploading ? "pointer-events-none opacity-50" : "cursor-pointer"}`}
              onClick={() => !uploading && document.getElementById(`layer-file-${layerType}`)?.click()}
            >
              {file ? (
                <p className="text-sm">{file.name} ({(file.size / 1024).toFixed(1)} KB)</p>
              ) : (
                <div className="flex flex-col items-center gap-2">
                  <Upload className="w-8 h-8 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">
                    Click to select {label.toLowerCase()} GeoJSON file
                  </p>
                  <p className="text-xs text-muted-foreground">
                    e.g. world_{layerType}.geojson
                  </p>
                </div>
              )}
              <input
                id={`layer-file-${layerType}`}
                type="file"
                accept="application/json,.geojson,.json"
                className="hidden"
                onChange={(e) => {
                  const selected = e.target.files?.[0];
                  if (selected) setFile(selected);
                }}
                disabled={uploading}
              />
            </div>

            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <div className="flex gap-2">
              <Button
                onClick={handleUpload}
                disabled={uploading || !file}
                className="flex-1"
              >
                {uploading ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Uploading {label}...
                  </>
                ) : (
                  `Upload ${label}`
                )}
              </Button>
              <Button variant="outline" onClick={onSkip} disabled={uploading}>
                <SkipForward className="w-4 h-4 mr-1" />
                Skip
              </Button>
            </div>
          </>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center gap-3 p-4 bg-green-500/10 rounded-lg">
              <CheckCircle className="w-6 h-6 text-green-500 shrink-0" />
              <div>
                <p className="font-medium text-sm">
                  {label} layer uploaded successfully
                </p>
                <p className="text-xs text-muted-foreground">
                  {result.rowCount.toLocaleString()} features imported
                </p>
              </div>
            </div>
            <Button onClick={handleContinue} className="w-full">
              Continue
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
