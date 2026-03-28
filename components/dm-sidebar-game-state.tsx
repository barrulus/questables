import { Button } from "./ui/button";
import { Label } from "./ui/label";
import { Play, SkipForward, Sparkles, Swords } from "lucide-react";
import { toast } from "sonner";
import { apiFetch, readJsonBody } from "../utils/api-client";

type GamePhase = "exploration" | "combat" | "social" | "rest";

const GAME_PHASES: { value: GamePhase; label: string }[] = [
  { value: "exploration", label: "Exploration" },
  { value: "combat", label: "Combat" },
  { value: "social", label: "Social" },
  { value: "rest", label: "Rest" },
];

interface GameState {
  phase: string;
  roundNumber: number;
  turnOrder: string[];
  activePlayerId: string | null;
  worldTurnPending: boolean;
}

interface Player {
  id: string;
  name: string;
  characterId: string;
}

interface GameStatePanelProps {
  gameState: GameState | null;
  players: Player[];
  activeCampaignId: string;
  worldTurnWithLLM: boolean;
  onWorldTurnWithLLMChange: (value: boolean) => void;
  changeGamePhase: (phase: GamePhase, encounterId?: string) => Promise<void>;
  endGameTurn: () => Promise<void>;
  executeDmWorldTurn: () => Promise<void>;
  skipGameTurn: (turnId: string) => Promise<void>;
  endCombat: (outcome: string) => Promise<void>;
}

export function GameStatePanel({
  gameState, players, activeCampaignId,
  worldTurnWithLLM, onWorldTurnWithLLMChange,
  changeGamePhase, endGameTurn, executeDmWorldTurn,
  skipGameTurn, endCombat,
}: GameStatePanelProps) {
  const fetchJson = async (url: string, init?: RequestInit) => {
    const response = await apiFetch(url, init);
    return readJsonBody(response);
  };

  if (!gameState) {
    return (
      <p className="text-sm text-muted-foreground">
        No active game state. Activate a session to initialize game state.
      </p>
    );
  }

  return (
    <>
      <div className="space-y-2">
        <Label>Current Phase: <span className="font-semibold capitalize">{gameState.phase}</span></Label>
        <div className="flex flex-wrap gap-2">
          {GAME_PHASES.filter((p) => p.value !== gameState.phase).map((p) => (
            <Button
              key={p.value} variant="outline" size="sm"
              onClick={() => { void changeGamePhase(p.value).catch((err: Error) => { toast.error(err.message || "Failed to change phase"); }); }}
            >
              <Swords className="mr-1 h-3 w-3" />{p.label}
            </Button>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <Label>Turn Order (Round {gameState.roundNumber})</Label>
        {gameState.turnOrder.length === 0 ? (
          <p className="text-sm text-muted-foreground">No turn order (rest phase).</p>
        ) : (
          <div className="space-y-1">
            {gameState.turnOrder.map((turnId, index) => {
              const isNpc = turnId.startsWith("npc:");
              const player = isNpc ? null : players.find((p) => p.id === turnId);
              const displayName = isNpc
                ? `NPC (${turnId.replace("npc:", "").slice(0, 8)})`
                : (player?.name ?? turnId.slice(0, 8));
              const isActive = gameState.activePlayerId === turnId;
              return (
                <div
                  key={turnId}
                  className={`flex items-center justify-between rounded px-2 py-1 text-sm ${isActive ? "bg-primary/10 font-semibold" : ""}${isNpc ? " text-red-600" : ""}`}
                >
                  <span>{index + 1}. {displayName}{isActive && " (active)"}</span>
                  {isActive && !isNpc && (
                    <Button variant="ghost" size="sm" className="h-6 px-2 text-xs"
                      onClick={() => { void skipGameTurn(turnId).catch((err: Error) => { toast.error(err.message || "Failed to skip turn"); }); }}
                    >
                      <SkipForward className="mr-1 h-3 w-3" />Skip
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        {gameState.activePlayerId && !gameState.worldTurnPending && (
          <Button variant="outline" size="sm"
            onClick={() => { void endGameTurn().catch((err: Error) => { toast.error(err.message || "Failed to end turn"); }); }}
          >
            <Play className="mr-1 h-3 w-3" />End Turn
          </Button>
        )}
        {gameState.worldTurnPending && (
          <div className="flex items-center gap-2">
            <Button size="sm"
              onClick={() => { void executeDmWorldTurn().catch((err: Error) => { toast.error(err.message || "Failed to execute world turn"); }); }}
            >
              <Sparkles className="mr-1 h-3 w-3" />
              {worldTurnWithLLM ? "Execute World Turn (LLM)" : "Execute World Turn"}
            </Button>
            <label className="flex items-center gap-1 text-xs text-muted-foreground cursor-pointer">
              <input type="checkbox" checked={worldTurnWithLLM} onChange={(e) => onWorldTurnWithLLMChange(e.target.checked)} className="h-3 w-3" />
              LLM
            </label>
          </div>
        )}
      </div>

      {gameState.phase === "combat" && (
        <div className="space-y-2">
          <Label>End Combat</Label>
          <div className="flex flex-wrap gap-2">
            {([
              { value: "victory", label: "Victory" },
              { value: "enemies_fled", label: "Enemies Fled" },
              { value: "party_fled", label: "Party Fled" },
              { value: "parley", label: "Parley" },
            ] as const).map((opt) => (
              <Button key={opt.value} variant="outline" size="sm"
                onClick={() => { void endCombat(opt.value).catch((err: Error) => { toast.error(err.message || "Failed to end combat"); }); }}
              >
                {opt.label}
              </Button>
            ))}
          </div>
        </div>
      )}

      {gameState.phase !== "rest" && gameState.phase !== "combat" && (
        <div className="space-y-2">
          <Label>Start Rest</Label>
          <div className="flex gap-2">
            <Button variant="outline" size="sm"
              onClick={() => { void fetchJson(`/api/campaigns/${activeCampaignId}/rest/start`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ restType: "short" }) }).catch((err: Error) => { toast.error(err.message || "Failed to start short rest"); }); }}
            >Short Rest</Button>
            <Button variant="outline" size="sm"
              onClick={() => { void fetchJson(`/api/campaigns/${activeCampaignId}/rest/start`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ restType: "long" }) }).catch((err: Error) => { toast.error(err.message || "Failed to start long rest"); }); }}
            >Long Rest</Button>
          </div>
        </div>
      )}

      {players.length > 0 && (
        <div className="space-y-2">
          <Label>Milestone Level Up</Label>
          <div className="flex flex-wrap gap-2">
            {players.map((p) => (
              <Button key={p.id} variant="outline" size="sm"
                onClick={() => {
                  void fetchJson(`/api/campaigns/${activeCampaignId}/characters/${p.characterId}/milestone-level-up`, {
                    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ hpChoice: "average" }),
                  }).then(() => { toast.success(`${p.name} levelled up!`); }).catch((err: Error) => { toast.error(err.message || "Failed to level up"); });
                }}
              >{p.name}</Button>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
