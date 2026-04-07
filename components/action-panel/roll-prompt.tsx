import { useEffect, useState } from "react";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Dice5 } from "lucide-react";
import type { RollRequest, RollSubmission } from "../../contexts/ActionContext";
import { useMyCharacter, type MyCharacter } from "../../hooks/useMyCharacter";
import { SKILL_TO_ABILITY } from "../../utils/srd/constants";

interface RollPromptProps {
  rollRequest: RollRequest;
  onSubmit: (roll: RollSubmission) => void;
  disabled?: boolean;
}

const ROLL_TYPE_LABELS: Record<string, string> = {
  ability_check: "Ability Check",
  saving_throw: "Saving Throw",
  attack_roll: "Attack Roll",
  skill_check: "Skill Check",
};

const ABILITY_ALIASES: Record<string, string> = {
  str: "strength", strength: "strength",
  dex: "dexterity", dexterity: "dexterity",
  con: "constitution", constitution: "constitution",
  int: "intelligence", intelligence: "intelligence",
  wis: "wisdom", wisdom: "wisdom",
  cha: "charisma", charisma: "charisma",
};

const normalizeAbility = (raw: string | null | undefined): string | null => {
  if (!raw) return null;
  return ABILITY_ALIASES[raw.trim().toLowerCase()] ?? null;
};

const abilityModifier = (score: number | undefined): number =>
  Math.floor(((score ?? 10) - 10) / 2);

/**
 * Compute the appropriate modifier for an awaiting roll given the character.
 * Returns null if there's no character or the roll has no ability/skill hint —
 * in that case the player keeps the empty input and types a value manually.
 */
function computeAutoModifier(
  character: MyCharacter | null,
  roll: RollRequest["requiredRolls"][number],
): number | null {
  if (!character) return null;

  // Skill check — prefer the precomputed skill modifier on the sheet.
  if (roll.skill) {
    const skillKey = roll.skill.trim().toLowerCase();
    const stored = character.skills?.[skillKey];
    if (stored && typeof stored.modifier === "number") return stored.modifier;
    // Fallback: compute from ability table.
    const ability = SKILL_TO_ABILITY[skillKey];
    if (ability) return abilityModifier(character.abilities?.[ability]);
  }

  // Saving throw — prefer the precomputed save modifier.
  if (roll.rollType === "saving_throw" && roll.ability) {
    const ability = normalizeAbility(roll.ability);
    if (!ability) return null;
    const stored = character.saving_throws?.[ability];
    if (stored && typeof stored.modifier === "number") return stored.modifier;
    return abilityModifier(character.abilities?.[ability]);
  }

  // Plain ability check.
  if (roll.ability) {
    const ability = normalizeAbility(roll.ability);
    if (!ability) return null;
    return abilityModifier(character.abilities?.[ability]);
  }

  return null;
}

export function RollPrompt({ rollRequest, onSubmit, disabled }: RollPromptProps) {
  const character = useMyCharacter();
  const [total, setTotal] = useState<number>(0);
  const [natural, setNatural] = useState<number>(0);
  const [modifier, setModifier] = useState<number>(0);
  const [autoFilled, setAutoFilled] = useState(false);

  const roll = rollRequest.requiredRolls[0];

  // Auto-fill the modifier from the character sheet whenever the roll request
  // changes or the character finishes loading. The player can still overwrite
  // it by typing in the Modifier input.
  useEffect(() => {
    if (!roll) return;
    const auto = computeAutoModifier(character, roll);
    if (auto !== null) {
      setModifier(auto);
      setAutoFilled(true);
    } else {
      setAutoFilled(false);
    }
  }, [character, roll]);

  if (!roll) return null;

  const handleSubmit = () => {
    onSubmit({
      total: total || natural + modifier,
      natural,
      modifier,
      rollType: roll.rollType,
      ability: roll.ability ?? undefined,
      skill: roll.skill ?? undefined,
    });
  };

  const rollD20 = () => {
    const result = Math.floor(Math.random() * 20) + 1;
    setNatural(result);
    setTotal(0); // recompute from natural + modifier
  };

  const computedTotal = total || natural + modifier;
  const passes = natural > 0 && computedTotal >= roll.dc;

  return (
    <div className="rounded-lg border bg-card p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Dice5 className="h-5 w-5 text-primary" />
        <h4 className="font-semibold text-sm">Roll Required</h4>
      </div>

      <div className="text-sm text-muted-foreground">
        <p className="font-medium">
          {ROLL_TYPE_LABELS[roll.rollType] || roll.rollType}
          {roll.ability && ` (${roll.ability})`}
          {roll.skill && ` — ${roll.skill}`}
        </p>
        {roll.description && <p className="mt-1">{roll.description}</p>}
        <p className="mt-1 text-xs">DC: {roll.dc}</p>
      </div>

      <p className="text-xs text-muted-foreground">
        Click <span className="font-medium">Roll d20</span> to roll the die.
        {autoFilled
          ? " Your modifier is filled in from your character sheet — adjust it if needed."
          : " Enter your character's modifier for this check."}
        {" "}Then click Submit Roll.
      </p>

      <Button
        type="button"
        variant="secondary"
        size="sm"
        onClick={rollD20}
        disabled={disabled}
        className="w-full"
      >
        <Dice5 className="mr-1 h-3 w-3" />
        Roll d20
      </Button>

      <div className="grid grid-cols-3 gap-2">
        <div>
          <Label className="text-xs">Natural</Label>
          <Input
            type="number"
            min={1}
            max={20}
            value={natural || ""}
            onChange={(e) => setNatural(parseInt(e.target.value, 10) || 0)}
            disabled={disabled}
            className="h-8 text-sm"
          />
        </div>
        <div>
          <Label className="text-xs">Modifier</Label>
          <Input
            type="number"
            value={modifier || ""}
            onChange={(e) => setModifier(parseInt(e.target.value, 10) || 0)}
            disabled={disabled}
            className="h-8 text-sm"
          />
        </div>
        <div>
          <Label className="text-xs">Total</Label>
          <Input
            type="number"
            value={total || natural + modifier || ""}
            onChange={(e) => setTotal(parseInt(e.target.value, 10) || 0)}
            disabled={disabled}
            className="h-8 text-sm"
          />
        </div>
      </div>

      {natural > 0 && (
        <p className={`text-xs font-medium ${passes ? "text-green-600" : "text-red-600"}`}>
          {passes ? "Success" : "Failure"}: {computedTotal} vs DC {roll.dc}
          {natural === 20 && " — natural 20!"}
          {natural === 1 && " — natural 1!"}
        </p>
      )}

      <Button
        size="sm"
        onClick={handleSubmit}
        disabled={disabled || (!total && !natural)}
        className="w-full"
      >
        <Dice5 className="mr-1 h-3 w-3" />
        Submit Roll
      </Button>
    </div>
  );
}
