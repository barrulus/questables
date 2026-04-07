import { useEffect, useState } from "react";
import { useGameSession } from "../contexts/GameSessionContext";
import { useUser } from "../contexts/UserContext";
import { apiFetch, readJsonBody } from "../utils/api-client";

/**
 * The acting user's character in the active campaign.
 *
 * Pulls from `/api/campaigns/:id/characters` (which returns every character
 * in the campaign joined with their `campaign_players` row) and picks the
 * one whose `campaign_user_id` matches the logged-in user.
 *
 * Carries the static character sheet — abilities, skills, saving throws,
 * proficiency bonus, level — that the runtime `LiveStateContext` does not.
 */
export interface MyCharacter {
  id: string;
  name: string;
  class: string;
  level: number;
  proficiency_bonus: number;
  abilities: Record<string, number>;
  /**
   * Skill proficiencies/modifiers as written by `stats-engine.js`:
   *   { "stealth": { modifier: 5, proficient: true, ability: "dexterity" }, ... }
   * Skill keys are lowercase, with spaces ("animal handling", "sleight of hand").
   */
  skills: Record<string, { modifier?: number; proficient?: boolean; ability?: string }>;
  /**
   * Saving throw modifiers as written by `stats-engine.js`:
   *   { "strength": { modifier: 3, proficient: true }, ... }
   */
  saving_throws: Record<string, { modifier?: number; proficient?: boolean }>;
}

interface CampaignCharacterRow extends MyCharacter {
  campaign_user_id: string;
}

export function useMyCharacter(): MyCharacter | null {
  const { user } = useUser();
  const { activeCampaignId } = useGameSession();
  const [character, setCharacter] = useState<MyCharacter | null>(null);

  useEffect(() => {
    if (!user || !activeCampaignId) {
      setCharacter(null);
      return;
    }

    const controller = new AbortController();
    (async () => {
      try {
        const response = await apiFetch(
          `/api/campaigns/${activeCampaignId}/characters`,
          { signal: controller.signal },
        );
        if (!response.ok) return;
        const rows = await readJsonBody<CampaignCharacterRow[]>(response);
        const mine = rows?.find((row) => row.campaign_user_id === user.id) ?? null;
        setCharacter(mine);
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        console.error("[useMyCharacter] fetch failed:", error);
      }
    })();

    return () => controller.abort();
  }, [user, activeCampaignId]);

  return character;
}
