-- 004_scene_tracking.sql
-- Add per-player current scene and per-NPC scene tag for sub-location tracking.
-- Lets the system distinguish "outdoors in Dure" from "inside Kael's cottage"
-- so NPCs don't bleed across rooms.

ALTER TABLE public.campaign_players
  ADD COLUMN IF NOT EXISTS current_scene TEXT;

ALTER TABLE public.npcs
  ADD COLUMN IF NOT EXISTS scene_tag TEXT;

CREATE INDEX IF NOT EXISTS idx_npcs_scene_tag ON public.npcs(scene_tag) WHERE scene_tag IS NOT NULL;
