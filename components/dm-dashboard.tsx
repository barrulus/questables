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
import { Label } from "./ui/label";
import { Textarea } from "./ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { CampaignManager } from "./campaign-manager";
import { toast } from "sonner@2.0.3";
import { 
  Shield, 
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
  Crown,
  Home,
  User,
  Route,
  MapPin,
  Building,
  PersonStanding,
  Globe,
  Heart
} from "lucide-react";

interface Campaign {
  id: string;
  name: string;
  description: string;
  status: "planning" | "recruiting" | "active" | "paused" | "completed";
  playerCount: number;
  maxPlayers: number;
  system: string;
  nextSession?: Date;
  tags: string[];
  level: { min: number; max: number };
  createdAt: Date;
  locations: Location[];
  npcs: NPC[];
  routes: GameRoute[];
}

interface Location {
  id: string;
  name: string;
  type: "city" | "town" | "village" | "burg" | "dungeon" | "landmark";
  description: string;
  population?: number;
  government?: string;
  notes: string;
  markers: Marker[];
}

interface NPC {
  id: string;
  name: string;
  race: string;
  class?: string;
  role: string;
  description: string;
  location: string;
  relationship: "ally" | "neutral" | "enemy" | "unknown";
  notes: string;
  avatar?: string;
}

interface GameRoute {
  id: string;
  name: string;
  from: string;
  to: string;
  distance: string;
  difficulty: "easy" | "moderate" | "hard" | "deadly";
  description: string;
  encounters: string[];
}

interface Marker {
  id: string;
  name: string;
  type: "shop" | "tavern" | "temple" | "guild" | "landmark" | "quest" | "danger";
  x: number;
  y: number;
  description: string;
}

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

