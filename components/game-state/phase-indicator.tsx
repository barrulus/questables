import { Badge } from "../ui/badge";
import { Compass, Swords, Users, Moon } from "lucide-react";
import { useGameState, type GamePhase } from "../../contexts/GameStateContext";

const PHASE_CONFIG: Record<
  GamePhase,
  { label: string; icon: typeof Compass; className: string }
> = {
  exploration: {
    label: "Exploration",
    icon: Compass,
    className: "bg-green-100 text-green-800 border-green-300",
  },
  combat: {
    label: "Combat",
    icon: Swords,
    className: "bg-red-100 text-red-800 border-red-300",
  },
  social: {
    label: "Social",
    icon: Users,
    className: "bg-blue-100 text-blue-800 border-blue-300",
  },
  rest: {
    label: "Rest",
    icon: Moon,
    className: "bg-amber-100 text-amber-800 border-amber-300",
  },
};

export function PhaseIndicator() {
  const { gameState } = useGameState();

  if (!gameState) return null;

  const config = PHASE_CONFIG[gameState.phase];
  if (!config) return null;

  const Icon = config.icon;

  return (
    <Badge variant="outline" className={`flex items-center gap-1 ${config.className}`}>
      <Icon className="h-3 w-3" />
      {config.label}
    </Badge>
  );
}
