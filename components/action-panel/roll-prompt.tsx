import { useState } from "react";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Dice5 } from "lucide-react";
import type { RollRequest, RollSubmission } from "../../contexts/ActionContext";

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

export function RollPrompt({ rollRequest, onSubmit, disabled }: RollPromptProps) {
  const [total, setTotal] = useState<number>(0);
  const [natural, setNatural] = useState<number>(0);
  const [modifier, setModifier] = useState<number>(0);

  const roll = rollRequest.requiredRolls[0];
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
