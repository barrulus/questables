import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { Input } from "./ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "./ui/avatar";
import { Progress } from "./ui/progress";
import { ScrollArea } from "./ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "./ui/dialog";
import { toast } from "sonner";
import { 
  User, 
  Plus, 
  Search, 
  MapIcon, 
  Users, 
  Calendar, 
  Clock, 
  Star, 
  Edit,
  Eye,
  Play,
  UserPlus,
  Settings,
  LogOut,
  Sword,
  Shield,
  Heart
} from "lucide-react";

interface Character {
  id: string;
  name: string;
  class: string;
  level: number;
  race: string;
  hitPoints: { current: number; max: number };
  armorClass: number;
  background: string;
  campaigns: string[];
  lastPlayed: Date;
  avatar?: string;
}

interface Campaign {
  id: string;
  name: string;
  description: string;
  dm: string;
  status: "recruiting" | "active" | "full" | "completed";
  playerCount: number;
  maxPlayers: number;
  system: string;
  nextSession?: Date;
  tags: string[];
  level: { min: number; max: number };
  isJoined: boolean;
}

interface PlayerDashboardProps {
  user: { id: string; username: string; email: string; role: string };
  onEnterGame: () => void;
  onLogout: () => void;
}

export function PlayerDashboard({ user, onEnterGame, onLogout }: PlayerDashboardProps) {
  const [activeTab, setActiveTab] = useState("characters");
  const [searchQuery, setSearchQuery] = useState("");

  const [characters] = useState<Character[]>([
    {
      id: "char1",
      name: "Thorin Ironforge",
      class: "Fighter",
      level: 8,
      race: "Dwarf",
      hitPoints: { current: 68, max: 72 },
      armorClass: 18,
      background: "Soldier",
      campaigns: ["camp1"],
      lastPlayed: new Date(),
      avatar: "https://images.unsplash.com/photo-1578662996442-48f60103fc96?w=100"
    },
    {
      id: "char2",
      name: "Luna Nightwhisper",
      class: "Wizard",
      level: 6,
      race: "Elf",
      hitPoints: { current: 32, max: 38 },
      armorClass: 13,
      background: "Sage",
      campaigns: ["camp2"],
      lastPlayed: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
      avatar: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=100"
    },
    {
      id: "char3",
      name: "Kael Shadowstrike",
      class: "Rogue",
      level: 4,
      race: "Half-Elf",
      hitPoints: { current: 28, max: 30 },
      armorClass: 15,
      background: "Criminal",
      campaigns: [],
      lastPlayed: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000)
    }
  ]);

  const [campaigns] = useState<Campaign[]>([
    {
      id: "camp1",
      name: "The Fellowship of the Ring",
      description: "Follow Frodo and the Fellowship on their epic quest to destroy the One Ring and save Middle-earth.",
      dm: "Gandalf Grey",
      status: "active",
      playerCount: 4,
      maxPlayers: 6,
      system: "D&D 5e",
      nextSession: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
      tags: ["Epic", "High Fantasy", "RP Heavy"],
      level: { min: 6, max: 10 },
      isJoined: true
    },
    {
      id: "camp2",
      name: "Curse of Strahd",
      description: "Gothic horror adventure in the demiplane of Barovia, ruled by the vampire lord Strahd von Zarovich.",
      dm: "VampireMaster",
      status: "active",
      playerCount: 3,
      maxPlayers: 5,
      system: "D&D 5e",
      nextSession: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000),
      tags: ["Horror", "Gothic", "Challenging"],
      level: { min: 1, max: 6 },
      isJoined: true
    },
    {
      id: "camp3",
      name: "Dragon Heist",
      description: "Urban intrigue and faction politics in the City of Splendors.",
      dm: "CityMaster",
      status: "recruiting",
      playerCount: 2,
      maxPlayers: 4,
      system: "D&D 5e",
      tags: ["Urban", "Intrigue", "Beginner Friendly"],
      level: { min: 1, max: 5 },
      isJoined: false
    },
    {
      id: "camp4",
      name: "Tomb of Annihilation",
      description: "Explore the deadly jungles of Chult and confront the Soulmonger.",
      dm: "JungleDM",
      status: "recruiting",
      playerCount: 3,
      maxPlayers: 6,
      system: "D&D 5e",
      tags: ["Exploration", "Deadly", "Jungle"],
      level: { min: 5, max: 11 },
      isJoined: false
    },
    {
      id: "camp5",
      name: "Call of Cthulhu: Masks",
      description: "Investigate cosmic horrors across the globe in the 1920s.",
      dm: "CosmicHorror",
      status: "full",
      playerCount: 5,
      maxPlayers: 5,
      system: "Call of Cthulhu",
      tags: ["Horror", "Investigation", "1920s"],
      level: { min: 1, max: 3 },
      isJoined: false
    }
  ]);

  const getStatusColor = (status: string) => {
    switch (status) {
      case "active": return "bg-green-500";
      case "recruiting": return "bg-blue-500";
      case "full": return "bg-yellow-500";
      case "completed": return "bg-gray-500";
      default: return "bg-gray-500";
    }
  };

  const getStatusBadgeVariant = (status: string) => {
    switch (status) {
      case "active": return "default" as const;
      case "recruiting": return "secondary" as const;
      case "full": return "outline" as const;
      case "completed": return "outline" as const;
      default: return "outline" as const;
    }
  };

  const filteredCampaigns = campaigns.filter(campaign =>
    campaign.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    campaign.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
    campaign.tags.some(tag => tag.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  const handleJoinCampaign = (campaignId: string) => {
    toast.success("Request sent to DM for approval!");
  };

  const activeCampaigns = campaigns.filter(c => c.isJoined && c.status === "active");

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="border-b bg-card">
        <div className="flex items-center justify-between px-6 py-4">
          <div className="flex items-center gap-4">
            <Avatar className="w-10 h-10">
              <AvatarImage src={`https://avatar.vercel.sh/${user.username}`} />
              <AvatarFallback>{user.username.slice(0, 2).toUpperCase()}</AvatarFallback>
            </Avatar>
            <div>
              <h1 className="font-semibold">Welcome back, {user.username}!</h1>
              <p className="text-sm text-muted-foreground">Player Dashboard</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button 
              variant="outline" 
              size="sm"
              onClick={onEnterGame}
              disabled={activeCampaigns.length === 0}
            >
              <Play className="w-4 h-4 mr-1" />
              Enter Game
            </Button>
            <Button variant="ghost" size="sm">
              <Settings className="w-4 h-4" />
            </Button>
            <Button variant="ghost" size="sm" onClick={onLogout}>
              <LogOut className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </div>

      {/* Quick Stats */}
      <div className="px-6 py-4 border-b bg-muted/30">
        <div className="grid grid-cols-4 gap-4">
          <div className="text-center">
            <div className="text-2xl font-bold">{characters.length}</div>
            <div className="text-sm text-muted-foreground">Characters</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold">{campaigns.filter(c => c.isJoined).length}</div>
            <div className="text-sm text-muted-foreground">Active Campaigns</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold">{activeCampaigns.length}</div>
            <div className="text-sm text-muted-foreground">Ready to Play</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold">
              {characters.reduce((sum, char) => sum + char.level, 0)}
            </div>
            <div className="text-sm text-muted-foreground">Total Levels</div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="p-6">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
          <TabsList>
            <TabsTrigger value="characters">My Characters</TabsTrigger>
            <TabsTrigger value="campaigns">My Campaigns</TabsTrigger>
            <TabsTrigger value="browse">Browse Campaigns</TabsTrigger>
          </TabsList>

          <TabsContent value="characters" className="space-y-6">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-semibold">Your Characters</h2>
              <Button>
                <Plus className="w-4 h-4 mr-1" />
                Create Character
              </Button>
            </div>

            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
              {characters.map((character) => (
                <Card key={character.id} className="hover:shadow-md transition-shadow">
                  <CardHeader className="pb-3">
                    <div className="flex items-center gap-3">
                      <Avatar className="w-12 h-12">
                        <AvatarImage src={character.avatar} />
                        <AvatarFallback>{character.name.slice(0, 2)}</AvatarFallback>
                      </Avatar>
                      <div className="flex-1">
                        <CardTitle className="text-lg">{character.name}</CardTitle>
                        <CardDescription>
                          Level {character.level} {character.race} {character.class}
                        </CardDescription>
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
                        <span>{Math.round((character.hitPoints.current / character.hitPoints.max) * 100)}%</span>
                      </div>
                      <Progress value={(character.hitPoints.current / character.hitPoints.max) * 100} />
                    </div>

                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>Background: {character.background}</span>
                      <span>Last played: {character.lastPlayed.toLocaleDateString()}</span>
                    </div>

                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" className="flex-1">
                        <Edit className="w-4 h-4 mr-1" />
                        Edit
                      </Button>
                      {character.campaigns.length > 0 && (
                        <Button size="sm" className="flex-1" onClick={onEnterGame}>
                          <Play className="w-4 h-4 mr-1" />
                          Play
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </TabsContent>

          <TabsContent value="campaigns" className="space-y-6">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-semibold">Your Campaigns</h2>
            </div>

            <div className="space-y-4">
              {campaigns.filter(c => c.isJoined).map((campaign) => (
                <Card key={campaign.id}>
                  <CardContent className="p-6">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-3 mb-2">
                          <div className={`w-3 h-3 rounded-full ${getStatusColor(campaign.status)}`} />
                          <h3 className="font-semibold text-lg">{campaign.name}</h3>
                          <Badge variant={getStatusBadgeVariant(campaign.status)} className="capitalize">
                            {campaign.status}
                          </Badge>
                        </div>
                        
                        <p className="text-muted-foreground mb-3">{campaign.description}</p>
                        
                        <div className="flex items-center gap-6 text-sm text-muted-foreground">
                          <div className="flex items-center gap-1">
                            <User className="w-4 h-4" />
                            <span>DM: {campaign.dm}</span>
                          </div>
                          <div className="flex items-center gap-1">
                            <Users className="w-4 h-4" />
                            <span>{campaign.playerCount}/{campaign.maxPlayers} players</span>
                          </div>
                          <div className="flex items-center gap-1">
                            <MapIcon className="w-4 h-4" />
                            <span>{campaign.system}</span>
                          </div>
                          {campaign.nextSession && (
                            <div className="flex items-center gap-1">
                              <Calendar className="w-4 h-4" />
                              <span>Next: {campaign.nextSession.toLocaleDateString()}</span>
                            </div>
                          )}
                        </div>

                        <div className="flex flex-wrap gap-1 mt-3">
                          {campaign.tags.map((tag, index) => (
                            <Badge key={index} variant="secondary" className="text-xs">
                              {tag}
                            </Badge>
                          ))}
                        </div>
                      </div>
                      
                      <div className="flex gap-2 ml-4">
                        <Button variant="outline" size="sm">
                          <Eye className="w-4 h-4 mr-1" />
                          View
                        </Button>
                        {campaign.status === "active" && (
                          <Button size="sm" onClick={onEnterGame}>
                            <Play className="w-4 h-4 mr-1" />
                            Join Session
                          </Button>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </TabsContent>

          <TabsContent value="browse" className="space-y-6">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-semibold">Browse Campaigns</h2>
              <div className="relative w-80">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground w-4 h-4" />
                <Input
                  placeholder="Search campaigns..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10"
                />
              </div>
            </div>

            <div className="space-y-4">
              {filteredCampaigns.map((campaign) => (
                <Card key={campaign.id} className={campaign.isJoined ? "ring-2 ring-primary/20" : ""}>
                  <CardContent className="p-6">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-3 mb-2">
                          <div className={`w-3 h-3 rounded-full ${getStatusColor(campaign.status)}`} />
                          <h3 className="font-semibold text-lg">{campaign.name}</h3>
                          <Badge variant={getStatusBadgeVariant(campaign.status)} className="capitalize">
                            {campaign.status}
                          </Badge>
                          {campaign.isJoined && (
                            <Badge variant="outline" className="text-green-600 border-green-600">
                              Joined
                            </Badge>
                          )}
                        </div>
                        
                        <p className="text-muted-foreground mb-3">{campaign.description}</p>
                        
                        <div className="flex items-center gap-6 text-sm text-muted-foreground">
                          <div className="flex items-center gap-1">
                            <User className="w-4 h-4" />
                            <span>DM: {campaign.dm}</span>
                          </div>
                          <div className="flex items-center gap-1">
                            <Users className="w-4 h-4" />
                            <span>{campaign.playerCount}/{campaign.maxPlayers} players</span>
                          </div>
                          <div className="flex items-center gap-1">
                            <MapIcon className="w-4 h-4" />
                            <span>{campaign.system}</span>
                          </div>
                          <div className="flex items-center gap-1">
                            <Star className="w-4 h-4" />
                            <span>Levels {campaign.level.min}-{campaign.level.max}</span>
                          </div>
                          {campaign.nextSession && (
                            <div className="flex items-center gap-1">
                              <Calendar className="w-4 h-4" />
                              <span>Next: {campaign.nextSession.toLocaleDateString()}</span>
                            </div>
                          )}
                        </div>

                        <div className="flex flex-wrap gap-1 mt-3">
                          {campaign.tags.map((tag, index) => (
                            <Badge key={index} variant="secondary" className="text-xs">
                              {tag}
                            </Badge>
                          ))}
                        </div>
                      </div>
                      
                      <div className="flex gap-2 ml-4">
                        <Button variant="outline" size="sm">
                          <Eye className="w-4 h-4 mr-1" />
                          View Details
                        </Button>
                        {!campaign.isJoined && campaign.status === "recruiting" && (
                          <Button 
                            size="sm" 
                            onClick={() => handleJoinCampaign(campaign.id)}
                          >
                            <UserPlus className="w-4 h-4 mr-1" />
                            Request to Join
                          </Button>
                        )}
                        {campaign.isJoined && campaign.status === "active" && (
                          <Button size="sm" onClick={onEnterGame}>
                            <Play className="w-4 h-4 mr-1" />
                            Join Session
                          </Button>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
