# FMG Full JSON Import — Plan B: Frontend Wizard + Cleanup + Layers

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Hard prerequisite:** Plan A (backend pipeline) is shipped and merged. The endpoints `POST /api/upload/map/full-json`, `GET /api/upload/map/jobs/:jobId`, `DELETE /api/upload/map/:worldId`, and `POST /api/upload/map/:worldId/svg` (attach-to-existing-world variant) all return 2xx against the Jolliariana fixture.

**Goal:** Replace the 6-step per-layer wizard with a 3-step Full-JSON wizard, delete the obsolete per-layer endpoints and ingesters, surface the new polity / military data on the map via new OpenLayers layers + visibility toggles.

**Architecture:** New `FullJsonUploadStep` polls `GET /api/upload/map/jobs/:jobId` for stage-by-stage progress. The wizard parent's state machine collapses to `step ∈ {0,1,2}`: full-json → svg → review. Six new map layers (states, provinces, cultures, religions, zones polygons + regiments points) follow the existing `components/layers/*` factory pattern. The `MapDataLoader` singleton gets six matching loader methods. Six new `GET /api/maps/:worldId/<entity>` endpoints serve those loaders.

**Tech Stack:** React + Vite + TypeScript, OpenLayers (custom `QUESTABLES_PIXEL` projection), `MapDataLoader` singleton in `components/map-data-loader.tsx`.

**Spec:** [`docs/superpowers/specs/2026-05-22-fmg-full-json-import-design.md`](../specs/2026-05-22-fmg-full-json-import-design.md)

**Companion plan:** Plan A (backend) — `docs/superpowers/plans/2026-05-23-fmg-full-json-import-plan-a-backend.md`

---

## File structure

**New frontend files:**
```
components/map-upload-wizard/
  full-json-upload-step.tsx     // step 0: POST full-json + poll
  svg-attach-step.tsx           // step 1: POST :worldId/svg (replaces svg-upload-step's create flow)
  review-step.tsx               // step 2: review + activate (replaces wizard-summary)

components/layers/
  states.ts                     // VectorLayer for state polygons
  provinces.ts                  // VectorLayer for province polygons
  cultures.ts                   // VectorLayer for culture polygons
  religions.ts                  // VectorLayer for religion polygons
  zones.ts                      // VectorLayer for zone polygons
  regiments.ts                  // VectorLayer for regiment points
  index.ts                      // (modified) add the new exports
```

**New server endpoints (in `server/routes/maps.routes.js`):**
```
GET /api/maps/:worldId/states
GET /api/maps/:worldId/provinces
GET /api/maps/:worldId/cultures
GET /api/maps/:worldId/religions
GET /api/maps/:worldId/zones
GET /api/maps/:worldId/regiments
```

**Deleted files:**
```
components/map-upload-wizard/svg-upload-step.tsx         (replaced by svg-attach-step.tsx)
components/map-upload-wizard/layer-upload-step.tsx       (no longer used)
components/map-upload-wizard/wizard-summary.tsx          (replaced by review-step.tsx)
```

**Deleted server code:**
```
POST /api/upload/map/svg           (legacy create-via-SVG)
POST /api/upload/map/:worldId/layer (legacy per-layer)
in server/services/maps/ingestion-service.js:
  ingestCells, ingestBurgs, ingestRoutes, ingestRivers, ingestMarkers
  INGESTERS dispatcher table
  ingestLayer() public function
  any helpers used only by the above
```

**Modified files:**
```
components/map-upload-wizard/map-upload-wizard.tsx       (state machine: 3 steps)
components/map-data-loader.tsx                           (six new loader methods)
components/openlayers-map.tsx                            (wire six new layers + visibility)
components/maps/feature-tooltip.ts                       (hover/tooltip rules for new layers)
server/routes/maps.routes.js                             (six new GET endpoints)
server/routes/uploads.routes.js                          (remove deleted routes)
server/services/maps/ingestion-service.js                (remove deleted ingesters)
```

---

### Task 1: New `FullJsonUploadStep` with job polling

**Files:**
- Create: `components/map-upload-wizard/full-json-upload-step.tsx`

The user picks a Full JSON file, hits Upload, sees a stage-by-stage progress bar. On completion the parent advances to step 1 with the `worldId`.

- [ ] **Step 1: Write the component**

Write to `components/map-upload-wizard/full-json-upload-step.tsx`:

