import { Button } from "../ui/button";
import {
  Move,
  Hand,
  Search,
  Package,
  Sparkles,
  MessageSquare,
  SkipForward,
  Zap,
  Swords,
  Wind,
  Shield,
  Footprints,
  Users,
  Eye,
  Timer,
} from "lucide-react";
import type { ActionType } from "../../contexts/ActionContext";
import type { CombatTurnBudget } from "../../contexts/GameStateContext";

interface ActionGridProps {
  onSelect: (type: ActionType) => void;
  disabled?: boolean;
  phase?: string;
  combatBudget?: CombatTurnBudget | null;
}

const ACTIONS: Array<{
  type: ActionType;
  label: string;
  icon: typeof Move;
  phases: string[];
  budgetSlot?: "action" | "bonus" | "movement";
}> = [
  { type: "move", label: "Move", icon: Move, phases: ["exploration", "combat", "social"], budgetSlot: "movement" },
  { type: "interact", label: "Interact", icon: Hand, phases: ["exploration", "combat", "social"], budgetSlot: "action" },
  { type: "search", label: "Search", icon: Search, phases: ["exploration", "social"], budgetSlot: "action" },
  { type: "use_item", label: "Use Item", icon: Package, phases: ["exploration", "combat", "social"], budgetSlot: "action" },
  { type: "cast_spell", label: "Cast Spell", icon: Sparkles, phases: ["exploration", "combat", "social"], budgetSlot: "action" },
  { type: "talk_to_npc", label: "Talk to NPC", icon: MessageSquare, phases: ["exploration", "social"] },
  { type: "pass", label: "Pass", icon: SkipForward, phases: ["exploration", "combat", "social"], budgetSlot: "action" },
  { type: "free_action", label: "Free Action", icon: Zap, phases: ["exploration", "combat", "social"] },
  // Combat-only actions
  { type: "attack", label: "Attack", icon: Swords, phases: ["combat"], budgetSlot: "action" },
  { type: "dash", label: "Dash", icon: Wind, phases: ["combat"], budgetSlot: "action" },
  { type: "dodge", label: "Dodge", icon: Shield, phases: ["combat"], budgetSlot: "action" },
  { type: "disengage", label: "Disengage", icon: Footprints, phases: ["combat"], budgetSlot: "action" },
  { type: "help", label: "Help", icon: Users, phases: ["combat"], budgetSlot: "action" },
  { type: "hide", label: "Hide", icon: Eye, phases: ["combat"], budgetSlot: "action" },
  { type: "ready", label: "Ready", icon: Timer, phases: ["combat"], budgetSlot: "action" },
];

function isActionDisabledByBudget(
  action: (typeof ACTIONS)[0],
  budget: CombatTurnBudget | null | undefined,
): boolean {
  if (!budget) return false;
  if (action.budgetSlot === "action" && budget.actionUsed) return true;
  if (action.budgetSlot === "bonus" && budget.bonusActionUsed) return true;
  return false;
}

export function ActionGrid({ onSelect, disabled, phase, combatBudget }: ActionGridProps) {
  const availableActions = phase
    ? ACTIONS.filter((a) => a.phases.includes(phase))
    : ACTIONS;

  return (
    <div className="grid grid-cols-4 gap-2">
      {availableActions.map((action) => {
        const Icon = action.icon;
        const budgetDisabled = phase === "combat" && isActionDisabledByBudget(action, combatBudget);
        return (
          <Button
            key={action.type}
            variant="outline"
            size="sm"
            disabled={disabled || budgetDisabled}
            className="flex flex-col items-center gap-1 h-auto py-2"
            onClick={() => onSelect(action.type)}
          >
            <Icon className="h-4 w-4" />
            <span className="text-xs">{action.label}</span>
          </Button>
        );
      })}
    </div>
  );
}
