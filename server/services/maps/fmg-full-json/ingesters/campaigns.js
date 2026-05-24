export async function ingestCampaigns(client, worldId, parsed, log) {
  log(0, 'Campaigns');
  const states = parsed.pack?.states || [];
  let count = 0;
  for (const s of states) {
    if (!s || !Array.isArray(s.campaigns)) continue;
    for (let idx = 0; idx < s.campaigns.length; idx++) {
      const c = s.campaigns[idx];
      await client.query(
        `INSERT INTO public.maps_campaigns
          (world_id, state_id, campaign_index, name, start_year, end_year,
           attacker, defender)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (world_id, state_id, campaign_index) DO UPDATE SET
           name=EXCLUDED.name, start_year=EXCLUDED.start_year,
           end_year=EXCLUDED.end_year, attacker=EXCLUDED.attacker,
           defender=EXCLUDED.defender`,
        [
          worldId, s.i, idx, c.name ?? null,
          c.start ?? null, c.end ?? null,
          c.attacker ?? null, c.defender ?? null,
        ],
      );
      count++;
    }
  }
  log(100, `${count} campaigns`);
  return { rowCount: count };
}
