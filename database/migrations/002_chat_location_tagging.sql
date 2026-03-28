-- Migration: Chat Location Tagging
-- Tags chat messages with the sender's location at time of sending.
-- Enables location-aware history: "what happened here last time?"

BEGIN;

-- Add location columns to chat_messages
ALTER TABLE public.chat_messages
  ADD COLUMN IF NOT EXISTS loc_x DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS loc_y DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS inside_burg_id UUID REFERENCES public.maps_burgs(id) ON DELETE SET NULL;

-- Index for spatial queries on chat history ("what was said near this location?")
CREATE INDEX IF NOT EXISTS idx_chat_messages_location
  ON public.chat_messages (campaign_id, loc_x, loc_y)
  WHERE loc_x IS NOT NULL;

-- Index for burg-specific chat history
CREATE INDEX IF NOT EXISTS idx_chat_messages_burg
  ON public.chat_messages (campaign_id, inside_burg_id)
  WHERE inside_burg_id IS NOT NULL;

COMMIT;
