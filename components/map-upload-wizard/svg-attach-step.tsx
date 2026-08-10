import { useState } from "react";
import { Button } from "../ui/button";
import { Card, CardContent } from "../ui/card";
import { apiFetch } from "../../utils/api-client";
import { mapDataLoader } from "../map-data-loader";

interface SvgAttachStepProps {
  worldId: string;
  onComplete: () => void;
  onSkip: () => void;
}

export function SvgAttachStep({ worldId, onComplete, onSkip }: SvgAttachStepProps) {
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!file) return;
    setError(null);
    setSubmitting(true);
    try {
      const fd = new FormData();
      fd.append("svgFile", file);
      const res = await apiFetch(`/api/upload/map/${worldId}/svg`, { method: "POST", body: fd });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(body.message || body.error || `Upload failed: ${res.status}`);
      }
      mapDataLoader.clearTileSetCache();
      onComplete();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Card>
      <CardContent className="py-6 space-y-4">
        <div>
          <h4 className="font-semibold">Step 2 of 3 — Upload rendered SVG (optional)</h4>
          <p className="text-sm text-muted-foreground">
            Export the SVG canvas from FMG. Used as the rendered base map —
            tiles are generated on demand as you view the map.
            You can skip this and add it later from the Maps tab.
          </p>
        </div>
        <form onSubmit={handleSubmit} className="space-y-3">
          <input
            type="file"
            accept=".svg,image/svg+xml"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="w-full text-sm"
          />
          <div className="flex gap-2">
            <Button type="submit" disabled={!file || submitting}>
              {submitting ? "Uploading…" : "Upload SVG"}
            </Button>
            <Button type="button" variant="outline" onClick={onSkip}>Skip</Button>
          </div>
        </form>
        {error && (
          <div className="text-sm text-destructive border border-destructive/30 rounded px-3 py-2">
            {error}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
