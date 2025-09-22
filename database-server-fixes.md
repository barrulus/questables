# database-server.js fixes

Here’s exactly what to change so it matches the SRID-0 schema and naming we just locked in.

# Must-fixs (will 500)

1. ## World-routes endpoint hits the wrong table/column

You renamed the world routes layer to `public.maps_routes` with geometry column `geom`. The code queries `routes` and `route_path`.

**Change `/api/maps/:worldId/routes` handler:**

```diff
- let query = 'SELECT * FROM routes WHERE world_id = $1';
+ let query = `
+   SELECT 
+     id, world_id, route_id, name, type, feature,
+     ST_AsGeoJSON(geom)::json AS geometry
+   FROM maps_routes WHERE world_id = $1`;
...
- query += ` AND ST_Intersects(route_path, ST_MakeEnvelope($2, $3, $4, $5, 0))`;
+ query += ` AND ST_Intersects(geom, ST_MakeEnvelope($2, $3, $4, $5, 0))`;
```

2. ## Burgs “bounds” query selects non-existent columns

Schema uses `x_px`, `y_px` (not `xworld/xpixel/ypixel`). Return geometry as GeoJSON (you already do that).

**In `get_burgs_in_bounds` switch:**

```diff
-            xworld,
-            yworld,
-            xpixel,
-            ypixel,
+            x_px,
+            y_px,
```

3. ## Map upload writes `file_size` (column no longer exists)

Schema has `file_size_bytes BIGINT`.

**In `/api/upload/map`:**

```diff
- INSERT INTO maps_world (..., bounds, uploaded_by, file_size)
- VALUES (..., $6)
+ INSERT INTO maps_world (..., bounds, uploaded_by, file_size_bytes)
+ VALUES (..., $6)
```

4. **NPC relationships upsert conflicts on the wrong unique key**
   Schema unique is `(npc_id, target_type, target_id)`.

**In `POST /api/npcs/:npcId/relationships`:**

```diff
- ON CONFLICT (npc_id, target_id) DO UPDATE SET
+ ON CONFLICT (npc_id, target_type, target_id) DO UPDATE SET
```

5. **NPC narrative route uses an undefined variable**
   `derivedInteraction` is referenced but only defined inside `persistNarrative`. Use the local `deriveNpcInteraction(...)` result you already compute.

**In `/narratives/npc` handler:**
Right before `const narrativeRecord = ...`, add:

```js
const derivedInteraction = npcId
  ? deriveNpcInteraction({ result: generation.result, interaction, metadata })
  : null;
```

…and then keep the existing uses of `derivedInteraction`.

# Should-fixs (correct but confusing / easy footguns)

6. ## Spatial function parameter names (lat/lng vs x/y)

We moved to SRID-0, so functions take `(x, y, radius)` in **units of your map**, not km. Your router still forwards `{ lat, lng, radius_km }`. It’s fine numerically (positionals match), but confusing.

**In the spatial function router:**

```diff
- queryParams = [params.world_map_id, params.lat, params.lng, params.radius_km];
+ queryParams = [
+   params.world_map_id,
+   (params.x ?? params.lng ?? params.lon ?? params.lat), // be permissive
+   (params.y ?? params.lat ?? params.latY),              // be permissive
+   (params.radius ?? params.radius_units ?? params.radius_km) // document units
+ ];
```

Also update your client(s)/docs to say `x,y,radius` (SRID-0 units).

7. ## World-burgs endpoint uses `ST_Within` (overly strict)

Keep it if you want only fully contained burgs; most map UIs expect intersects.

```diff
- AND ST_Within(geom, ST_MakeEnvelope($2, $3, $4, $5, 0))
+ AND ST_Intersects(geom, ST_MakeEnvelope($2, $3, $4, $5, 0))
```

8. ## Campaign “assets” writes to a column the schema doesn’t have

Your schema doesn’t define `campaigns.assets`. Either add that column (easiest), or change these endpoints to a dedicated `campaign_assets` table. If you want to keep the endpoints unchanged, add the column:

```sql
ALTER TABLE public.campaigns
  ADD COLUMN IF NOT EXISTS assets JSONB DEFAULT '[]'::jsonb;
```

(If you prefer a table, tell me and I’ll drop in the DDL + minimal code changes.)

# Nice-to-have consistency

9. ## World-burgs/-rivers endpoints: always return GeoJSON

You already do it for rivers; match burgs too (you do in the bounds variant—good). For consistency, do the same in `/api/maps/:worldId/burgs` when `bounds` isn’t provided.

10. ## CITEXT on username/email doesn’t require code changes

Your login/register code is fine; CITEXT will do case-insensitive compare. Leave it.

11. ## SRID-0 everywhere—keep your ST\_MakeEnvelope/Point calls with `, 0`

You already do that (good). Avoid `::geography` casts (none present here).


