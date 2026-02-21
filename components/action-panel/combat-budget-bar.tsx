import type { CombatTurnBudget } from "../../contexts/GameStateContext";

interface CombatBudgetBarProps {
  budget: CombatTurnBudget;
}

export function CombatBudgetBar({ budget }: CombatBudgetBarProps) {
  return (
    <div className="flex items-center gap-3 rounded-md bg-muted/50 px-3 py-1.5 text-xs">
      <span className={budget.actionUsed ? "text-muted-foreground line-through" : "text-foreground font-medium"}>
        Action: {budget.actionUsed ? "Used" : "Available"}
      </span>
      <span className="text-muted-foreground">|</span>
      <span className="text-foreground">
        Movement: {budget.movementRemaining}ft
      </span>
      <span className="text-muted-foreground">|</span>
      <span className={budget.bonusActionUsed ? "text-muted-foreground line-through" : "text-foreground font-medium"}>
        Bonus: {budget.bonusActionUsed ? "Used" : "Available"}
      </span>
      <span className="text-muted-foreground">|</span>
      <span className={budget.reactionUsed ? "text-muted-foreground line-through" : "text-foreground font-medium"}>
        Reaction: {budget.reactionUsed ? "Used" : "Ready"}
      </span>
    </div>
  );
}
