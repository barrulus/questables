-- 005_action_status_extension.sql
-- Add 'processing' and 'failed' to session_player_actions.status.
--
-- 'processing' = the player has submitted a roll result and the server is
--                re-invoking the LLM to resolve the outcome. Distinct from
--                'awaiting_roll' (waiting for the player to roll) and
--                'resolved' (LLM done, narration written).
--
-- 'failed'     = the LLM call or DB update threw and the action could not
--                be resolved. Distinct from 'cancelled' (player explicitly
--                cancelled before submission).

ALTER TABLE public.session_player_actions
  DROP CONSTRAINT IF EXISTS session_player_actions_status_check;

ALTER TABLE public.session_player_actions
  ADD CONSTRAINT session_player_actions_status_check
  CHECK (status IN ('pending', 'processing', 'awaiting_roll', 'resolved', 'cancelled', 'failed'));
