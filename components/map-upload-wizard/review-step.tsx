import { useEffect, useState } from "react";
import { Button } from "../ui/button";
import { Card, CardContent } from "../ui/card";

interface WorldSummary {
  id: string;
  name: string;
  description: string | null;
  width_pixels: number;
  height_pixels: number;
}

interface ReviewStepProps {
  worldId: string;
  onDone: () => void;
}

export function ReviewStep({ worldId, onDone }: ReviewStepProps) {
  const [world, setWorld] = useState<WorldSummary | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [error, setError] = useState<string | null>(null);
  const [activating, setActivating] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const [w, c] = await Promise.all([
          fetch(`/api/maps/world/${worldId}`).then((r) => r.json()),
          fetch(`/api/maps/world/${worldId}/status`).then((r) => r.json()),
        ]);
        setWorld(w);
        setCounts(c);
      } catch (e) {
        setError((e as Error).message);
      }
    })();
  }, [worldId]);

  const handleActivate = async () => {
    if (!world) return;
    setActivating(true);
    try {
      const res = await fetch(`/api/maps/world/${worldId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: world.name,
          description: world.description,
          is_active: true,
        }),
      });
      if (!res.ok) throw new Error(`Activate failed: ${res.status}`);
      onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setActivating(false);
    }
  };

  if (!world) return <div>Loading…</div>;

  return (
    <Card>
      <CardContent className="py-6 space-y-4">
        <div>
          <h4 className="font-semibold">Step 3 of 3 — Review &amp; activate</h4>
        </div>

        <div className="space-y-3">
          <label className="block text-sm">
            <span className="font-medium">Name</span>
            <input
              type="text"
              value={world.name}
              onChange={(e) => setWorld({ ...world, name: e.target.value })}
              className="w-full border rounded px-3 py-2 text-sm"
              maxLength={200}
            />
          </label>
          <label className="block text-sm">
            <span className="font-medium">Description</span>
            <textarea
              value={world.description ?? ""}
              onChange={(e) => setWorld({ ...world, description: e.target.value })}
              className="w-full border rounded px-3 py-2 text-sm"
              rows={3}
            />
          </label>
          <div className="text-sm">
            <span className="font-medium">Imported counts:</span>
            <ul className="ml-4 list-disc text-muted-foreground">
              {Object.entries(counts).map(([k, v]) => (
                <li key={k}>{k}: {v.toLocaleString()}</li>
              ))}
            </ul>
          </div>
          <div className="text-xs text-muted-foreground">
            Dimensions: {world.width_pixels} × {world.height_pixels} px
          </div>
        </div>

        <Button onClick={handleActivate} disabled={activating}>
          {activating ? "Activating…" : "Activate world"}
        </Button>
        {error && <div className="text-sm text-destructive">{error}</div>}
      </CardContent>
    </Card>
  );
}
