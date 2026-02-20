import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";
import { Button } from "../ui/button";
import { Loader2, MapIcon, Plus } from "lucide-react";
import { apiFetch, readJsonBody } from "../../utils/api-client";

interface WorldMap {
  id: string;
  name: string;
  description: string | null;
  width_pixels: number | null;
  height_pixels: number | null;
  meters_per_pixel: number | null;
  created_at: string;
  uploaded_by_username: string | null;
}

interface MapListProps {
  onUploadNew: () => void;
}

export function MapList({ onUploadNew }: MapListProps) {
  const [maps, setMaps] = useState<WorldMap[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchMaps = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await apiFetch("/api/maps/world");
      if (!response.ok) throw new Error("Failed to load maps");
      const data = await readJsonBody<WorldMap[]>(response);
      setMaps(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load maps");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchMaps();
  }, [fetchMaps]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">World Maps</h3>
          <p className="text-sm text-muted-foreground">
            Manage your uploaded world maps and feature layers.
          </p>
        </div>
        <Button onClick={onUploadNew} className="flex items-center gap-2">
          <Plus className="w-4 h-4" />
          Upload New Map
        </Button>
      </div>

      {loading && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      )}

      {error && (
        <Card>
          <CardContent className="py-6 text-center text-sm text-destructive">
            {error}
          </CardContent>
        </Card>
      )}

      {!loading && !error && maps.length === 0 && (
        <Card>
          <CardContent className="py-12 text-center">
            <MapIcon className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
            <p className="text-sm text-muted-foreground">
              No world maps uploaded yet. Click &quot;Upload New Map&quot; to get started.
            </p>
          </CardContent>
        </Card>
      )}

      {!loading && maps.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {maps.map((map) => (
            <Card key={map.id}>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">{map.name}</CardTitle>
                {map.description && (
                  <CardDescription className="line-clamp-2">{map.description}</CardDescription>
                )}
              </CardHeader>
              <CardContent className="text-xs text-muted-foreground space-y-1">
                {map.width_pixels != null && map.height_pixels != null && (
                  <div>{map.width_pixels} &times; {map.height_pixels} px</div>
                )}
                {map.meters_per_pixel != null && (
                  <div>{map.meters_per_pixel} m/px</div>
                )}
                <div>Created {new Date(map.created_at).toLocaleDateString()}</div>
                {map.uploaded_by_username && (
                  <div>By {map.uploaded_by_username}</div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
