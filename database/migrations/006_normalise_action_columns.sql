-- 006_normalise_action_columns.sql
--
-- Converges public.session_player_actions to its canonical shape, undoing
-- the drift between schema.sql, 001_llm_dm_pivot.sql, and 005_action_status_extension.sql.
--
-- Canonical shape (post-migration):
--   - column:  action_payload  (not action_data)
--   - status:  pending, processing, awaiting_roll, resolved, cancelled, failed
--              (server code writes 'resolved', NOT 'completed')
--   - FKs:     both user_id and player_id are present
--   - indexes: idx_spa_session_id, idx_spa_campaign_id, idx_spa_user_session, idx_spa_status
--
-- This migration is idempotent and safe to apply against either of the two
-- known historical shapes (the schema.sql shape or the 001 shape).

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Rename action_data → action_payload if needed
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'session_player_actions'
      AND column_name = 'action_data'
  ) AND EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'session_player_actions'
      AND column_name = 'action_payload'
  ) THEN
    RAISE EXCEPTION
      'session_player_actions has BOTH action_data and action_payload — manual reconciliation required before running 006';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'session_player_actions'
      AND column_name = 'action_data'
  ) THEN
    ALTER TABLE public.session_player_actions RENAME COLUMN action_data TO action_payload;
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Make sure both user_id and player_id exist
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.session_player_actions
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES public.user_profiles(id);

ALTER TABLE public.session_player_actions
  ADD COLUMN IF NOT EXISTS player_id UUID REFERENCES public.campaign_players(id) ON DELETE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Normalise the status check constraint
--
-- Drop ANY existing CHECK constraint on the status column (the constraint
-- name may differ between the schema.sql shape and the 001/005 shape), then
-- migrate legacy 'completed' rows to 'resolved' and add the canonical constraint.
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  con_name TEXT;
BEGIN
  FOR con_name IN
    SELECT conname
      FROM pg_constraint
     WHERE conrelid = 'public.session_player_actions'::regclass
       AND contype  = 'c'
       AND pg_get_constraintdef(oid) ILIKE '%status%'
  LOOP
    EXECUTE format('ALTER TABLE public.session_player_actions DROP CONSTRAINT %I', con_name);
  END LOOP;
END $$;

UPDATE public.session_player_actions
   SET status = 'resolved'
 WHERE status = 'completed';

ALTER TABLE public.session_player_actions
  ADD CONSTRAINT session_player_actions_status_check
  CHECK (status IN ('pending', 'processing', 'awaiting_roll', 'resolved', 'cancelled', 'failed'));

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Canonical indexes
-- ─────────────────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_spa_session_id
  ON public.session_player_actions (session_id);
CREATE INDEX IF NOT EXISTS idx_spa_campaign_id
  ON public.session_player_actions (campaign_id);
CREATE INDEX IF NOT EXISTS idx_spa_user_session
  ON public.session_player_actions (user_id, session_id);
CREATE INDEX IF NOT EXISTS idx_spa_status
  ON public.session_player_actions (status)
  WHERE status IN ('pending', 'processing', 'awaiting_roll');

COMMIT;
