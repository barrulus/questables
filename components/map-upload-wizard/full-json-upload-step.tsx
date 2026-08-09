import { useEffect, useRef, useState } from "react";
import { Button } from "../ui/button";
import { Card, CardContent } from "../ui/card";
import { Progress } from "../ui/progress";

const STAGES = [
  "world", "biomes", "features", "cultures", "religions", "cells",
  "states", "provinces", "burgs", "rivers", "routes", "markers",
  "regiments", "campaigns", "diplomacy", "zones", "notes",
  "feature_geom", "culture_geom", "religion_geom", "state_geom", "province_geom",
];

interface FullJsonUploadStepProps {
  onComplete: (result: { worldId: string; worldName: string }) => void;
}

interface JobStatus {
  status: "queued" | "running" | "completed" | "failed";
  stage: string | null;
  percent: number;
  message: string | null;
  error: string | null;
  world_id: string | null;
}

export function FullJsonUploadStep({ onComplete }: FullJsonUploadStepProps) {
  const [file, setFile] = useState<File | null>(null);
  const [worldName, setWorldName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [worldId, setWorldId] = useState<string | null>(null);
  const [job, setJob] = useState<JobStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pollingRef = useRef<number | null>(null);
  const onCompleteRef = useRef(onComplete);
  const worldNameRef = useRef(worldName);

  useEffect(() => {
    onCompleteRef.current = onComplete;
  }, [onComplete]);

  useEffect(() => {
    worldNameRef.current = worldName;
  }, [worldName]);

  useEffect(() => {
    if (!jobId) return;
    const tick = async () => {
      try {
        const res = await fetch(`/api/upload/map/jobs/${jobId}`);
        if (!res.ok) throw new Error(`poll failed: ${res.status}`);
        const data: JobStatus = await res.json();
        setJob(data);
        if (data.status === "completed") {
          if (pollingRef.current) window.clearInterval(pollingRef.current);
          const finalWorldId = data.world_id ?? worldId;
          if (!finalWorldId) {
            setError("Import completed but no world ID returned");
          } else {
            onCompleteRef.current({ worldId: finalWorldId, worldName: worldNameRef.current });
          }
        } else if (data.status === "failed") {
          if (pollingRef.current) window.clearInterval(pollingRef.current);
          setError(data.error || "Import failed");
        }
      } catch (e) {
        setError((e as Error).message);
      }
    };
    void tick();
    pollingRef.current = window.setInterval(tick, 1000);
    return () => { if (pollingRef.current) window.clearInterval(pollingRef.current); };
  }, [jobId, worldId]);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!file) return;
    setError(null);
    setSubmitting(true);
    try {
      const fd = new FormData();
      fd.append("jsonFile", file);
      if (worldName) fd.append("worldName", worldName);
      const res = await fetch("/api/upload/map/full-json", { method: "POST", body: fd });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(body.error || `Upload failed: ${res.status}`);
      }
      const data: { worldId: string; jobId: string } = await res.json();
      setWorldId(data.worldId);
      setJobId(data.jobId);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const stageIndex = job?.stage ? STAGES.indexOf(job.stage) : -1;

  return (
    <Card>
      <CardContent className="py-6 space-y-4">
        <div>
          <h4 className="font-semibold">Step 1 of 3 — Upload FMG Full JSON</h4>
          <p className="text-sm text-muted-foreground">
            Export your map from Azgaar&apos;s Fantasy Map Generator as Full JSON.
            Drop the file here. Everything in the export is imported.
          </p>
        </div>

        {!jobId && (
          <form onSubmit={handleSubmit} className="space-y-3">
            <input
              type="text"
              placeholder="World name (optional — defaults to mapName in JSON)"
              value={worldName}
              onChange={(e) => setWorldName(e.target.value)}
              className="w-full border rounded px-3 py-2 text-sm"
              maxLength={200}
            />
            <input
              type="file"
              accept=".json,application/json"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="w-full text-sm"
            />
            <Button type="submit" disabled={!file || submitting}>
              {submitting ? "Uploading…" : "Upload Full JSON"}
            </Button>
          </form>
        )}

        {jobId && job && (
          <div className="space-y-3">
            <div className="text-sm">
              <span className="font-medium">Stage:</span>{" "}
              {job.stage ?? "queued"}{" "}
              {stageIndex >= 0 && (
                <span className="text-muted-foreground">
                  ({stageIndex + 1}/{STAGES.length})
                </span>
              )}
            </div>
            <Progress value={job.percent} />
            <div className="text-xs text-muted-foreground">{job.message}</div>
          </div>
        )}

        {error && (
          <div className="text-sm text-destructive border border-destructive/30 rounded px-3 py-2">
            {error}
            {worldId && (
              <div className="mt-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={async () => {
                    await fetch(`/api/upload/map/${worldId}`, { method: "DELETE" });
                    window.location.reload();
                  }}
                >
                  Roll back this world
                </Button>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
