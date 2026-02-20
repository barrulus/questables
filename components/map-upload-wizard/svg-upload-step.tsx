import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Alert, AlertDescription } from "../ui/alert";
import { Loader2, Upload } from "lucide-react";
import { apiFetch, readErrorMessage, readJsonBody } from "../../utils/api-client";

interface SvgUploadStepProps {
  userId: string;
  onComplete: (result: {
    worldId: string;
    name: string;
    width: number;
    height: number;
    metersPerPixel: number | null;
  }) => void;
}

export function SvgUploadStep({ userId, onComplete }: SvgUploadStepProps) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [metersPerPixel, setMetersPerPixel] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (!name.trim()) {
      setError("Map name is required");
      return;
    }
    if (!file) {
      setError("Please select an SVG file");
      return;
    }

    setUploading(true);
    setError(null);

    try {
      const formData = new FormData();
      formData.append("svgFile", file);
      formData.append("name", name.trim());
      if (description.trim()) formData.append("description", description.trim());
      if (metersPerPixel.trim()) formData.append("metersPerPixel", metersPerPixel.trim());
      formData.append("uploaded_by", userId);

      const response = await apiFetch("/api/upload/map/svg", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const message = await readErrorMessage(response, "SVG upload failed");
        throw new Error(message);
      }

      const result = await readJsonBody<{
        worldId: string;
        name: string;
        width: number;
        height: number;
        metersPerPixel: number | null;
      }>(response);

      onComplete(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Upload className="w-4 h-4" />
          Step 1: Upload SVG Map
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="map-name">Map Name *</Label>
          <Input
            id="map-name"
            placeholder="e.g. Azgaar World"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={uploading}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="map-description">Description</Label>
          <Input
            id="map-description"
            placeholder="Optional description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            disabled={uploading}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="map-mpp">Meters per Pixel</Label>
          <Input
            id="map-mpp"
            type="number"
            step="any"
            placeholder="Will be extracted from GeoJSON if not provided"
            value={metersPerPixel}
            onChange={(e) => setMetersPerPixel(e.target.value)}
            disabled={uploading}
          />
          <p className="text-xs text-muted-foreground">
            Leave blank to extract automatically from GeoJSON metadata.
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="svg-file">SVG File *</Label>
          <div
            className={`border-2 border-dashed rounded-lg p-6 text-center transition-colors ${
              file ? "border-green-500/50 bg-green-500/5" : "border-muted-foreground/25 hover:border-muted-foreground/50"
            } ${uploading ? "pointer-events-none opacity-50" : "cursor-pointer"}`}
            onClick={() => !uploading && document.getElementById("svg-file-input")?.click()}
          >
            {file ? (
              <p className="text-sm">{file.name} ({(file.size / 1024).toFixed(1)} KB)</p>
            ) : (
              <div className="flex flex-col items-center gap-2">
                <Upload className="w-8 h-8 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">
                  Click to select SVG file (e.g. world_states.svg)
                </p>
              </div>
            )}
            <input
              id="svg-file-input"
              type="file"
              accept="image/svg+xml,.svg"
              className="hidden"
              onChange={(e) => {
                const selected = e.target.files?.[0];
                if (selected) setFile(selected);
              }}
              disabled={uploading}
            />
          </div>
        </div>

        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <Button onClick={handleSubmit} disabled={uploading || !name.trim() || !file} className="w-full">
          {uploading ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Uploading...
            </>
          ) : (
            "Upload SVG & Create World"
          )}
        </Button>
      </CardContent>
    </Card>
  );
}
