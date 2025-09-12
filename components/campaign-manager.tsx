import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Textarea } from "./ui/textarea";
import { ScrollArea } from "./ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "./ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "./ui/alert-dialog";
import { Avatar, AvatarFallback, AvatarImage } from "./ui/avatar";
import { Progress } from "./ui/progress";
import { toast } from "sonner@2.0.3";
import { 
  MapIcon,
  Plus,
  Edit,
  Trash2,
  Upload,
  Download,
  Image,
  Music,
  FileText,
  Users,
  Calendar,
  Star,
  Play,
  Pause,
  Volume2,
  VolumeX,
  Eye,
  Settings,
  Copy,
  Share,
  MapPin,
  Building,
  Home,
  Sword,
  Route,
  PersonStanding,
  Heart
} from "lucide-react";

interface Campaign {
  id: string;
  name: string;
  description: string;
  system: string;
  status: "planning" | "active" | "paused" | "completed";
  currentSession: number;
  totalSessions: number;
  lastPlayed: Date;
  createdAt: Date;
  dmId: string;
  playerIds: string[];
  coverImage?: string;
  assets: CampaignAsset[];
  storyArcs: StoryArc[];
  locations: Location[];
  npcs: NPC[];
  routes: GameRoute[];
}

interface CampaignAsset {
  id: string;
  name: string;
  type: "image" | "audio" | "document" | "map";
  url: string;
  description?: string;
  tags: string[];
  uploadedAt: Date;
  size: number;
}