interface PlayerCampaign {
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

interface DMDashboardProps {
  user: { id: string; username: string; email: string; role: string };
  onEnterGame: () => void;
  onLogout: () => void;
}

export function DMDashboard({ user, onEnterGame, onLogout }: DMDashboardProps) {
  const [activeTab, setActiveTab] = useState("campaigns");
  const [selectedCampaign, setSelectedCampaign] = useState<Campaign | null>(null);
  const [isCreatingCampaign, setIsCreatingCampaign] = useState(false);
  const [newCampaign, setNewCampaign] = useState({
    name: "",
    description: "",
    system: "D&D 5e",
    maxPlayers: 4,
    tags: ""
  });
  const [searchQuery, setSearchQuery] = useState("");

  // Player character data (when acting as a player)
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
      campaigns: ["pcamp1"],
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
      campaigns: ["pcamp2"],
      lastPlayed: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
      avatar: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=100"
    }
  ]);

  // Player campaigns (when acting as a player)
  const [playerCampaigns] = useState<PlayerCampaign[]>([
    {
      id: "pcamp1",
      name: "Waterdeep Dragon Heist",
      description: "Urban intrigue and faction politics in the City of Splendors.",
      dm: "UrbanMaster",
      status: "active",
      playerCount: 3,
      maxPlayers: 4,
      system: "D&D 5e",
      nextSession: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000),
      tags: ["Urban", "Intrigue", "Politics"],
      level: { min: 1, max: 5 },
      isJoined: true
    },
    {
      id: "pcamp2",
      name: "Tomb of Annihilation",
      description: "Explore the deadly jungles of Chult and confront the Soulmonger.",
      dm: "JungleDM",
      status: "active",
      playerCount: 4,
      maxPlayers: 6,
      system: "D&D 5e",
      nextSession: new Date(Date.now() + 4 * 24 * 60 * 60 * 1000),
      tags: ["Exploration", "Deadly", "Jungle"],
      level: { min: 5, max: 11 },
      isJoined: true
    },
    {
      id: "pcamp3",
      name: "Storm King's Thunder",
      description: "Giants return to reclaim their ancient domains.",
      dm: "GiantSlayer",
      status: "recruiting",
      playerCount: 2,
      maxPlayers: 5,
      system: "D&D 5e",
      tags: ["Epic", "Giants", "Adventure"],
      level: { min: 1, max: 11 },
      isJoined: false
    }
  ]);

  const [campaigns, setCampaigns] = useState<Campaign[]>([
    {
      id: "camp1",
      name: "The Fellowship of the Ring",
      description: "Follow Frodo and the Fellowship on their epic quest to destroy the One Ring and save Middle-earth.",
      status: "active",
      playerCount: 4,
      maxPlayers: 6,
      system: "D&D 5e",
      nextSession: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
      tags: ["Epic", "High Fantasy", "RP Heavy"],
      level: { min: 6, max: 10 },
      createdAt: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000),
      locations: [
        {
          id: "loc1",
          name: "Rivendell",
          type: "city",
          description: "The Last Homely House East of the Sea, home to the elves.",
          population: 2000,
          government: "Council of Elders",
          notes: "Safe haven for the Fellowship",
          markers: [
            { id: "m1", name: "Elrond's Hall", type: "landmark", x: 50, y: 30, description: "Where the Council of Elrond meets" },
            { id: "m2", name: "The Houses of Healing", type: "temple", x: 60, y: 40, description: "Elven healing center" }
          ]
        },
        {
          id: "loc2",
          name: "Moria",
          type: "dungeon",
          description: "The ancient dwarven city beneath the Misty Mountains.",
          notes: "Dangerous, overrun by orcs and goblins",
          markers: [
            { id: "m3", name: "Chamber of Mazarbul", type: "landmark", x: 25, y: 60, description: "Balin's tomb" },
            { id: "m4", name: "Bridge of Khazad-dûm", type: "danger", x: 75, y: 70, description: "Where Gandalf faced the Balrog" }
          ]
        }
      ],
      npcs: [
        {
          id: "npc1",
          name: "Elrond",
          race: "Elf",
          role: "Lord of Rivendell",
          description: "Wise and ancient elf lord, keeper of Vilya",
          location: "Rivendell",
          relationship: "ally",
          notes: "Led the Council that decided the Ring's fate",
          avatar: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=100"
        },
        {
          id: "npc2",
          name: "Gimli",
          race: "Dwarf",
          class: "Fighter",
          role: "Fellowship Member",
          description: "Stout dwarf warrior, son of Glóin",
          location: "Moria",
          relationship: "ally",
          notes: "Represents the dwarves in the Fellowship"
        }
      ],
      routes: [
        {
          id: "route1",
          name: "Rivendell to Moria",
          from: "Rivendell",
          to: "Moria",
          distance: "200 miles",
          difficulty: "hard",
          description: "Treacherous path through the Misty Mountains",
          encounters: ["Wargs", "Orcs", "Mountain Trolls"]
        }
      ]
    },
    {
      id: "camp2",
      name: "Curse of Strahd",
      description: "Gothic horror adventure in the demiplane of Barovia.",
      status: "recruiting",
      playerCount: 2,
      maxPlayers: 5,
      system: "D&D 5e",
      tags: ["Horror", "Gothic", "Challenging"],
      level: { min: 1, max: 6 },
      createdAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
      locations: [],
      npcs: [],
      routes: []
    }
  ]);

  const getStatusColor = (status: string) => {
    switch (status) {
      case "active": return "bg-green-500";
      case "recruiting": return "bg-blue-500";
      case "planning": return "bg-yellow-500";
      case "paused": return "bg-orange-500";
      case "completed": return "bg-gray-500";
      default: return "bg-gray-500";
    }
  };

  const getRelationshipColor = (relationship: string) => {
    switch (relationship) {
      case "ally": return "text-green-600 bg-green-50 border-green-200";
      case "enemy": return "text-red-600 bg-red-50 border-red-200";
      case "neutral": return "text-gray-600 bg-gray-50 border-gray-200";
      case "unknown": return "text-purple-600 bg-purple-50 border-purple-200";
      default: return "text-gray-600 bg-gray-50 border-gray-200";
    }
  };

  const getLocationIcon = (type: string) => {
    switch (type) {
      case "city": return <Building className="w-4 h-4" />;
      case "town": return <Home className="w-4 h-4" />;
      case "village": return <Home className="w-4 h-4" />;
      case "burg": return <Home className="w-4 h-4" />;
      case "dungeon": return <Sword className="w-4 h-4" />;
      case "landmark": return <MapPin className="w-4 h-4" />;
      default: return <MapPin className="w-4 h-4" />;
    }
  };

  const handleCreateCampaign = () => {
    if (!newCampaign.name.trim()) {
      toast.error("Please enter a campaign name");
      return;
    }

    const campaign: Campaign = {
      id: Date.now().toString(),
      ...newCampaign,
      status: "planning",
      playerCount: 0,
      level: { min: 1, max: 5 },
      createdAt: new Date(),
      locations: [],
      npcs: [],
      routes: [],
      tags: newCampaign.tags.split(",").map(tag => tag.trim()).filter(Boolean)
    };

    setCampaigns([campaign, ...campaigns]);
    setNewCampaign({ name: "", description: "", system: "D&D 5e", maxPlayers: 4, tags: "" });
    setIsCreatingCampaign(false);
    toast.success("Campaign created successfully!");
  };

  const handleJoinCampaign = (campaignId: string) => {
    toast.success("Request sent to DM for approval!");
  };

  const getPlayerStatusColor = (status: string) => {
    switch (status) {
      case "active": return "bg-green-500";
      case "recruiting": return "bg-blue-500";
      case "full": return "bg-yellow-500";
      case "completed": return "bg-gray-500";
      default: return "bg-gray-500";
    }
  };

  const getPlayerStatusBadgeVariant = (status: string) => {
    switch (status) {
      case "active": return "default" as const;
      case "recruiting": return "secondary" as const;
      case "full": return "outline" as const;
      case "completed": return "outline" as const;
      default: return "outline" as const;
    }
  };

  const filteredPlayerCampaigns = playerCampaigns.filter(campaign =>
    campaign.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    campaign.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
    campaign.tags.some(tag => tag.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  const activeCampaigns = campaigns.filter(c => c.status === "active");

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
              <p className="text-sm text-muted-foreground">Dungeon Master Dashboard</p>
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
            <div className="text-2xl font-bold">{campaigns.length}</div>
            <div className="text-sm text-muted-foreground">Total Campaigns</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold">{activeCampaigns.length}</div>
            <div className="text-sm text-muted-foreground">Active Campaigns</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold">
              {campaigns.reduce((sum, camp) => sum + camp.playerCount, 0)}
            </div>
            <div className="text-sm text-muted-foreground">Total Players</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold">
              {campaigns.reduce((sum, camp) => sum + camp.locations.length, 0)}
            </div>
            <div className="text-sm text-muted-foreground">Locations Created</div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="p-6">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
          <TabsList>
            <TabsTrigger value="campaigns">Campaign Manager</TabsTrigger>
            <TabsTrigger value="player-tools">Player Tools</TabsTrigger>
          </TabsList>

          <TabsContent value="campaigns" className="space-y-6">
            <CampaignManager />
          </TabsContent>



          <TabsContent value="player-tools" className="space-y-6">
            <div className="mb-6">
              <h2 className="text-xl font-semibold mb-2">Player Tools</h2>
              <p className="text-muted-foreground">Manage your characters and campaigns when playing as a player in other DM's games.</p>
            </div>

            <Tabs defaultValue="my-characters" className="space-y-6">
              <TabsList>
                <TabsTrigger value="my-characters">My Characters</TabsTrigger>
                <TabsTrigger value="my-player-campaigns">My Player Campaigns</TabsTrigger>
                <TabsTrigger value="browse-campaigns">Browse Campaigns</TabsTrigger>
              </TabsList>

              <TabsContent value="my-characters" className="space-y-6">
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-semibold">Your Characters</h3>
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

              <TabsContent value="my-player-campaigns" className="space-y-6">
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-semibold">Your Player Campaigns</h3>
                </div>

                <div className="space-y-4">
                  {playerCampaigns.filter(c => c.isJoined).map((campaign) => (
                    <Card key={campaign.id}>
                      <CardContent className="p-6">
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            <div className="flex items-center gap-3 mb-2">
                              <div className={`w-3 h-3 rounded-full ${getPlayerStatusColor(campaign.status)}`} />
                              <h4 className="font-semibold text-lg">{campaign.name}</h4>
                              <Badge variant={getPlayerStatusBadgeVariant(campaign.status)} className="capitalize">
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

              <TabsContent value="browse-campaigns" className="space-y-6">
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-semibold">Browse Available Campaigns</h3>
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
                  {filteredPlayerCampaigns.map((campaign) => (
                    <Card key={campaign.id} className={campaign.isJoined ? "ring-2 ring-primary/20" : ""}>
                      <CardContent className="p-6">
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            <div className="flex items-center gap-3 mb-2">
                              <div className={`w-3 h-3 rounded-full ${getPlayerStatusColor(campaign.status)}`} />
                              <h4 className="font-semibold text-lg">{campaign.name}</h4>
                              <Badge variant={getPlayerStatusBadgeVariant(campaign.status)} className="capitalize">
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
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}