import { CheckCircle2, Hourglass, Info, Pause } from "lucide-react";
import type { ActionabilityResult } from "../shared/actionability";
import { cn } from "./ui/utils";

interface TurnStatusBarProps {
  actionability: ActionabilityResult;
  activePlayerName: string | null;
}

export function TurnStatusBar({ actionability, activePlayerName }: TurnStatusBarProps) {
  const { canAct, reason } = actionability;

  let icon = <Pause className="w-4 h-4" />;
  let text = "Actions paused";
  let tone: "ok" | "info" | "warn" = "info";

  switch (reason) {
    case "ok":
      icon = <CheckCircle2 className="w-4 h-4" />;
      text = "Your turn — act freely";
      tone = "ok";
      break;
    case "no_active_session":
      icon = <Info className="w-4 h-4" />;
      text = "No active session — Campaign Director hasn't started one";
      tone = "info";
      break;
    case "phase_not_actionable":
      icon = <Pause className="w-4 h-4" />;
      text = `Phase: ${actionability.phase ?? "paused"} — actions paused`;
      tone = "info";
      break;
    case "user_not_in_turn_order":
      icon = <Info className="w-4 h-4" />;
      text = "You're a spectator — join from the dashboard to act";
      tone = "info";
      break;
    case "not_active_player_in_combat":
      icon = <Hourglass className="w-4 h-4" />;
      text = `Combat — ${activePlayerName ?? "another player"}'s turn`;
      tone = "warn";
      break;
    case "no_active_character":
      icon = <Info className="w-4 h-4" />;
      text = "No character enrolled — join with one to act";
      tone = "info";
      break;
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "flex items-center gap-2 px-3 py-1.5 text-xs border-b",
        tone === "ok" && "bg-emerald-50 text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300",
        tone === "info" && "bg-muted/40 text-muted-foreground",
        tone === "warn" && "bg-amber-50 text-amber-800 dark:bg-amber-950/30 dark:text-amber-300",
      )}
      data-canact={canAct}
      data-reason={reason}
    >
      {icon}
      <span>{text}</span>
    </div>
  );
}
