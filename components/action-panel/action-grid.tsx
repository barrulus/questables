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
} from "lucide-react";
import type { ActionType } from "../../contexts/ActionContext";

interface ActionGridProps {
  onSelect: (type: ActionType) => void;
  disabled?: boolean;
  phase?: string;
}

const ACTIONS: Array<{
  type: ActionType;
  label: string;
  icon: typeof Move;
  phases: string[];
}> = [
  { type: "move", label: "Move", icon: Move, phases: ["exploration", "combat", "social"] },
  { type: "interact", label: "Interact", icon: Hand, phases: ["exploration", "combat", "social"] },
  { type: "search", label: "Search", icon: Search, phases: ["exploration", "social"] },
  { type: "use_item", label: "Use Item", icon: Package, phases: ["exploration", "combat", "social"] },
  { type: "cast_spell", label: "Cast Spell", icon: Sparkles, phases: ["exploration", "combat", "social"] },
  { type: "talk_to_npc", label: "Talk to NPC", icon: MessageSquare, phases: ["exploration", "social"] },
  { type: "pass", label: "Pass", icon: SkipForward, phases: ["exploration", "combat", "social"] },
  { type: "free_action", label: "Free Action", icon: Zap, phases: ["exploration", "combat", "social"] },
];

export function ActionGrid({ onSelect, disabled, phase }: ActionGridProps) {
  const availableActions = phase
    ? ACTIONS.filter((a) => a.phases.includes(phase))
    : ACTIONS;

  return (
    <div className="grid grid-cols-4 gap-2">
      {availableActions.map((action) => {
        const Icon = action.icon;
        return (
          <Button
            key={action.type}
            variant="outline"
            size="sm"
            disabled={disabled}
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
