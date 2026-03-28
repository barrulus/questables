import { Avatar, AvatarFallback, AvatarImage } from "./ui/avatar";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Switch } from "./ui/switch";

interface PlayerToken {
  playerId: string;
  userId: string;
  characterId?: string;
  coordinates: [number, number];
  name: string;
  initials: string;
  avatarUrl?: string | null;
  visibilityState: 'visible' | 'stealthed' | 'hidden';
  role: string;
  canViewHistory: boolean;
  lastLocatedAt?: string | null;
  hitPoints?: { current: number; max: number; temporary?: number };
  conditions: string[];
}

interface MapVisiblePlayersPanelProps {
  tokens: PlayerToken[];
  playerLoading: boolean;
  playerError: string | null;
  activeCampaignId: string | null;
  onRefresh: (campaignId: string) => void;
  trailSelections: Record<string, boolean>;
  trailErrors: Record<string, string | null>;
  onTrailToggle: (token: PlayerToken, checked: boolean) => void;
  canControlPlayer: (token: PlayerToken) => boolean;
  selectedPlayerId: string | null;
  onFocusPlayer: (token: PlayerToken) => void;
  onMovePlayer: (token: PlayerToken) => void;
}

export type { PlayerToken };

export function MapVisiblePlayersPanel({
  tokens, playerLoading, playerError,
  activeCampaignId, onRefresh,
  trailSelections, trailErrors,
  onTrailToggle, canControlPlayer,
  selectedPlayerId, onFocusPlayer, onMovePlayer,
}: MapVisiblePlayersPanelProps) {
  return (
    <div className="border-t bg-muted/20 px-4 py-3 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-foreground">
            Visible Players ({tokens.length})
          </h3>
          {playerLoading && <Badge variant="secondary">Refreshing...</Badge>}
        </div>
        <div className="flex items-center gap-2">
          {playerError && (
            <Badge variant="destructive" className="text-xs">{playerError}</Badge>
          )}
          {activeCampaignId && (
            <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => onRefresh(activeCampaignId)}>
              Refresh
            </Button>
          )}
        </div>
      </div>

      <div className="space-y-2">
        {tokens.length === 0 && !playerLoading ? (
          <p className="text-xs text-muted-foreground">No player tokens are currently visible.</p>
        ) : null}

        {tokens.map((token) => {
          const hp = token.hitPoints;
          const hpLabel = hp ? `${hp.current}/${hp.max}` : '\u2014';
          const hpPercent = hp && hp.max > 0 ? Math.round((hp.current / hp.max) * 100) : null;
          const conditionsLabel = token.conditions.length
            ? token.conditions.slice(0, 3).join(', ')
            : 'No conditions';
          const trailEnabled = trailSelections[token.playerId] ?? false;

          return (
            <div
              key={token.playerId}
              className="flex flex-col gap-2 rounded-md border bg-background/60 p-3 shadow-sm sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="flex items-start gap-3">
                <Avatar className="h-9 w-9 border">
                  {token.avatarUrl ? <AvatarImage src={token.avatarUrl} alt={token.name} /> : null}
                  <AvatarFallback>{token.initials}</AvatarFallback>
                </Avatar>
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-foreground">{token.name}</span>
                    <Badge variant="outline" className="text-[10px] uppercase tracking-wide">{token.role}</Badge>
                    {token.visibilityState !== 'visible' && (
                      <Badge variant="secondary" className="text-[10px] uppercase tracking-wide">{token.visibilityState}</Badge>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground space-x-3">
                    <span>HP: {hpLabel}{hpPercent !== null ? ` (${hpPercent}%)` : ''}</span>
                    <span>Conditions: {conditionsLabel}</span>
                    {token.lastLocatedAt && (
                      <span>Updated: {new Date(token.lastLocatedAt).toLocaleTimeString()}</span>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <div className="flex items-center gap-2">
                  <Switch
                    checked={trailEnabled}
                    onCheckedChange={(checked) => onTrailToggle(token, checked)}
                    disabled={!token.canViewHistory && !canControlPlayer(token)}
                  />
                  <span className="text-xs text-muted-foreground">Trail</span>
                </div>
                {trailErrors[token.playerId] && (
                  <span className="text-[11px] text-destructive">{trailErrors[token.playerId]}</span>
                )}
                <Button variant="ghost" size="sm" className="h-7" onClick={() => onFocusPlayer(token)}>Focus</Button>
                {canControlPlayer(token) && (
                  <Button
                    variant={selectedPlayerId === token.playerId ? 'default' : 'outline'}
                    size="sm" className="h-7"
                    onClick={() => onMovePlayer(token)}
                  >Move</Button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