```tsx
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

  useEffect(() => () => {
    if (pollingRef.current) window.clearInterval(pollingRef.current);
  }, []);

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
          onComplete({ worldId: data.world_id!, worldName });
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
  }, [jobId, onComplete, worldName]);

  const handleSubmit = async (e: React.FormEvent) => {
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
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no new errors in `components/map-upload-wizard/`.

- [ ] **Step 3: Commit**

```bash
git add components/map-upload-wizard/full-json-upload-step.tsx
git commit -m "feat(wizard): add Full JSON upload step with job polling"
```

---

### Task 2: `SvgAttachStep` — attach SVG to an existing world

**Files:**
- Create: `components/map-upload-wizard/svg-attach-step.tsx`

Looks similar to the old `SvgUploadStep` but POSTs to `/api/upload/map/:worldId/svg` instead of creating a new world.

- [ ] **Step 1: Write the component**

Write to `components/map-upload-wizard/svg-attach-step.tsx`:

```tsx
import { useState } from "react";
import { Button } from "../ui/button";
import { Card, CardContent } from "../ui/card";

interface SvgAttachStepProps {
  worldId: string;
  onComplete: () => void;
  onSkip: () => void;
}

export function SvgAttachStep({ worldId, onComplete, onSkip }: SvgAttachStepProps) {
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) return;
    setError(null);
    setSubmitting(true);
    try {
      const fd = new FormData();
      fd.append("svgFile", file);
      const res = await fetch(`/api/upload/map/${worldId}/svg`, { method: "POST", body: fd });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(body.error || `Upload failed: ${res.status}`);
      }
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
            Export the SVG canvas from FMG to use as the rendered base map image.
            You can skip this and add it later.
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
```

- [ ] **Step 2: Commit**

```bash
git add components/map-upload-wizard/svg-attach-step.tsx
git commit -m "feat(wizard): add SVG attach step (replaces SvgUploadStep)"
```

---

### Task 3: `ReviewStep` — name + description edit, activate

**Files:**
- Create: `components/map-upload-wizard/review-step.tsx`

Final step. Lets the user edit name/description and mark the world `is_active = true`. There is no existing endpoint for that yet — add a small `PATCH /api/maps/world/:id` in this same task.

- [ ] **Step 1: Add the PATCH endpoint**

In `server/routes/maps.routes.js`, after the existing `GET /world/:id` handler (around line 74), add:

```js
router.patch('/world/:id', requireAuth, async (req, res) => {
  try {
    const { query } = await import('../db/pool.js');
    const updates = [];
    const params = [req.params.id];
    let p = 2;
    for (const key of ['name', 'description', 'is_active']) {
      if (req.body[key] !== undefined) {
        updates.push(`${key} = $${p++}`);
        params.push(req.body[key]);
      }
    }
    if (updates.length === 0) return res.json({ updated: 0 });
    const result = await query(
      `UPDATE public.maps_world SET ${updates.join(', ')}, updated_at = now()
        WHERE id = $1`,
      params,
      { label: 'maps.world.patch' },
    );
    res.json({ updated: result.rowCount });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
```

(Verify `requireAuth` is already imported at the top of `maps.routes.js`; if not, import it the same way the existing `router.post('/world', requireAuth, ...)` handler at line 34 does.)

- [ ] **Step 2: Write the component**

Write to `components/map-upload-wizard/review-step.tsx`:

```tsx
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
```

- [ ] **Step 3: Type-check + commit**

Run: `npx tsc --noEmit`. Expected: no errors.

```bash
git add components/map-upload-wizard/review-step.tsx server/routes/maps.routes.js
git commit -m "feat(wizard): add review-and-activate step + PATCH /api/maps/world/:id"
```

---

### Task 4: Rewrite the wizard parent for 3 steps

**Files:**
- Modify: `components/map-upload-wizard/map-upload-wizard.tsx`

Replace the 6-step state machine with a 3-step one. Use the new step components from Tasks 1–3.

- [ ] **Step 1: Replace the file**

Write to `components/map-upload-wizard/map-upload-wizard.tsx` (full file replace):

```tsx
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
  // though step components no longer need it (auth comes from cookies).
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
```

- [ ] **Step 2: Type-check + commit**

Run: `npx tsc --noEmit`. Expected: no errors.

```bash
git add components/map-upload-wizard/map-upload-wizard.tsx
git commit -m "feat(wizard): collapse to 3-step Full JSON flow"
```

---

### Task 5: Delete obsolete wizard step files

**Files:**
- Delete: `components/map-upload-wizard/svg-upload-step.tsx`
- Delete: `components/map-upload-wizard/layer-upload-step.tsx`
- Delete: `components/map-upload-wizard/wizard-summary.tsx`

- [ ] **Step 1: Confirm nothing else imports these**

Run:
```bash
grep -rn "svg-upload-step\|layer-upload-step\|wizard-summary\|SvgUploadStep\|LayerUploadStep\|WizardSummary" components/ tests/ 2>/dev/null
```
Expected: only matches inside `map-upload-wizard.tsx` (now removed) and possibly the deleted files themselves. If any other module still imports these, STOP and migrate the callers before deleting.

- [ ] **Step 2: Delete the files**

```bash
git rm components/map-upload-wizard/svg-upload-step.tsx components/map-upload-wizard/layer-upload-step.tsx components/map-upload-wizard/wizard-summary.tsx
```

- [ ] **Step 3: Type-check + commit**

Run: `npx tsc --noEmit`. Expected: no errors.

```bash
git commit -m "chore(wizard): remove obsolete per-layer step components"
```

---

### Task 6: Delete obsolete upload routes

**Files:**
- Modify: `server/routes/uploads.routes.js`

Remove the legacy `POST /api/upload/map/svg` (creator) and `POST /api/upload/map/:worldId/layer` handlers. The new SVG attach route from Plan A Task 32 stays.

- [ ] **Step 1: Read the file and delete the two handlers**

Read `server/routes/uploads.routes.js` around the legacy SVG route (line 179–225) and the legacy layer route (line 228–272). Delete both handler blocks plus any imports that become unused (the `extractMetersPerPixel`, `updateWorldMetersPerPixel`, `ingestLayer`, `parseSvgDimensions` imports are likely now dead).

- [ ] **Step 2: Spot-check for orphan imports**

Run:
```bash
node -c server/routes/uploads.routes.js
```
Expected: no syntax error. If a removed import is still referenced, ESLint or `tsc --noEmit` will catch it.

- [ ] **Step 3: Smoke test 410-on-old-route**

The spec acceptance criterion says "old per-layer endpoints return 410 Gone (or are removed entirely)". Removal IS the acceptance condition — a 404 is fine. Confirm:

```bash
curl -sI -X POST http://localhost:3001/api/upload/map/svg | head -1
curl -sI -X POST http://localhost:3001/api/upload/map/00000000-0000-0000-0000-000000000000/layer | head -1
```
Expected: HTTP/1.1 404.

- [ ] **Step 4: Commit**

```bash
git add server/routes/uploads.routes.js
git commit -m "chore(routes): remove legacy per-layer + SVG-creator endpoints"
```

---

### Task 7: Delete obsolete ingesters in `ingestion-service.js`

**Files:**
- Modify: `server/services/maps/ingestion-service.js`

Remove `ingestCells`, `ingestBurgs`, `ingestRoutes`, `ingestRivers`, `ingestMarkers`, the `INGESTERS` dispatcher, `VALID_LAYER_TYPES`, and the public `ingestLayer()` function. Keep `createOrUpdateWorld()`, `parseSvgDimensions()`, `extractMetersPerPixel` (re-export), `getWorldIngestionStatus()`, `updateWorldMetersPerPixel()`, and `ingestBurgEntrancesForWorldIfReady()` — those are still used by the new pipeline + UI.

- [ ] **Step 1: Remove the obsolete code**

Read `server/services/maps/ingestion-service.js`. Identify the function blocks above and remove them. The dispatcher (line 348 `const INGESTERS = …`) and `ingestLayer()` (line 350) both go away. Several helper functions (e.g. for parsing GeoJSON features) used only by the deleted ingesters can also be removed — grep for usages before removing each one:

```bash
grep -n "parseGeometry\|extractFeatureProps\|buildBurgRow" server/services/maps/ingestion-service.js
```

- [ ] **Step 2: Lint + type-check**

Run:
```bash
node -c server/services/maps/ingestion-service.js
npx tsc --noEmit
npx jest tests/maps/ --listTests
```
Expected: no syntax errors; existing fmg-scale tests still listed; no broken imports.

- [ ] **Step 3: Commit**

```bash
git add server/services/maps/ingestion-service.js
git commit -m "chore(maps): remove legacy per-layer ingesters from ingestion-service"
```

---

### Task 8: Six new GET endpoints for polity + military layers

**Files:**
- Modify: `server/routes/maps.routes.js`

Each endpoint returns a GeoJSON FeatureCollection (matching the format the existing `:worldId/burgs`, `:worldId/markers`, etc. endpoints return). The MapDataLoader consumes that via OL's `GeoJSON` format.

- [ ] **Step 1: Add the six handlers**

In `server/routes/maps.routes.js`, after the existing `GET /:worldId/cells` handler (line 250), append:

```js
function geojsonRow(geomColumn, propsColumns, table, idColumn) {
  return `
    SELECT json_build_object(
      'type', 'FeatureCollection',
      'features', COALESCE(json_agg(
        json_build_object(
          'type', 'Feature',
          'id', ${idColumn},
          'geometry', ST_AsGeoJSON(${geomColumn})::json,
          'properties', json_build_object(${propsColumns})
        )
      ), '[]'::json)
    ) AS fc
    FROM public.${table}
    WHERE world_id = $1 AND ${geomColumn} IS NOT NULL
  `;
}

router.get('/:worldId/states', async (req, res) => {
  try {
    const { query } = await import('../db/pool.js');
    const sql = geojsonRow('geom', `
      'state_id', state_id, 'name', name, 'full_name', full_name,
      'form', form, 'color', color, 'type', type,
      'culture', culture, 'religion', religion,
      'capital_burg_id', capital_burg_id, 'area', area,
      'pole_x', pole_x, 'pole_y', pole_y
    `, 'maps_states', 'state_id');
    const { rows } = await query(sql, [req.params.worldId], { label: 'maps.states.list' });
    res.json(rows[0].fc);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/:worldId/provinces', async (req, res) => {
  try {
    const { query } = await import('../db/pool.js');
    const sql = geojsonRow('geom', `
      'province_id', province_id, 'name', name, 'full_name', full_name,
      'form_name', form_name, 'color', color,
      'state_id', state_id, 'burg_id', burg_id
    `, 'maps_provinces', 'province_id');
    const { rows } = await query(sql, [req.params.worldId], { label: 'maps.provinces.list' });
    res.json(rows[0].fc);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/:worldId/cultures', async (req, res) => {
  try {
    const { query } = await import('../db/pool.js');
    const sql = geojsonRow('geom', `
      'culture_id', culture_id, 'name', name, 'code', code,
      'color', color, 'type', type, 'expansionism', expansionism
    `, 'maps_cultures', 'culture_id');
    const { rows } = await query(sql, [req.params.worldId], { label: 'maps.cultures.list' });
    res.json(rows[0].fc);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/:worldId/religions', async (req, res) => {
  try {
    const { query } = await import('../db/pool.js');
    const sql = geojsonRow('geom', `
      'religion_id', religion_id, 'name', name, 'code', code,
      'color', color, 'type', type, 'form', form,
      'deity', deity, 'culture', culture
    `, 'maps_religions', 'religion_id');
    const { rows } = await query(sql, [req.params.worldId], { label: 'maps.religions.list' });
    res.json(rows[0].fc);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/:worldId/zones', async (req, res) => {
  try {
    const { query } = await import('../db/pool.js');
    const sql = geojsonRow('geom', `
      'zone_id', zone_id, 'name', name, 'type', type, 'color', color
    `, 'maps_zones', 'zone_id');
    const { rows } = await query(sql, [req.params.worldId], { label: 'maps.zones.list' });
    res.json(rows[0].fc);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/:worldId/regiments', async (req, res) => {
  try {
    const { query } = await import('../db/pool.js');
    const sql = geojsonRow('geom', `
      'regiment_id', regiment_id, 'state_id', state_id, 'name', name,
      'icon', icon, 'total_men', total_men,
      'u_infantry', u_infantry, 'u_archers', u_archers,
      'u_cavalry', u_cavalry, 'u_artillery', u_artillery, 'u_fleet', u_fleet
    `, 'maps_regiments', 'regiment_id');
    const { rows } = await query(sql, [req.params.worldId], { label: 'maps.regiments.list' });
    res.json(rows[0].fc);
  } catch (err) { res.status(500).json({ error: err.message }); }
});
```

- [ ] **Step 2: Smoke test**

After Plan A's e2e import has populated a world:
```bash
curl -s "http://localhost:3001/api/maps/<worldId>/states" | jq '.features | length'
curl -s "http://localhost:3001/api/maps/<worldId>/regiments" | jq '.features | length'
```
Expected: 26 and 484 against the Jolliariana fixture.

- [ ] **Step 3: Commit**

```bash
git add server/routes/maps.routes.js
git commit -m "feat(maps): GET endpoints for states/provinces/cultures/religions/zones/regiments"
```

---

### Task 9: Six new `MapDataLoader` methods

**Files:**
- Modify: `components/map-data-loader.tsx`

Each method fetches GeoJSON, parses with OL's `GeoJSON` format using `QUESTABLES_PIXEL`, returns `Feature[]`. Read the existing `loadBurgs` implementation (line 113 per memory) and follow that exact pattern.

- [ ] **Step 1: Add the methods**

In `components/map-data-loader.tsx`, immediately after `loadBurgs()` (around line 113), add:

```ts
async loadStates(worldMapId: string): Promise<Feature[]> {
  return this.fetchGeojson(`/api/maps/${worldMapId}/states`);
}
async loadProvinces(worldMapId: string): Promise<Feature[]> {
  return this.fetchGeojson(`/api/maps/${worldMapId}/provinces`);
}
async loadCultures(worldMapId: string): Promise<Feature[]> {
  return this.fetchGeojson(`/api/maps/${worldMapId}/cultures`);
}
async loadReligions(worldMapId: string): Promise<Feature[]> {
  return this.fetchGeojson(`/api/maps/${worldMapId}/religions`);
}
async loadZones(worldMapId: string): Promise<Feature[]> {
  return this.fetchGeojson(`/api/maps/${worldMapId}/zones`);
}
async loadRegiments(worldMapId: string): Promise<Feature[]> {
  return this.fetchGeojson(`/api/maps/${worldMapId}/regiments`);
}
```

If `MapDataLoader` doesn't already have a `fetchGeojson` helper, hoist the shared fetch+parse logic out of `loadBurgs()` first into a private method:

```ts
private async fetchGeojson(url: string): Promise<Feature[]> {
  const res = await fetch(url);
  if (!res.ok) return [];
  const data = await res.json();
  return this.readGeometry(data);
}
```

(`this.readGeometry` is the existing GeoJSON-format reader — see memory: "MapDataLoader methods use this.readGeometry()".)

- [ ] **Step 2: Type-check + commit**

Run: `npx tsc --noEmit`. Expected: no errors.

```bash
git add components/map-data-loader.tsx
git commit -m "feat(map-loader): add states/provinces/cultures/religions/zones/regiments loaders"
```

---

### Task 10: Six new layer factories

**Files:**
- Create: `components/layers/states.ts`
- Create: `components/layers/provinces.ts`
- Create: `components/layers/cultures.ts`
- Create: `components/layers/religions.ts`
- Create: `components/layers/zones.ts`
- Create: `components/layers/regiments.ts`
- Modify: `components/layers/index.ts`

Polygon layers all share a "fill with feature.color + thin outline" style. Regiments are point markers with the emoji icon + total-men label.

- [ ] **Step 1: Add a shared polity style helper**

Add to `components/maps/questables-style-factory.ts` (or a new file `components/maps/polity-style.ts` if you prefer separation — match the file's existing extension pattern):

```ts
import Fill from "ol/style/Fill";
import Stroke from "ol/style/Stroke";
import Style from "ol/style/Style";
import type Feature from "ol/Feature";
import type Geometry from "ol/geom/Geometry";

const DEFAULT_COLOR = "#888";

export function createPolityStyle(
  alpha: number,
  strokeColor = "rgba(0,0,0,0.4)",
  strokeWidth = 0.75,
) {
  return (feature: Feature<Geometry>): Style => {
    const raw = feature.get("color");
    const color = typeof raw === "string" && raw.trim() ? raw : DEFAULT_COLOR;
    return new Style({
      fill: new Fill({ color: hexToRgba(color, alpha) }),
      stroke: new Stroke({ color: strokeColor, width: strokeWidth }),
    });
  };
}

function hexToRgba(hex: string, alpha: number): string {
  // accepts #RGB, #RRGGBB; falls through unchanged for non-hex (e.g. url(#hatch))
  if (!/^#[0-9a-f]{3,6}$/i.test(hex)) return hex;
  const h = hex.length === 4
    ? hex.slice(1).split("").map((c) => c + c).join("")
    : hex.slice(1);
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}
```

- [ ] **Step 2: Write the layer factories**

Write to `components/layers/states.ts`:

```ts
import VectorLayer from "ol/layer/Vector";
import VectorSource from "ol/source/Vector";
import { createPolityStyle } from "../maps/questables-style-factory";
import type { GeometryLayer } from "./types";

export const createStatesLayer = ({ visible }: { visible: boolean }): GeometryLayer =>
  new VectorLayer({
    source: new VectorSource({ wrapX: false }),
    style: createPolityStyle(0.35, "rgba(0,0,0,0.6)", 1.5),
    visible,
  });
```

Write to `components/layers/provinces.ts`:

```ts
import VectorLayer from "ol/layer/Vector";
import VectorSource from "ol/source/Vector";
import { createPolityStyle } from "../maps/questables-style-factory";
import type { GeometryLayer } from "./types";

export const createProvincesLayer = ({ visible }: { visible: boolean }): GeometryLayer =>
  new VectorLayer({
    source: new VectorSource({ wrapX: false }),
    style: createPolityStyle(0.2, "rgba(0,0,0,0.3)", 0.5),
    visible,
  });
```

Write to `components/layers/cultures.ts`:

```ts
import VectorLayer from "ol/layer/Vector";
import VectorSource from "ol/source/Vector";
import { createPolityStyle } from "../maps/questables-style-factory";
import type { GeometryLayer } from "./types";

export const createCulturesLayer = ({ visible }: { visible: boolean }): GeometryLayer =>
  new VectorLayer({
    source: new VectorSource({ wrapX: false }),
    style: createPolityStyle(0.25, "rgba(40,40,40,0.4)", 0.5),
    visible,
  });
```

Write to `components/layers/religions.ts`:

```ts
import VectorLayer from "ol/layer/Vector";
import VectorSource from "ol/source/Vector";
import { createPolityStyle } from "../maps/questables-style-factory";
import type { GeometryLayer } from "./types";

export const createReligionsLayer = ({ visible }: { visible: boolean }): GeometryLayer =>
  new VectorLayer({
    source: new VectorSource({ wrapX: false }),
    style: createPolityStyle(0.25, "rgba(80,40,40,0.4)", 0.5),
    visible,
  });
```

Write to `components/layers/zones.ts`:

```ts
import VectorLayer from "ol/layer/Vector";
import VectorSource from "ol/source/Vector";
import Fill from "ol/style/Fill";
import Stroke from "ol/style/Stroke";
import Style from "ol/style/Style";
import type { GeometryLayer } from "./types";

export const createZonesLayer = ({ visible }: { visible: boolean }): GeometryLayer =>
  new VectorLayer({
    source: new VectorSource({ wrapX: false }),
    style: new Style({
      fill: new Fill({ color: "rgba(255,200,0,0.18)" }),
      stroke: new Stroke({ color: "rgba(180,140,0,0.7)", width: 1.5, lineDash: [4, 4] }),
    }),
    visible,
  });
```

Write to `components/layers/regiments.ts`:

```ts
import type Feature from "ol/Feature";
import type Geometry from "ol/geom/Geometry";
import VectorLayer from "ol/layer/Vector";
import VectorSource from "ol/source/Vector";
import Style from "ol/style/Style";
import Text from "ol/style/Text";
import Fill from "ol/style/Fill";
import Stroke from "ol/style/Stroke";
import type { GeometryLayer } from "./types";

export const createRegimentsLayer = ({ visible }: { visible: boolean }): GeometryLayer =>
  new VectorLayer({
    source: new VectorSource({ wrapX: false }),
    style: (feat) => {
      const f = feat as Feature<Geometry>;
      const icon = (f.get("icon") as string) || "[R]";
      const men = (f.get("total_men") as number) || 0;
      return new Style({
        text: new Text({
          text: `${icon}\n${men.toLocaleString()}`,
          font: "bold 11px sans-serif",
          fill: new Fill({ color: "#fff" }),
          stroke: new Stroke({ color: "#000", width: 3 }),
          textAlign: "center",
          textBaseline: "middle",
        }),
      });
    },
    visible,
  });
```

- [ ] **Step 3: Re-export from `index.ts`**

Append to `components/layers/index.ts`:

```ts
export { createStatesLayer } from "./states";
export { createProvincesLayer } from "./provinces";
export { createCulturesLayer } from "./cultures";
export { createReligionsLayer } from "./religions";
export { createZonesLayer } from "./zones";
export { createRegimentsLayer } from "./regiments";
```

- [ ] **Step 4: Type-check + commit**

Run: `npx tsc --noEmit`. Expected: no errors.

```bash
git add components/layers/states.ts components/layers/provinces.ts components/layers/cultures.ts components/layers/religions.ts components/layers/zones.ts components/layers/regiments.ts components/layers/index.ts components/maps/questables-style-factory.ts
git commit -m "feat(layers): add states/provinces/cultures/religions/zones/regiments layers"
```

---

### Task 11: Wire the new layers into `openlayers-map.tsx`

**Files:**
- Modify: `components/openlayers-map.tsx`

Each new layer needs:
1. A layer instance created alongside the existing burg/route/marker layers
2. Inclusion in the OL `Map` layer stack
3. A `MapDataLoader` call inside the world-data-loading effect that populates its source
4. An entry in the `layerVisibility` state (which becomes one toggle per layer in the UI)

Read `openlayers-map.tsx` first — particularly the section around the existing `mapDataLoader.loadBurgs(...)` call (line 1405 per the grep result earlier) and the layer construction block above it — to confirm the exact patterns. Memory warns about `this`-binding when extracting `mapDataLoader` methods as callbacks: use arrow wrappers like `(id) => mapDataLoader.loadStates(id)`.

- [ ] **Step 1: Add layer instances**

Near where `createBurgsLayer` is called, add (using the same `resolveZoom` / `visible` patterns):

```ts
const statesLayer = createStatesLayer({ visible: layerVisibility.states ?? true });
const provincesLayer = createProvincesLayer({ visible: layerVisibility.provinces ?? false });
const culturesLayer = createCulturesLayer({ visible: layerVisibility.cultures ?? false });
const religionsLayer = createReligionsLayer({ visible: layerVisibility.religions ?? false });
const zonesLayer = createZonesLayer({ visible: layerVisibility.zones ?? false });
const regimentsLayer = createRegimentsLayer({ visible: layerVisibility.regiments ?? false });
```

Add them to the OL Map's `layers` array AFTER `burgsLayer` so political polygons sit above terrain but below labels.

- [ ] **Step 2: Extend `layerVisibility` state shape**

Find the existing `useState` (or similar) for layer visibility — likely a `Record<string, boolean>`. Add keys: `states`, `provinces`, `cultures`, `religions`, `zones`, `regiments`. Default values: states=true, all others=false (since cultures/religions overlap states visually and zones are noise).

Update the `layerVisibilityRef` mirror (per memory: cascade refresh prevention) so the loader effect reads the ref, not the state directly.

- [ ] **Step 3: Add loader calls in the world-data-loading effect**

In the same Promise.all block where `loadBurgs` is called (around line 1405), add the new loaders gated on visibility:

```ts
if (layerVisibilityRef.current.states) {
  promises.push(mapDataLoader.loadStates(selectedWorldMap).then((feats) => {
    statesLayer.getSource()?.clear();
    statesLayer.getSource()?.addFeatures(feats);
  }));
}
if (layerVisibilityRef.current.provinces) {
  promises.push(mapDataLoader.loadProvinces(selectedWorldMap).then((feats) => {
    provincesLayer.getSource()?.clear();
    provincesLayer.getSource()?.addFeatures(feats);
  }));
}
if (layerVisibilityRef.current.cultures) {
  promises.push(mapDataLoader.loadCultures(selectedWorldMap).then((feats) => {
    culturesLayer.getSource()?.clear();
    culturesLayer.getSource()?.addFeatures(feats);
  }));
}
if (layerVisibilityRef.current.religions) {
  promises.push(mapDataLoader.loadReligions(selectedWorldMap).then((feats) => {
    religionsLayer.getSource()?.clear();
    religionsLayer.getSource()?.addFeatures(feats);
  }));
}
if (layerVisibilityRef.current.zones) {
  promises.push(mapDataLoader.loadZones(selectedWorldMap).then((feats) => {
    zonesLayer.getSource()?.clear();
    zonesLayer.getSource()?.addFeatures(feats);
  }));
}
if (layerVisibilityRef.current.regiments) {
  promises.push(mapDataLoader.loadRegiments(selectedWorldMap).then((feats) => {
    regimentsLayer.getSource()?.clear();
    regimentsLayer.getSource()?.addFeatures(feats);
  }));
}
```

Per memory: "New OpenLayers layers degrade gracefully when their API returns empty (existing layer-visibility ref pattern)." For older worlds without these tables populated, `loadStates(...)` returns `[]` and the layer stays empty — no error in the UI.

- [ ] **Step 4: Add visibility toggles to the layer-control UI**

Find the existing JSX block that renders one toggle per layer (search for "layerVisibility\[" in the JSX of `openlayers-map.tsx`). Add six more toggles using the same component pattern. Label them: "States", "Provinces", "Cultures", "Religions", "Zones", "Regiments".

- [ ] **Step 5: Type-check, run app, eyeball-verify**

Run:
```bash
npx tsc --noEmit
npm run dev
```

Open the app, switch to the Jolliariana world (imported by Plan A's e2e). Toggle each new layer on and confirm: state polygons appear coloured per `pack.states[].color`; provinces nest inside states; cultures span multiple states; religion colours differ from cultures; zones show with the dashed yellow outline; regiment icons appear at the state-army positions with men-counts under them.

For UI changes per CLAUDE.md: "start the dev server and use the feature in a browser before reporting the task as complete."

- [ ] **Step 6: Commit**

```bash
git add components/openlayers-map.tsx
git commit -m "feat(map): wire new polity + regiment layers with visibility toggles"
```

---

### Task 12: Hover/tooltip support for new layers

**Files:**
- Modify: `components/maps/feature-tooltip.ts`

Per memory, `feature-tooltip.ts` is the shared hover/tooltip util used by both map components. Add cases for the new layer feature types so hovering reveals state/province/culture/religion/zone names and regiment composition.

- [ ] **Step 1: Read the current tooltip dispatcher**

Read `components/maps/feature-tooltip.ts`. Find the switch (or chain of `if` blocks) that picks a tooltip renderer from a feature's properties.

- [ ] **Step 2: Add the new cases**

Add tooltip rendering rules. Match on a property that's only present on each new layer type — e.g. `feature.get('state_id') != null` for states, `feature.get('regiment_id') != null` for regiments:

```ts
if (feature.get('state_id') != null && feature.get('regiment_id') == null) {
  const name = feature.get('full_name') || feature.get('name');
  return `<strong>${escapeHtml(name)}</strong>`;
}
if (feature.get('province_id') != null) {
  return `<strong>${escapeHtml(feature.get('full_name') || feature.get('name'))}</strong>`;
}
if (feature.get('culture_id') != null) {
  return `<strong>${escapeHtml(feature.get('name'))}</strong> <span class="text-xs">(culture)</span>`;
}
if (feature.get('religion_id') != null) {
  const deity = feature.get('deity');
  return `<strong>${escapeHtml(feature.get('name'))}</strong>${deity ? `<br/><em>${escapeHtml(deity)}</em>` : ''}`;
}
if (feature.get('zone_id') != null) {
  return `<strong>${escapeHtml(feature.get('name'))}</strong> <span class="text-xs">(${escapeHtml(feature.get('type'))})</span>`;
}
if (feature.get('regiment_id') != null) {
  const u = ['u_infantry','u_archers','u_cavalry','u_artillery','u_fleet']
    .map((k) => [k.replace('u_',''), feature.get(k)])
    .filter(([, v]) => v && v > 0)
    .map(([k, v]) => `${k}: ${v}`).join(', ');
  return `<strong>${escapeHtml(feature.get('name'))}</strong><br/>${escapeHtml(u)}`;
}
```

Pick where in the existing dispatcher these go — order matters because a regiment also has a `state_id`. The `regiment_id != null` check must come BEFORE the `state_id` check, or use the `regiment_id == null` guard shown above.

- [ ] **Step 3: Manual verify + commit**

Hover each layer in the dev app. Confirm tooltips appear and read correctly.

```bash
git add components/maps/feature-tooltip.ts
git commit -m "feat(map): hover tooltips for new polity + regiment layers"
```

---

### Task 13: Regression check — existing pre-cutover maps still render

**Files:**
- (No new files — verification.)

The spec acceptance criterion: "Existing pre-cutover maps continue to load and render in the world map view without modification." Plan A made no destructive change to existing burg/route/cell/river/marker data, and Plan B's new layers degrade to empty when their tables are empty for a given world.

- [ ] **Step 1: Pick an existing pre-cutover world**

Run:
```bash
psql -U barrulus -d questables -c "SELECT id, name, created_at FROM public.maps_world ORDER BY created_at DESC LIMIT 5;"
```

Pick a world created BEFORE the Plan A migration date.

- [ ] **Step 2: Verify counts on new tables are 0**

```bash
psql -U barrulus -d questables -c "SELECT 'states' AS t, COUNT(*) FROM maps_states WHERE world_id = '<id>' UNION ALL SELECT 'regiments', COUNT(*) FROM maps_regiments WHERE world_id = '<id>';"
```
Expected: both 0.

- [ ] **Step 3: Open the world in the app**

`npm run dev`, switch to that world. Confirm:
- Burgs still render
- Routes still render
- Markers still render
- Toggling on the new layers (states / provinces / etc.) does NOT throw — sources are just empty
- No console errors

- [ ] **Step 4: Commit (none — no code change)**

This is a verification step. If anything broke, file follow-up tasks before declaring the plan done.

---

### Task 14: Push and announce

- [ ] **Step 1: Push**

```bash
git push -u origin main
```

- [ ] **Step 2: Update memory**

Per `auto memory` rules, save a project memory marking Plan B shipped. Suggested entry:

- file: `~/.claude/projects/-home-barrulus-dev-questables/memory/project_fmg_full_json_shipped.md`
- type: `project`
- body: short note that Plans A + B both shipped, link to spec, note Jolliariana e2e is green.

Add a line to `MEMORY.md` pointing at it.

---

## Self-review checklist

**Spec coverage (Plan B):**
- ✅ §Wizard — Tasks 1–4 (full-json upload, svg attach, review, parent rewrite).
- ✅ §Files removed — Tasks 5 (wizard steps), 6 (routes), 7 (ingesters).
- ✅ §Layer rendering updates — Tasks 8 (endpoints), 9 (loader), 10 (factories), 11 (wiring), 12 (tooltips).
- ✅ §Acceptance: "Existing pre-cutover maps continue to load" — Task 13.
- ✅ §Acceptance: "Old per-layer endpoints return 410 Gone (or are removed entirely)" — Task 6 removes them (returns 404, which the spec accepts as equivalent).

**Type / signature consistency:**
- Step components all take a thin `onComplete` / `onSkip` contract — same shape across Tasks 1, 2, 3.
- All layer factories follow `(opts: { visible: boolean }) → GeometryLayer` — checked across Task 10.
- All new `MapDataLoader` methods take `(worldMapId: string) → Promise<Feature[]>` — checked in Task 9.
- All new GET endpoints share the `geojsonRow(...)` helper — checked in Task 8.

**Placeholder scan:**
- No "TBD" / "implement later" left.
- Every step has either code or a runnable shell command.

---

## Out of scope (this plan)

- Reading `maps_notes` into the LLM lore system (explicitly deferred per spec).
- Lon/lat reprojection from `maps_world.map_coordinates`.
- Tile rendering of polity layers (these are vector overlays, not raster tiles).
- The legacy `parseSvgDimensions`/`extractMetersPerPixel` helpers stay in `ingestion-service.js` — they're harmless and `extractMetersPerPixel` is re-exported. A future cleanup can remove them when nothing imports them.
- Replaying the old per-layer wizard's "skip layer" UX in the new flow — the new flow has no per-layer skip because everything is in one file.
