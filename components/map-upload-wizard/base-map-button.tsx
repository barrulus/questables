import { useRef, useState } from "react";
import { Button } from "../ui/button";
import { apiFetch } from "../../utils/api-client";
import { mapDataLoader } from "../map-data-loader";

interface BaseMapButtonProps {
  worldId: string;
  hasBaseMap: boolean;
  onUploaded: () => void;
}

/**
 * "Add base map" / "Replace base map" action on a world card. POSTs the
 * picked SVG to the same route as the wizard's SvgAttachStep; the server
 * upserts the world's tileset row and purges stale tiles.
 */
export function BaseMapButton({ worldId, hasBaseMap, onUploaded }: BaseMapButtonProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null;
    e.target.value = "";
    if (!file) return;
    setError(null);
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("svgFile", file);
      const res = await apiFetch(`/api/upload/map/${worldId}/svg`, { method: "POST", body: fd });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(body.message || body.error || `Upload failed: ${res.status}`);
      }
      mapDataLoader.clearTileSetCache();
      onUploaded();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-1">
      <input
        ref={inputRef}
        type="file"
        accept=".svg,image/svg+xml"
        className="hidden"
        onChange={handleChange}
      />
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={busy}
        onClick={() => inputRef.current?.click()}
      >
        {busy ? "Uploading…" : hasBaseMap ? "Replace base map" : "Add base map"}
      </Button>
      {error && <div className="text-xs text-destructive">{error}</div>}
    </div>
  );
}