interface StoryArc {
  id: string;
  title: string;
  description: string;
  status: "planning" | "active" | "completed";
  sessions: number[];
  characters: string[];
  plot_hooks: string[];
  rewards: string[];
  notes: string;
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

export function CampaignManager() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([
    {
      id: "1",
      name: "The Fellowship of the Ring",
      description: "Follow Frodo and the Fellowship on their epic quest to destroy the One Ring and save Middle-earth from the Dark Lord Sauron.",
      system: "D&D 5e",
      status: "active",
      currentSession: 12,
      totalSessions: 25,
      lastPlayed: new Date(),
      createdAt: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000),
      dmId: "dm1",
      playerIds: ["player1", "player2", "player3", "player4"],
      coverImage: "https://images.unsplash.com/photo-1578662996442-48f60103fc96?w=400",
      assets: [
        {
          id: "asset1",
          name: "Rivendell Battle Map",
          type: "map",
          url: "/maps/rivendell.jpg",
          description: "Detailed battle map of Rivendell for encounters",
          tags: ["map", "rivendell", "elves"],
          uploadedAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
          size: 2500000
        },
        {
          id: "asset2",
          name: "Hobbiton Ambience",
          type: "audio",
          url: "/audio/hobbiton_ambience.mp3",
          description: "Peaceful hobbiton background music",
          tags: ["ambient", "hobbiton", "peaceful"],
          uploadedAt: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000),
          size: 5200000
        },
        {
          id: "asset3",
          name: "Ring Lore Document",
          type: "document",
          url: "/docs/ring_lore.pdf",
          description: "Complete lore about the One Ring and its history",
          tags: ["lore", "ring", "history"],
          uploadedAt: new Date(Date.now() - 45 * 24 * 60 * 60 * 1000),
          size: 890000
        },
        {
          id: "asset4",
          name: "Gandalf Portrait",
          type: "image",
          url: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=300",
          description: "Portrait of Gandalf the Grey for NPC reference",
          tags: ["portrait", "gandalf", "npc"],
          uploadedAt: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000),
          size: 1200000
        }
      ],
      storyArcs: [
        {
          id: "arc1",
          title: "The Shire to Rivendell",
          description: "The journey from Bag End to the safety of Rivendell, establishing the Fellowship",
          status: "completed",
          sessions: [1, 2, 3, 4, 5],
          characters: ["Frodo", "Sam", "Merry", "Pippin", "Aragorn"],
          plot_hooks: [
            "Gandalf's disappearance",
            "The Ring's true nature revealed",
            "Black Riders pursuing the hobbits",
            "Meeting Aragorn at the Prancing Pony"
          ],
          rewards: ["Safe passage to Rivendell", "Sting and Mithril shirt"],
          notes: "Introduced main characters and established the central quest"
        },
        {
          id: "arc2",
          title: "The Fellowship's Journey",
          description: "From Rivendell through Moria to the breaking of the Fellowship",
          status: "active",
          sessions: [6, 7, 8, 9, 10, 11, 12],
          characters: ["Full Fellowship"],
          plot_hooks: [
            "Council of Elrond",
            "Passage through Moria",
            "Balrog encounter",
            "Lothlórien and Galadriel",
            "Boromir's temptation"
          ],
          rewards: ["Elven cloaks", "Lembas bread", "Boats from Lothlórien"],
          notes: "Currently in progress. Next session will likely involve Boromir's betrayal."
        },
        {
          id: "arc3",
          title: "The Road to Mordor",
          description: "Frodo and Sam's journey to Mount Doom with Gollum as guide",
          status: "planning",
          sessions: [],
          characters: ["Frodo", "Sam", "Gollum"],
          plot_hooks: [
            "Gollum's guidance and betrayal",
            "The Dead Marshes",
            "Encounter with Faramir",
            "Shelob's tunnel",
            "The final approach to Mount Doom"
          ],
          rewards: ["Completion of the quest", "Destruction of the Ring"],
          notes: "Major arc planned for after Fellowship breaks"
        }
      ],
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
      id: "2",
      name: "Curse of Strahd",
      description: "A gothic horror adventure in the demiplane of Barovia, ruled by the vampire lord Strahd von Zarovich.",
      system: "D&D 5e",
      status: "paused",
      currentSession: 8,
      totalSessions: 15,
      lastPlayed: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000),
      createdAt: new Date(Date.now() - 120 * 24 * 60 * 60 * 1000),
      dmId: "dm1",
      playerIds: ["player5", "player6", "player7"],
      assets: [],
      storyArcs: [],
      locations: [],
      npcs: [],
      routes: []
    },
    {
      id: "3",
      name: "Waterdeep: Dragon Heist",
      description: "Urban intrigue and faction politics in the City of Splendors.",
      system: "D&D 5e",
      status: "planning",
      currentSession: 0,
      totalSessions: 12,
      lastPlayed: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000),
      createdAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
      dmId: "dm1",
      playerIds: [],
      assets: [],
      storyArcs: [],
      locations: [],
      npcs: [],
      routes: []
    }
  ]);

  const [selectedCampaign, setSelectedCampaign] = useState<Campaign | null>(campaigns[0]);
  const [activeTab, setActiveTab] = useState<string>("overview");
  const [isCreating, setIsCreating] = useState(false);
  const [newCampaign, setNewCampaign] = useState<Partial<Campaign>>({
    name: "",
    description: "",
    system: "D&D 5e",
    status: "planning",
    currentSession: 0,
    totalSessions: 10
  });

  const handleCreateCampaign = () => {
    if (!newCampaign.name?.trim()) {
      toast.error("Please provide a campaign name");
      return;
    }

    const campaign: Campaign = {
      ...newCampaign as Campaign,
      id: Date.now().toString(),
      lastPlayed: new Date(),
      createdAt: new Date(),
      dmId: "dm1",
      playerIds: [],
      assets: [],
      storyArcs: [],
      locations: [],
      npcs: [],
      routes: []
    };

    setCampaigns(prev => [campaign, ...prev]);
    setSelectedCampaign(campaign);
    setNewCampaign({
      name: "",
      description: "",
      system: "D&D 5e",
      status: "planning",
      currentSession: 0,
      totalSessions: 10
    });
    setIsCreating(false);
    toast.success("Campaign created successfully!");
  };

  const handleDeleteCampaign = (id: string) => {
    setCampaigns(prev => prev.filter(campaign => campaign.id !== id));
    if (selectedCampaign?.id === id) {
      setSelectedCampaign(campaigns.find(c => c.id !== id) || null);
    }
    toast.success("Campaign deleted");
  };

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>, type: CampaignAsset["type"]) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // In a real app, you'd upload to a server
    const asset: CampaignAsset = {
      id: Date.now().toString(),
      name: file.name,
      type,
      url: URL.createObjectURL(file),
      description: "",
      tags: [],
      uploadedAt: new Date(),
      size: file.size
    };

    if (selectedCampaign) {
      const updatedCampaign = {
        ...selectedCampaign,
        assets: [...selectedCampaign.assets, asset]
      };
      setSelectedCampaign(updatedCampaign);
      setCampaigns(prev => prev.map(c => c.id === selectedCampaign.id ? updatedCampaign : c));
      toast.success(`${type} uploaded successfully`);
    }
    
    event.target.value = ''; // Reset input
  };

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const getAssetIcon = (type: string) => {
    switch (type) {
      case "image": return <Image className="w-4 h-4" />;
      case "audio": return <Music className="w-4 h-4" />;
      case "document": return <FileText className="w-4 h-4" />;
      case "map": return <MapIcon className="w-4 h-4" />;
      default: return <FileText className="w-4 h-4" />;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "active": return "bg-green-500";
      case "paused": return "bg-yellow-500";
      case "completed": return "bg-blue-500";
      case "planning": return "bg-gray-500";
      default: return "bg-gray-500";
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

  const getRelationshipColor = (relationship: string) => {
    switch (relationship) {
      case "ally": return "text-green-600 bg-green-50 border-green-200";
      case "enemy": return "text-red-600 bg-red-50 border-red-200";
      case "neutral": return "text-gray-600 bg-gray-50 border-gray-200";
      case "unknown": return "text-purple-600 bg-purple-50 border-purple-200";
      default: return "text-gray-600 bg-gray-50 border-gray-200";
    }
  };

  return (
    <div className="h-full flex flex-col">
      <div className="p-4 border-b">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold">Campaign Manager</h2>
          <Dialog open={isCreating} onOpenChange={setIsCreating}>
            <DialogTrigger asChild>
              <Button size="sm">
                <Plus className="w-4 h-4 mr-1" />
                New Campaign
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Create New Campaign</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div>
                  <Label htmlFor="name">Campaign Name *</Label>
                  <Input
                    id="name"
                    value={newCampaign.name || ""}
                    onChange={(e) => setNewCampaign(prev => ({ ...prev, name: e.target.value }))}
                    placeholder="Enter campaign name"
                  />
                </div>
                <div>
                  <Label htmlFor="description">Description</Label>
                  <Textarea
                    id="description"
                    value={newCampaign.description || ""}
                    onChange={(e) => setNewCampaign(prev => ({ ...prev, description: e.target.value }))}
                    placeholder="Enter campaign description"
                    rows={3}
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="system">Game System</Label>
                    <Select 
                      value={newCampaign.system || "D&D 5e"} 
                      onValueChange={(value) => setNewCampaign(prev => ({ ...prev, system: value }))}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="D&D 5e">D&D 5e</SelectItem>
                        <SelectItem value="Pathfinder 2e">Pathfinder 2e</SelectItem>
                        <SelectItem value="Call of Cthulhu">Call of Cthulhu</SelectItem>
                        <SelectItem value="Vampire: The Masquerade">Vampire: The Masquerade</SelectItem>
                        <SelectItem value="Other">Other</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label htmlFor="totalSessions">Planned Sessions</Label>
                    <Input
                      id="totalSessions"
                      type="number"
                      min="1"
                      value={newCampaign.totalSessions || 10}
                      onChange={(e) => setNewCampaign(prev => ({ ...prev, totalSessions: parseInt(e.target.value) }))}
                    />
                  </div>
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-4">
                <Button variant="outline" onClick={() => setIsCreating(false)}>
                  Cancel
                </Button>
                <Button onClick={handleCreateCampaign}>
                  Create Campaign
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>

        {/* Campaign Selection */}
        <div className="grid grid-cols-3 gap-2">
          {campaigns.map((campaign) => (
            <Card 
              key={campaign.id}
              className={`cursor-pointer transition-colors ${
                selectedCampaign?.id === campaign.id ? 'ring-2 ring-primary' : ''
              }`}
              onClick={() => setSelectedCampaign(campaign)}
            >
              <CardContent className="p-3">
                <div className="flex items-center gap-2 mb-2">
                  <div className={`w-2 h-2 rounded-full ${getStatusColor(campaign.status)}`} />
                  <h3 className="font-medium text-sm truncate">{campaign.name}</h3>
                </div>
                <p className="text-xs text-muted-foreground mb-2">
                  Session {campaign.currentSession}/{campaign.totalSessions}
                </p>
                <div className="flex items-center justify-between">
                  <Badge variant="outline" className="text-xs">{campaign.system}</Badge>
                  <span className="text-xs text-muted-foreground capitalize">{campaign.status}</span>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>

      {/* Campaign Details */}
      {selectedCampaign ? (
        <div className="flex-1 flex flex-col">
          <div className="p-4 border-b">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-xl font-semibold">{selectedCampaign.name}</h2>
              <div className="flex gap-2">
                <Button variant="outline" size="sm">
                  <Edit className="w-4 h-4 mr-1" />
                  Edit
                </Button>
                <Button variant="outline" size="sm">
                  <Share className="w-4 h-4 mr-1" />
                  Share
                </Button>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="outline" size="sm">
                      <Trash2 className="w-4 h-4 mr-1" />
                      Delete
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Delete Campaign</AlertDialogTitle>
                      <AlertDialogDescription>
                        Are you sure you want to delete "{selectedCampaign.name}"? This action cannot be undone.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={() => handleDeleteCampaign(selectedCampaign.id)}
                        className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                      >
                        Delete
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            </div>
            <div className="flex gap-4 text-sm text-muted-foreground">
              <span>{selectedCampaign.system}</span>
              <span>•</span>
              <span className="capitalize">{selectedCampaign.status}</span>
              <span>•</span>
              <span>{selectedCampaign.playerIds.length} players</span>
              <span>•</span>
              <span>Last played: {selectedCampaign.lastPlayed.toLocaleDateString()}</span>
            </div>
          </div>

          <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col">
            <TabsList className="mx-4 mt-4">
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="locations">Locations ({selectedCampaign.locations.length})</TabsTrigger>
              <TabsTrigger value="npcs">NPCs ({selectedCampaign.npcs.length})</TabsTrigger>
              <TabsTrigger value="routes">Routes ({selectedCampaign.routes.length})</TabsTrigger>
              <TabsTrigger value="assets">Assets ({selectedCampaign.assets.length})</TabsTrigger>
              <TabsTrigger value="story-arcs">Story Arcs ({selectedCampaign.storyArcs.length})</TabsTrigger>
              <TabsTrigger value="players">Players ({selectedCampaign.playerIds.length})</TabsTrigger>
            </TabsList>

            <TabsContent value="overview" className="flex-1 p-4 space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Calendar className="w-5 h-5" />
                    Campaign Progress
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    <div>
                      <div className="flex justify-between mb-2">
                        <span>Session Progress</span>
                        <span>{selectedCampaign.currentSession}/{selectedCampaign.totalSessions}</span>
                      </div>
                      <Progress value={(selectedCampaign.currentSession / selectedCampaign.totalSessions) * 100} />
                    </div>
                    <div className="grid grid-cols-3 gap-4 text-center">
                      <div>
                        <div className="text-2xl font-bold">{selectedCampaign.currentSession}</div>
                        <div className="text-sm text-muted-foreground">Current Session</div>
                      </div>
                      <div>
                        <div className="text-2xl font-bold">{selectedCampaign.assets.length}</div>
                        <div className="text-sm text-muted-foreground">Assets</div>
                      </div>
                      <div>
                        <div className="text-2xl font-bold">{selectedCampaign.storyArcs.length}</div>
                        <div className="text-sm text-muted-foreground">Story Arcs</div>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Description</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="leading-relaxed">{selectedCampaign.description}</p>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="assets" className="flex-1 p-4">
              <div className="space-y-4">
                <div className="flex gap-2">
                  <input
                    type="file"
                    accept="image/*"
                    onChange={(e) => handleFileUpload(e, "image")}
                    className="hidden"
                    id="upload-image"
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => document.getElementById('upload-image')?.click()}
                  >
                    <Image className="w-4 h-4 mr-1" />
                    Upload Image
                  </Button>
                  
                  <input
                    type="file"
                    accept="audio/*"
                    onChange={(e) => handleFileUpload(e, "audio")}
                    className="hidden"
                    id="upload-audio"
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => document.getElementById('upload-audio')?.click()}
                  >
                    <Music className="w-4 h-4 mr-1" />
                    Upload Audio
                  </Button>
                  
                  <input
                    type="file"
                    accept=".pdf,.doc,.docx,.txt"
                    onChange={(e) => handleFileUpload(e, "document")}
                    className="hidden"
                    id="upload-document"
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => document.getElementById('upload-document')?.click()}
                  >
                    <FileText className="w-4 h-4 mr-1" />
                    Upload Document
                  </Button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {selectedCampaign.assets.map((asset) => (
                    <Card key={asset.id}>
                      <CardContent className="p-4">
                        <div className="flex items-start justify-between mb-2">
                          <div className="flex items-center gap-2">
                            {getAssetIcon(asset.type)}
                            <Badge variant="outline" className="text-xs capitalize">{asset.type}</Badge>
                          </div>
                          <Button variant="ghost" size="sm" className="h-6 w-6 p-0">
                            <Trash2 className="w-3 h-3" />
                          </Button>
                        </div>
                        
                        <h4 className="font-medium mb-1">{asset.name}</h4>
                        <p className="text-xs text-muted-foreground mb-2">
                          {formatFileSize(asset.size)} • {asset.uploadedAt.toLocaleDateString()}
                        </p>
                        
                        {asset.description && (
                          <p className="text-sm text-muted-foreground mb-2">{asset.description}</p>
                        )}
                        
                        {asset.tags.length > 0 && (
                          <div className="flex flex-wrap gap-1 mb-2">
                            {asset.tags.map((tag, index) => (
                              <Badge key={index} variant="secondary" className="text-xs">
                                {tag}
                              </Badge>
                            ))}
                          </div>
                        )}
                        
                        {asset.type === "image" && (
                          <div className="w-full h-32 bg-muted rounded overflow-hidden">
                            <img src={asset.url} alt={asset.name} className="w-full h-full object-cover" />
                          </div>
                        )}
                        
                        {asset.type === "audio" && (
                          <div className="flex items-center gap-2 p-2 bg-muted rounded">
                            <Button variant="ghost" size="sm" className="h-6 w-6 p-0">
                              <Play className="w-3 h-3" />
                            </Button>
                            <div className="flex-1 bg-background rounded h-1">
                              <div className="bg-primary h-1 rounded w-0" />
                            </div>
                            <Button variant="ghost" size="sm" className="h-6 w-6 p-0">
                              <Volume2 className="w-3 h-3" />
                            </Button>
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </div>
            </TabsContent>

            <TabsContent value="locations" className="flex-1 p-4">
              <div className="space-y-4">
                <Button size="sm">
                  <Plus className="w-4 h-4 mr-1" />
                  Add Location
                </Button>

                <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {selectedCampaign.locations.map(location => (
                    <Card key={location.id} className="hover:shadow-md transition-shadow">
                      <CardHeader className="pb-3">
                        <div className="flex items-center gap-2">
                          {getLocationIcon(location.type)}
                          <CardTitle className="text-lg">{location.name}</CardTitle>
                          <Badge variant="outline" className="capitalize text-xs">
                            {location.type}
                          </Badge>
                        </div>
                      </CardHeader>
                      <CardContent className="space-y-3">
                        <p className="text-sm text-muted-foreground">{location.description}</p>
                        
                        {location.population && (
                          <div className="text-sm">
                            <span className="font-medium">Population:</span> {location.population.toLocaleString()}
                          </div>
                        )}
                        
                        {location.government && (
                          <div className="text-sm">
                            <span className="font-medium">Government:</span> {location.government}
                          </div>
                        )}

                        {location.markers.length > 0 && (
                          <div className="text-sm">
                            <span className="font-medium">Points of Interest:</span> {location.markers.length}
                          </div>
                        )}
                        
                        <div className="flex gap-2">
                          <Button variant="outline" size="sm" className="flex-1">
                            <Edit className="w-4 h-4 mr-1" />
                            Edit
                          </Button>
                          <Button variant="outline" size="sm" className="flex-1">
                            <MapPin className="w-4 h-4 mr-1" />
                            Map
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </div>
            </TabsContent>

            <TabsContent value="npcs" className="flex-1 p-4">
              <div className="space-y-4">
                <Button size="sm">
                  <Plus className="w-4 h-4 mr-1" />
                  Add NPC
                </Button>

                <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {selectedCampaign.npcs.map(npc => (
                    <Card key={npc.id} className="hover:shadow-md transition-shadow">
                      <CardHeader className="pb-3">
                        <div className="flex items-center gap-3">
                          <Avatar className="w-10 h-10">
                            <AvatarImage src={npc.avatar} />
                            <AvatarFallback>{npc.name.slice(0, 2)}</AvatarFallback>
                          </Avatar>
                          <div className="flex-1">
                            <CardTitle className="text-lg">{npc.name}</CardTitle>
                            <CardDescription>
                              {npc.race} {npc.class && `${npc.class} • `}{npc.role}
                            </CardDescription>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge 
                            variant="outline" 
                            className={`text-xs ${getRelationshipColor(npc.relationship)}`}
                          >
                            {npc.relationship}
                          </Badge>
                          <Badge variant="secondary" className="text-xs">
                            {npc.location}
                          </Badge>
                        </div>
                      </CardHeader>
                      <CardContent className="space-y-3">
                        <p className="text-sm text-muted-foreground">{npc.description}</p>
                        
                        {npc.notes && (
                          <div className="text-sm">
                            <span className="font-medium">Notes:</span> {npc.notes}
                          </div>
                        )}
                        
                        <div className="flex gap-2">
                          <Button variant="outline" size="sm" className="flex-1">
                            <Edit className="w-4 h-4 mr-1" />
                            Edit
                          </Button>
                          <Button variant="outline" size="sm" className="flex-1">
                            <Eye className="w-4 h-4 mr-1" />
                            View
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </div>
            </TabsContent>

            <TabsContent value="routes" className="flex-1 p-4">
              <div className="space-y-4">
                <Button size="sm">
                  <Plus className="w-4 h-4 mr-1" />
                  Add Route
                </Button>

                <div className="space-y-4">
                  {selectedCampaign.routes.map(route => (
                    <Card key={route.id}>
                      <CardContent className="p-6">
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            <div className="flex items-center gap-3 mb-2">
                              <Route className="w-5 h-5 text-muted-foreground" />
                              <h3 className="font-semibold text-lg">{route.name}</h3>
                              <Badge variant="outline" className={`capitalize ${
                                route.difficulty === "easy" ? "text-green-600" :
                                route.difficulty === "moderate" ? "text-yellow-600" :
                                route.difficulty === "hard" ? "text-orange-600" :
                                "text-red-600"
                              }`}>
                                {route.difficulty}
                              </Badge>
                            </div>
                            
                            <div className="flex items-center gap-4 text-sm text-muted-foreground mb-3">
                              <span>{route.from} → {route.to}</span>
                              <span>•</span>
                              <span>{route.distance}</span>
                            </div>
                            
                            <p className="text-muted-foreground mb-3">{route.description}</p>
                            
                            {route.encounters.length > 0 && (
                              <div>
                                <span className="text-sm font-medium">Possible Encounters: </span>
                                {route.encounters.map((encounter, index) => (
                                  <Badge key={index} variant="secondary" className="text-xs mr-1">
                                    {encounter}
                                  </Badge>
                                ))}
                              </div>
                            )}
                          </div>
                          
                          <div className="flex gap-2 ml-4">
                            <Button variant="outline" size="sm">
                              <Edit className="w-4 h-4 mr-1" />
                              Edit
                            </Button>
                            <Button variant="outline" size="sm">
                              <MapIcon className="w-4 h-4 mr-1" />
                              View on Map
                            </Button>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </div>
            </TabsContent>

            <TabsContent value="story-arcs" className="flex-1 p-4">
              <div className="space-y-4">
                <Button size="sm">
                  <Plus className="w-4 h-4 mr-1" />
                  New Story Arc
                </Button>

                <div className="space-y-4">
                  {selectedCampaign.storyArcs.map((arc) => (
                    <Card key={arc.id}>
                      <CardHeader>
                        <div className="flex items-center justify-between">
                          <CardTitle className="flex items-center gap-2">
                            <div className={`w-2 h-2 rounded-full ${getStatusColor(arc.status)}`} />
                            {arc.title}
                          </CardTitle>
                          <Badge variant="outline" className="capitalize">{arc.status}</Badge>
                        </div>
                      </CardHeader>
                      <CardContent>
                        <p className="text-sm text-muted-foreground mb-4">{arc.description}</p>
                        
                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <h5 className="font-medium mb-2">Sessions</h5>
                            <div className="flex flex-wrap gap-1">
                              {arc.sessions.map((session) => (
                                <Badge key={session} variant="secondary" className="text-xs">
                                  {session}
                                </Badge>
                              ))}
                            </div>
                          </div>
                          
                          <div>
                            <h5 className="font-medium mb-2">Characters</h5>
                            <div className="flex flex-wrap gap-1">
                              {arc.characters.map((character, index) => (
                                <Badge key={index} variant="outline" className="text-xs">
                                  {character}
                                </Badge>
                              ))}
                            </div>
                          </div>
                        </div>
                        
                        {arc.plot_hooks.length > 0 && (
                          <div className="mt-4">
                            <h5 className="font-medium mb-2">Plot Hooks</h5>
                            <ul className="list-disc list-inside space-y-1">
                              {arc.plot_hooks.map((hook, index) => (
                                <li key={index} className="text-sm text-muted-foreground">{hook}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                        
                        {arc.notes && (
                          <div className="mt-4">
                            <h5 className="font-medium mb-2">Notes</h5>
                            <p className="text-sm text-muted-foreground">{arc.notes}</p>
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </div>
            </TabsContent>

            <TabsContent value="players" className="flex-1 p-4">
              <div className="space-y-4">
                <Button size="sm">
                  <Plus className="w-4 h-4 mr-1" />
                  Invite Player
                </Button>

                <div className="text-center py-8 text-muted-foreground">
                  <Users className="w-12 h-12 mx-auto mb-4 opacity-50" />
                  <p>Player management coming soon</p>
                  <p className="text-sm">Invite players and manage permissions</p>
                </div>
              </div>
            </TabsContent>
          </Tabs>
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center text-muted-foreground">
          <div className="text-center">
            <MapIcon className="w-12 h-12 mx-auto mb-4 opacity-50" />
            <p>Select a campaign to manage</p>
          </div>
        </div>
      )}
    </div>
  );
}