import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { Input } from "./ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "./ui/avatar";
import { Progress } from "./ui/progress";
import { ScrollArea } from "./ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { CampaignManager } from "./campaign-manager";
import { MapManager } from "./map-manager";
import { toast } from "sonner";
import { 
  Crown, 
  Users, 
  MapIcon, 
  Settings, 
  LogOut,
  TrendingUp,
  AlertTriangle,
  Activity,
  Shield,
  Database,
  Server,
  Eye,
  Edit,
  Trash2,
  Search,
  Filter,
  BarChart3,
  PieChart,
  Calendar,
  Clock,
  UserCheck,
  UserX,
  Play,
  Pause,
  Ban,
  Plus,
  Star,
  UserPlus,
  User,
  Heart
} from "lucide-react";

interface User {
  id: string;
  username: string;
  email: string;
  role: "admin" | "dm" | "player";
  status: "active" | "inactive" | "banned";
  lastLogin: Date;
  joinedAt: Date;
  campaignsCount: number;
  charactersCount: number;
}

interface Campaign {
  id: string;
  name: string;
  dm: string;
  status: "active" | "recruiting" | "paused" | "completed";
  playerCount: number;
  maxPlayers: number;
  createdAt: Date;
  lastActivity: Date;
  system: string;
}

interface SystemStats {
  totalUsers: number;
  activeUsers: number;
  totalCampaigns: number;
  activeCampaigns: number;
  totalSessions: number;
  avgSessionLength: number;
  serverUptime: string;
  storageUsed: number;
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

interface AdminDashboardProps {
  user: { id: string; username: string; email: string; role: string };
  onEnterGame: () => void;
  onLogout: () => void;
}

export function AdminDashboard({ user, onEnterGame, onLogout }: AdminDashboardProps) {
  const [activeTab, setActiveTab] = useState("overview");
  const [searchQuery, setSearchQuery] = useState("");
  const [userFilter, setUserFilter] = useState("all");
  const [campaignSearchQuery, setCampaignSearchQuery] = useState("");

  const [systemStats] = useState<SystemStats>({
    totalUsers: 15247,
    activeUsers: 8429,
    totalCampaigns: 3891,
    activeCampaigns: 1203,
    totalSessions: 47382,
    avgSessionLength: 3.4,
    serverUptime: "99.94%",
    storageUsed: 67.3
  });

  const [users] = useState<User[]>([
    {
      id: "1",
      username: "Frodo Baggins",
      email: "frodo@shire.com",
      role: "player",
      status: "active",
      lastLogin: new Date(),
      joinedAt: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000),
      campaignsCount: 3,
      charactersCount: 5
    },
    {
      id: "2",
      username: "Gandalf Grey",
      email: "gandalf@fellowship.com",
      role: "dm",
      status: "active",
      lastLogin: new Date(Date.now() - 2 * 60 * 60 * 1000),
      joinedAt: new Date(Date.now() - 365 * 24 * 60 * 60 * 1000),
      campaignsCount: 8,
      charactersCount: 2
    },
    {
      id: "3",
      username: "Sauron Dark",
      email: "sauron@mordor.com",
      role: "player",
      status: "banned",
      lastLogin: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
      joinedAt: new Date(Date.now() - 180 * 24 * 60 * 60 * 1000),
      campaignsCount: 1,
      charactersCount: 3
    },
    {
      id: "4",
      username: "Elrond Rivendell",
      email: "elrond@rivendell.com",
      role: "dm",
      status: "inactive",
      lastLogin: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000),
      joinedAt: new Date(Date.now() - 730 * 24 * 60 * 60 * 1000),
      campaignsCount: 12,
      charactersCount: 4
    }
  ]);

  // Player character data (when acting as a player)
  const [characters] = useState<Character[]>([
    {
      id: "char1",
      name: "Elminster Aumar",
      class: "Wizard",
      level: 15,
      race: "Human",
      hitPoints: { current: 98, max: 105 },
      armorClass: 17,
      background: "Sage",
      campaigns: ["pcamp1"],
      lastPlayed: new Date(),
      avatar: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=100"
    },
    {
      id: "char2",
      name: "Artemis Entreri",
      class: "Rogue",
      level: 12,
      race: "Human",
      hitPoints: { current: 78, max: 84 },
      armorClass: 19,
      background: "Criminal",
      campaigns: ["pcamp2"],
      lastPlayed: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
      avatar: "https://images.unsplash.com/photo-1578662996442-48f60103fc96?w=100"
    }
  ]);

  // Player campaigns (when acting as a player)
  const [playerCampaigns] = useState<PlayerCampaign[]>([
    {
      id: "pcamp1",
      name: "Princes of the Apocalypse",
      description: "Four cults spread elemental evil across the Sword Coast.",
      dm: "ElementalMaster",
      status: "active",
      playerCount: 5,
      maxPlayers: 6,
      system: "D&D 5e",
      nextSession: new Date(Date.now() + 1 * 24 * 60 * 60 * 1000),
      tags: ["Epic", "Elemental", "High Level"],
      level: { min: 10, max: 15 },
      isJoined: true
    },
    {
      id: "pcamp2",
      name: "Out of the Abyss",
      description: "Escape the Underdark and stop demon lords from destroying the world.",
      dm: "AbyssMaster",
      status: "active",
      playerCount: 4,
      maxPlayers: 5,
      system: "D&D 5e",
      nextSession: new Date(Date.now() + 6 * 24 * 60 * 60 * 1000),
      tags: ["Horror", "Underdark", "Demons"],
      level: { min: 1, max: 15 },
      isJoined: true
    },
    {
      id: "pcamp3",
      name: "Descent into Avernus",
      description: "Journey to the Nine Hells to save the city of Elturel.",
      dm: "HellMaster",
      status: "recruiting",
      playerCount: 3,
      maxPlayers: 6,
      system: "D&D 5e",
      tags: ["Horror", "Planar", "High Level"],
      level: { min: 1, max: 13 },
      isJoined: false
    }
  ]);

  const [campaigns] = useState<Campaign[]>([
    {
      id: "1",
      name: "The Fellowship of the Ring",
      dm: "Gandalf Grey",
      status: "active",
      playerCount: 4,
      maxPlayers: 6,
      createdAt: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000),
      lastActivity: new Date(),
      system: "D&D 5e"
    },
    {
      id: "2",
      name: "Curse of Strahd",
      dm: "VampireMaster",
      status: "recruiting",
      playerCount: 2,
      maxPlayers: 5,
      createdAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
      lastActivity: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
      system: "D&D 5e"
    },
    {
      id: "3",
      name: "Abandoned Campaign",
      dm: "OldDM",
      status: "paused",
      playerCount: 1,
      maxPlayers: 4,
      createdAt: new Date(Date.now() - 180 * 24 * 60 * 60 * 1000),
      lastActivity: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000),
      system: "D&D 5e"
    }
  ]);

  const getStatusColor = (status: string) => {
    switch (status) {
      case "active": return "bg-green-500";
      case "inactive": return "bg-yellow-500";
      case "banned": return "bg-red-500";
      case "recruiting": return "bg-blue-500";
      case "paused": return "bg-orange-500";
      case "completed": return "bg-gray-500";
      default: return "bg-gray-500";
    }
  };

  const getRoleIcon = (role: string) => {
    switch (role) {
      case "admin": return <Crown className="w-4 h-4" />;
      case "dm": return <Shield className="w-4 h-4" />;
      case "player": return <Users className="w-4 h-4" />;
      default: return <Users className="w-4 h-4" />;
    }
  };

  const getRoleBadgeVariant = (role: string) => {
    switch (role) {
      case "admin": return "destructive" as const;
      case "dm": return "default" as const;
      case "player": return "secondary" as const;
      default: return "secondary" as const;
    }
  };

  const filteredUsers = users.filter(user => {
    const matchesSearch = user.username.toLowerCase().includes(searchQuery.toLowerCase()) ||
                         user.email.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesFilter = userFilter === "all" || user.role === userFilter || user.status === userFilter;
    return matchesSearch && matchesFilter;
  });

  const handleUserAction = (userId: string, action: "activate" | "deactivate" | "ban" | "unban") => {
    const actionText = {
      activate: "activated",
      deactivate: "deactivated", 
      ban: "banned",
      unban: "unbanned"
    }[action];
    
    toast.success(`User ${actionText} successfully`);
  };

  const handleCampaignAction = (campaignId: string, action: "pause" | "resume" | "archive") => {
    const actionText = {
      pause: "paused",
      resume: "resumed",
      archive: "archived"
    }[action];
    
    toast.success(`Campaign ${actionText} successfully`);
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
    campaign.name.toLowerCase().includes(campaignSearchQuery.toLowerCase()) ||
    campaign.description.toLowerCase().includes(campaignSearchQuery.toLowerCase()) ||
    campaign.tags.some(tag => tag.toLowerCase().includes(campaignSearchQuery.toLowerCase()))
  );

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
              <h1 className="font-semibold">System Administrator</h1>
              <p className="text-sm text-muted-foreground">Admin Dashboard • {user.username}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-green-600 border-green-600">
              <Activity className="w-3 h-3 mr-1" />
              System Online
            </Badge>
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
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-4">
          <div className="text-center">
            <div className="text-2xl font-bold text-blue-600">{systemStats.totalUsers.toLocaleString()}</div>
            <div className="text-sm text-muted-foreground">Total Users</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold text-green-600">{systemStats.activeUsers.toLocaleString()}</div>
            <div className="text-sm text-muted-foreground">Active Users</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold text-purple-600">{systemStats.totalCampaigns.toLocaleString()}</div>
            <div className="text-sm text-muted-foreground">Total Campaigns</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold text-orange-600">{systemStats.activeCampaigns.toLocaleString()}</div>
            <div className="text-sm text-muted-foreground">Active Campaigns</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold">{systemStats.totalSessions.toLocaleString()}</div>
            <div className="text-sm text-muted-foreground">Total Sessions</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold">{systemStats.avgSessionLength}h</div>
            <div className="text-sm text-muted-foreground">Avg Session</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold text-green-600">{systemStats.serverUptime}</div>
            <div className="text-sm text-muted-foreground">Uptime</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold">{systemStats.storageUsed}%</div>
            <div className="text-sm text-muted-foreground">Storage Used</div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="p-6">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
          <TabsList>
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="users">User Management</TabsTrigger>
            <TabsTrigger value="campaigns">Campaign Manager</TabsTrigger>
            <TabsTrigger value="maps">Map Manager</TabsTrigger>
            <TabsTrigger value="analytics">Analytics</TabsTrigger>
            <TabsTrigger value="system">System Health</TabsTrigger>
            <TabsTrigger value="player-tools">Player Tools</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-6">
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
              {/* User Activity */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <TrendingUp className="w-5 h-5" />
                    User Activity
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex justify-between">
                    <span>Active Today</span>
                    <span className="font-semibold">2,847</span>
                  </div>
                  <div className="flex justify-between">
                    <span>New Signups (7d)</span>
                    <span className="font-semibold">143</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Sessions Today</span>
                    <span className="font-semibold">5,231</span>
                  </div>
                  <Progress value={73} className="mt-4" />
                  <p className="text-sm text-muted-foreground">73% of daily target reached</p>
                </CardContent>
              </Card>

              {/* Campaign Statistics */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <BarChart3 className="w-5 h-5" />
                    Campaign Stats
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex justify-between">
                    <span>Active Campaigns</span>
                    <span className="font-semibold">{systemStats.activeCampaigns}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Recruiting</span>
                    <span className="font-semibold">287</span>
                  </div>
                  <div className="flex justify-between">
                    <span>New This Week</span>
                    <span className="font-semibold">52</span>
                  </div>
                  <Progress value={85} className="mt-4" />
                  <p className="text-sm text-muted-foreground">85% capacity utilization</p>
                </CardContent>
              </Card>

              {/* System Alerts */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <AlertTriangle className="w-5 h-5" />
                    System Alerts
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex items-center gap-3 p-2 bg-yellow-50 rounded border-l-4 border-yellow-400">
                    <AlertTriangle className="w-4 h-4 text-yellow-600" />
                    <div className="text-sm">
                      <div className="font-medium">High Storage Usage</div>
                      <div className="text-muted-foreground">Storage at 67% capacity</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 p-2 bg-blue-50 rounded border-l-4 border-blue-400">
                    <Activity className="w-4 h-4 text-blue-600" />
                    <div className="text-sm">
                      <div className="font-medium">Peak Usage</div>
                      <div className="text-muted-foreground">High traffic detected</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 p-2 bg-green-50 rounded border-l-4 border-green-400">
                    <UserCheck className="w-4 h-4 text-green-600" />
                    <div className="text-sm">
                      <div className="font-medium">System Healthy</div>
                      <div className="text-muted-foreground">All services operational</div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Recent Activity */}
            <Card>
              <CardHeader>
                <CardTitle>Recent Activity</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div className="flex items-center gap-3 p-3 bg-muted/50 rounded">
                    <UserCheck className="w-4 h-4 text-green-600" />
                    <div className="flex-1">
                      <div className="text-sm font-medium">New user registered: Aragorn Ranger</div>
                      <div className="text-xs text-muted-foreground">2 minutes ago</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 p-3 bg-muted/50 rounded">
                    <MapIcon className="w-4 h-4 text-blue-600" />
                    <div className="flex-1">
                      <div className="text-sm font-medium">Campaign created: "Lost Mine of Phandelver"</div>
                      <div className="text-xs text-muted-foreground">15 minutes ago</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 p-3 bg-muted/50 rounded">
                    <AlertTriangle className="w-4 h-4 text-yellow-600" />
                    <div className="flex-1">
                      <div className="text-sm font-medium">Inactive campaign flagged for review</div>
                      <div className="text-xs text-muted-foreground">1 hour ago</div>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="users" className="space-y-6">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-semibold">User Management</h2>
              <div className="flex gap-2">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground w-4 h-4" />
                  <Input
                    placeholder="Search users..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-10 w-64"
                  />
                </div>
                <Select value={userFilter} onValueChange={setUserFilter}>
                  <SelectTrigger className="w-40">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Users</SelectItem>
                    <SelectItem value="admin">Admins</SelectItem>
                    <SelectItem value="dm">DMs</SelectItem>
                    <SelectItem value="player">Players</SelectItem>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="inactive">Inactive</SelectItem>
                    <SelectItem value="banned">Banned</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-4">
              {filteredUsers.map((user) => (
                <Card key={user.id}>
                  <CardContent className="p-6">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-4">
                        <Avatar className="w-12 h-12">
                          <AvatarImage src={`https://avatar.vercel.sh/${user.username}`} />
                          <AvatarFallback>{user.username.slice(0, 2).toUpperCase()}</AvatarFallback>
                        </Avatar>
                        <div>
                          <div className="flex items-center gap-3">
                            <h3 className="font-semibold">{user.username}</h3>
                            <div className={`w-2 h-2 rounded-full ${getStatusColor(user.status)}`} />
                            <Badge variant={getRoleBadgeVariant(user.role)} className="text-xs">
                              {getRoleIcon(user.role)}
                              <span className="ml-1 capitalize">{user.role}</span>
                            </Badge>
                            <Badge variant="outline" className={`text-xs capitalize ${
                              user.status === "active" ? "text-green-600 border-green-600" :
                              user.status === "inactive" ? "text-yellow-600 border-yellow-600" :
                              "text-red-600 border-red-600"
                            }`}>
                              {user.status}
                            </Badge>
                          </div>
                          <p className="text-sm text-muted-foreground">{user.email}</p>
                          <div className="flex items-center gap-4 text-xs text-muted-foreground mt-1">
                            <span>Joined: {user.joinedAt.toLocaleDateString()}</span>
                            <span>•</span>
                            <span>Last login: {user.lastLogin.toLocaleDateString()}</span>
                            <span>•</span>
                            <span>{user.campaignsCount} campaigns</span>
                            <span>•</span>
                            <span>{user.charactersCount} characters</span>
                          </div>
                        </div>
                      </div>
                      
                      <div className="flex gap-2">
                        <Button variant="outline" size="sm">
                          <Eye className="w-4 h-4 mr-1" />
                          View
                        </Button>
                        <Button variant="outline" size="sm">
                          <Edit className="w-4 h-4 mr-1" />
                          Edit
                        </Button>
                        {user.status === "active" ? (
                          <Button 
                            variant="outline" 
                            size="sm"
                            onClick={() => handleUserAction(user.id, "deactivate")}
                          >
                            <Pause className="w-4 h-4 mr-1" />
                            Deactivate
                          </Button>
                        ) : user.status === "inactive" ? (
                          <Button 
                            variant="outline" 
                            size="sm"
                            onClick={() => handleUserAction(user.id, "activate")}
                          >
                            <Play className="w-4 h-4 mr-1" />
                            Activate
                          </Button>
                        ) : null}
                        {user.status !== "banned" ? (
                          <Button 
                            variant="destructive" 
                            size="sm"
                            onClick={() => handleUserAction(user.id, "ban")}
                          >
                            <Ban className="w-4 h-4 mr-1" />
                            Ban
                          </Button>
                        ) : (
                          <Button 
                            variant="outline" 
                            size="sm"
                            onClick={() => handleUserAction(user.id, "unban")}
                          >
                            <UserCheck className="w-4 h-4 mr-1" />
                            Unban
                          </Button>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </TabsContent>

          <TabsContent value="campaigns" className="space-y-6">
            <CampaignManager />
          </TabsContent>

          <TabsContent value="maps" className="space-y-6">
            <MapManager />
          </TabsContent>

          <TabsContent value="analytics" className="space-y-6">
            <h2 className="text-xl font-semibold">Analytics & Reports</h2>
            
            <div className="grid md:grid-cols-2 gap-6">
              <Card>
                <CardHeader>
                  <CardTitle>User Growth</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="h-64 flex items-center justify-center text-muted-foreground">
                    <PieChart className="w-16 h-16 mr-4" />
                    <div>
                      <p>User growth chart would be displayed here</p>
                      <p className="text-sm">Showing 30-day trend</p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Campaign Activity</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="h-64 flex items-center justify-center text-muted-foreground">
                    <BarChart3 className="w-16 h-16 mr-4" />
                    <div>
                      <p>Campaign activity chart would be displayed here</p>
                      <p className="text-sm">Sessions per day/week</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="system" className="space-y-6">
            <h2 className="text-xl font-semibold">System Health</h2>
            
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Server className="w-5 h-5" />
                    Server Status
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex justify-between">
                    <span>Uptime</span>
                    <Badge variant="outline" className="text-green-600 border-green-600">
                      {systemStats.serverUptime}
                    </Badge>
                  </div>
                  <div className="flex justify-between">
                    <span>CPU Usage</span>
                    <span>23%</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Memory Usage</span>
                    <span>67%</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Response Time</span>
                    <span>142ms</span>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Database className="w-5 h-5" />
                    Database
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex justify-between">
                    <span>Storage Used</span>
                    <span>{systemStats.storageUsed}%</span>
                  </div>
                  <Progress value={systemStats.storageUsed} />
                  <div className="flex justify-between">
                    <span>Query Time</span>
                    <span>15ms avg</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Connections</span>
                    <span>847/1000</span>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Activity className="w-5 h-5" />
                    Performance
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex justify-between">
                    <span>Requests/min</span>
                    <span>2,847</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Error Rate</span>
                    <span className="text-green-600">0.02%</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Active Sessions</span>
                    <span>1,203</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Cache Hit Rate</span>
                    <span>94.7%</span>
                  </div>
                </CardContent>
              </Card>
            </div>
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
                      value={campaignSearchQuery}
                      onChange={(e) => setCampaignSearchQuery(e.target.value)}
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
