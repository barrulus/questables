-- 014_lore_source_message.sql
--
-- Adds provenance from campaign_world_lore back to the chat_messages row
-- it was extracted from. ON DELETE CASCADE so deleting a narration in
-- chat also removes the lore facts derived from it — the prior model
-- left orphaned facts that kept poisoning future prompts even after the
-- Campaign Director deleted the message that spawned them.
--
-- Idempotent.

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'campaign_world_lore'
      AND column_name = 'source_message_id'
  ) THEN
    ALTER TABLE public.campaign_world_lore
      ADD COLUMN source_message_id UUID
        REFERENCES public.chat_messages(id) ON DELETE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_campaign_world_lore_source_message
  ON public.campaign_world_lore (source_message_id)
  WHERE source_message_id IS NOT NULL;

COMMIT;
