-- 015_npc_source_message.sql
--
-- Mirrors migration 014 for the npcs table. Auto-generated NPCs created
-- by extractAndPersistNpcs are linked back to the chat_messages row they
-- were extracted from, with ON DELETE CASCADE so deleting a hallucinated
-- narration also clears the NPCs it spawned. Manual NPCs (created via UI
-- or API) leave source_message_id NULL and are unaffected by deletions.
--
-- Tradeoff worth knowing: we only track the FIRST narration as source.
-- An NPC repeatedly referenced in later narrations and then orphaned by
-- deleting the original message will vanish — fine for our sole-user
-- testing window; revisit before opening signups.
--
-- Idempotent.

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'npcs'
      AND column_name = 'source_message_id'
  ) THEN
    ALTER TABLE public.npcs
      ADD COLUMN source_message_id UUID
        REFERENCES public.chat_messages(id) ON DELETE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_npcs_source_message
  ON public.npcs (source_message_id)
  WHERE source_message_id IS NOT NULL;

COMMIT;
