import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "./ui/avatar";
import { Progress } from "./ui/progress";
import { Edit, Heart, Info, Plus, Shield, Users } from "lucide-react";

interface HitPoints {
  current: number;
  max: number;
  temporary?: number;
}

interface PlayerTokenSummary {
  playerId: string;
  campaignId: string;
  campaignName: string;
  visibilityState: "visible" | "stealthed" | "hidden";
  lastLocatedAt: string | null;
  coordinates: { x: number; y: number } | null;
}

interface PlayerCharacter {
  id: string;
  name: string;
  class: string;
  race: string;
  level: number;
  background: string;
  armorClass: number;
  hitPoints: HitPoints;
  avatarUrl?: string;
  lastPlayed?: string | null;
  playerTokens: PlayerTokenSummary[];
}

interface CampaignRef {
  id: string;
  name: string;
}

const formatPercentage = (current: number, max: number) =>
  max > 0 ? Math.round((current / max) * 100) : 0;

const formatDate = (value: string | null | undefined) =>
  value ? new Date(value).toLocaleDateString() : "Never";

const formatDateTime = (value: string | null | undefined) =>
  value ? new Date(value).toLocaleString() : null;

const formatCoordinates = (coords: { x: number; y: number } | null) =>
  coords ? `(${coords.x.toFixed(1)}, ${coords.y.toFixed(1)})` : "No position";

const getVisibilityBadgeVariant = (state: string) => {
  switch (state) {
    case "visible": return "default" as const;
    case "stealthed": return "secondary" as const;
    case "hidden": return "outline" as const;
    default: return "outline" as const;
  }
};

interface PlayerCharacterGridProps {
  characters: PlayerCharacter[];
  characterCampaignMap: Record<string, CampaignRef[]>;
  onCreateCharacter: () => void;
  onEditCharacter: (characterId: string) => void;
  onViewCampaigns: () => void;
}

export type { PlayerCharacter, PlayerTokenSummary, HitPoints };

export function PlayerCharacterGrid({
  characters, characterCampaignMap,
  onCreateCharacter, onEditCharacter, onViewCampaigns,
}: PlayerCharacterGridProps) {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">Your Characters</h2>
        <Button onClick={onCreateCharacter}>
          <Plus className="w-4 h-4 mr-1" />Create Character
        </Button>
      </div>

      {characters.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="py-10 text-center space-y-3">
            <Info className="w-10 h-10 mx-auto text-muted-foreground" />
            <div>
              <p className="font-medium">No characters yet</p>
              <p className="text-sm text-muted-foreground">Create a character to start joining campaigns.</p>
            </div>
            <Button onClick={onCreateCharacter}>
              <Plus className="w-4 h-4 mr-1" />Create Character
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
          {characters.map((character) => {
            const campaignsForCharacter = characterCampaignMap[character.id] ?? [];
            const healthPercentage = formatPercentage(character.hitPoints.current, character.hitPoints.max);
            return (
              <Card key={character.id} className="hover:shadow-md transition-shadow">
                <CardHeader className="pb-3">
                  <div className="flex items-center gap-3">
                    <Avatar className="w-12 h-12">
                      <AvatarImage src={character.avatarUrl} />
                      <AvatarFallback>{character.name.slice(0, 2)}</AvatarFallback>
                    </Avatar>
                    <div className="flex-1">
                      <CardTitle className="text-lg">{character.name}</CardTitle>
                      <CardDescription>Level {character.level} {character.race} {character.class}</CardDescription>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div className="flex items-center gap-2">
                      <Heart className="w-4 h-4 text-red-500" />
                      <span>{character.hitPoints.current}/{character.hitPoints.max} HP</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Shield className="w-4 h-4 text-blue-500" />
                      <span>AC {character.armorClass}</span>
                    </div>
                  </div>
                  <div>
                    <div className="flex justify-between text-sm mb-1">
                      <span>Health</span>
                      <span>{healthPercentage}%</span>
                    </div>
                    <Progress value={healthPercentage} />
                  </div>
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>Background: {character.background || "\u2014"}</span>
                    <span>Last played: {formatDate(character.lastPlayed)}</span>
                  </div>
                  <div className="text-xs">
                    <span className="font-medium text-muted-foreground">Campaigns:</span>{" "}
                    {campaignsForCharacter.length > 0 ? (
                      campaignsForCharacter.map((campaign, index) => (
                        <span key={campaign.id}>{campaign.name}{index < campaignsForCharacter.length - 1 ? ", " : ""}</span>
                      ))
                    ) : (
                      <span className="text-muted-foreground">Not assigned</span>
                    )}
                  </div>
                  <div className="text-xs space-y-2">
                    <span className="font-medium text-muted-foreground">Player Tokens:</span>
                    {character.playerTokens.length > 0 ? (
                      <div className="space-y-2">
                        {character.playerTokens.map((token) => {
                          const lastUpdated = formatDateTime(token.lastLocatedAt);
                          return (
                            <div key={`${token.playerId}:${token.campaignId}`} className="rounded-md border border-muted-foreground/10 bg-muted/20 px-2 py-1">
                              <div className="flex items-center justify-between gap-2">
                                <span className="font-medium">{token.campaignName}</span>
                                <Badge className="capitalize" variant={getVisibilityBadgeVariant(token.visibilityState)}>{token.visibilityState}</Badge>
                              </div>
                              <div className="mt-1 flex flex-wrap items-center justify-between gap-2 text-[0.7rem] text-muted-foreground">
                                <span>{formatCoordinates(token.coordinates)}</span>
                                <span>{lastUpdated ? `Updated ${lastUpdated}` : "No movement recorded"}</span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <span className="text-muted-foreground">No tokens recorded</span>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" className="flex-1" onClick={() => onEditCharacter(character.id)}>
                      <Edit className="w-4 h-4 mr-1" />Edit
                    </Button>
                    <Button size="sm" className="flex-1" onClick={onViewCampaigns}>
                      <Users className="w-4 h-4 mr-1" />View Campaigns
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
