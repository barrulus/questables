const VALID_KINDS = new Set(['state', 'province', 'burg']);

export async function upsertCoa(client, worldId, ownerKind, ownerId, coa) {
  if (!VALID_KINDS.has(ownerKind)) throw new Error(`invalid owner_kind: ${ownerKind}`);
  if (!coa || typeof coa !== 'object') return;
  await client.query(
    `INSERT INTO public.maps_coats_of_arms
       (world_id, owner_kind, owner_id, shield, t1, division, ordinaries, charges)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (world_id, owner_kind, owner_id) DO UPDATE SET
       shield = EXCLUDED.shield, t1 = EXCLUDED.t1,
       division = EXCLUDED.division, ordinaries = EXCLUDED.ordinaries,
       charges = EXCLUDED.charges`,
    [
      worldId, ownerKind, ownerId,
      coa.shield ?? null, coa.t1 ?? null,
      coa.division ? JSON.stringify(coa.division) : null,
      Array.isArray(coa.ordinaries) ? JSON.stringify(coa.ordinaries) : null,
      Array.isArray(coa.charges) ? JSON.stringify(coa.charges) : null,
    ],
  );
}
