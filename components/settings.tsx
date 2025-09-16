import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Textarea } from "./ui/textarea";
import { ScrollArea } from "./ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "./ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { Switch } from "./ui/switch";
import { Separator } from "./ui/separator";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "./ui/alert-dialog";
import { toast } from "sonner";
import { 
  Settings as SettingsIcon,
  Users,
  MapIcon,
  Bot,
  ExternalLink,
  Lock,
  Plus,
  Edit,
  Trash2,
  Eye,
  EyeOff,
  Key,
  Globe,
  Database,
  Shield,
  Bell,
  Palette,
  Moon,
  Sun,
  Monitor,
  Save,
  RotateCcw
} from "lucide-react";

interface User {
  id: string;
  username: string;
  email: string;
  role: "admin" | "dm" | "player";
  status: "active" | "inactive";
  lastLogin: Date;
  campaigns: string[];
}

interface Campaign {
  id: string;
  name: string;
  status: "active" | "paused" | "completed";
  playerCount: number;
}

interface LLMSettings {
  provider: "openai" | "anthropic" | "local";
  apiKey: string;
  model: string;
  temperature: number;
  maxTokens: number;
  systemPrompt: string;
  enabled: boolean;
}

interface Open5eSettings {
  apiUrl: string;
  enabled: boolean;
  cacheTimeout: number;
}

interface AppSettings {
  theme: "light" | "dark" | "system";
  notifications: boolean;
  autoSave: boolean;
  defaultDiceSound: boolean;
  compactMode: boolean;
}

export function Settings() {
  const [activeTab, setActiveTab] = useState<string>("users");
  const [showPassword, setShowPassword] = useState(false);

  const [users, setUsers] = useState<User[]>([
    {
      id: "1",
      username: "admin",
      email: "admin@dndapp.com",
      role: "admin",
      status: "active",
      lastLogin: new Date(),
      campaigns: ["1", "2"]
    },
    {
      id: "2",
      username: "gandalf_dm",
      email: "gandalf@fellowship.com",
      role: "dm",
      status: "active",
      lastLogin: new Date(Date.now() - 2 * 60 * 60 * 1000),
      campaigns: ["1"]
    },
    {
      id: "3",
      username: "frodo_player",
      email: "frodo@shire.com",
      role: "player",
      status: "active",
      lastLogin: new Date(Date.now() - 24 * 60 * 60 * 1000),
      campaigns: ["1"]
    },
    {
      id: "4",
      username: "aragorn_player",
      email: "aragorn@gondor.com",
      role: "player",
      status: "inactive",
      lastLogin: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
      campaigns: ["1"]
    }
  ]);

  const [campaigns] = useState<Campaign[]>([
    {
      id: "1",
      name: "The Fellowship of the Ring",
      status: "active",
      playerCount: 4
    },
    {
      id: "2",
      name: "Curse of Strahd",
      status: "paused",
      playerCount: 3
    },
    {
      id: "3",
      name: "Waterdeep: Dragon Heist",
      status: "completed",
      playerCount: 5
    }
  ]);

  const [llmSettings, setLlmSettings] = useState<LLMSettings>({
    provider: "openai",
    apiKey: "",
    model: "gpt-4",
    temperature: 0.7,
    maxTokens: 2048,
    systemPrompt: "You are a helpful D&D assistant that helps DMs and players with rules, lore, and campaign management.",
    enabled: false
  });

  const [open5eSettings, setOpen5eSettings] = useState<Open5eSettings>({
    apiUrl: "https://api.open5e.com",
    enabled: true,
    cacheTimeout: 3600
  });

  const [appSettings, setAppSettings] = useState<AppSettings>({
    theme: "system",
    notifications: true,
    autoSave: true,
    defaultDiceSound: true,
    compactMode: false
  });

  const [isCreatingUser, setIsCreatingUser] = useState(false);
  const [newUser, setNewUser] = useState<Partial<User>>({
    username: "",
    email: "",
    role: "player",
    status: "active"
  });

  const handleCreateUser = () => {
    if (!newUser.username?.trim() || !newUser.email?.trim()) {
      toast.error("Please provide username and email");
      return;
    }

    const user: User = {
      ...newUser as User,
      id: Date.now().toString(),
      lastLogin: new Date(),
      campaigns: []
    };

    setUsers(prev => [...prev, user]);
    setNewUser({
      username: "",
      email: "",
      role: "player",
      status: "active"
    });
    setIsCreatingUser(false);
    toast.success("User created successfully!");
  };

  const handleDeleteUser = (id: string) => {
    setUsers(prev => prev.filter(user => user.id !== id));
    toast.success("User deleted");
  };

  const handleSaveLLMSettings = () => {
    // In a real app, this would save to backend
    toast.success("LLM settings saved successfully!");
  };

  const handleSaveOpen5eSettings = () => {
    // In a real app, this would save to backend
    toast.success("Open5e settings saved successfully!");
  };

  const handleSaveAppSettings = () => {
    // In a real app, this would save to backend
    toast.success("Application settings saved successfully!");
  };

  const handleTestConnection = (type: "llm" | "open5e") => {
    // In a real app, this would test the actual connection
    toast.success(`${type.toUpperCase()} connection test successful!`);
  };

  const getRoleIcon = (role: string) => {
    switch (role) {
      case "admin": return <Shield className="w-4 h-4" />;
      case "dm": return <SettingsIcon className="w-4 h-4" />;
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

  const getStatusColor = (status: string) => {
    switch (status) {
      case "active": return "bg-green-500";
      case "inactive": return "bg-gray-500";
      default: return "bg-gray-500";
    }
  };

  return (
    <div className="h-full flex flex-col">
      <div className="p-4 border-b">
        <h2 className="font-semibold">Settings</h2>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col">
        <TabsList className="mx-4 mt-4">
          <TabsTrigger value="users">Users</TabsTrigger>
          <TabsTrigger value="campaigns">Campaigns</TabsTrigger>
          <TabsTrigger value="llm">LLM Settings</TabsTrigger>
          <TabsTrigger value="open5e">Open5e</TabsTrigger>
          <TabsTrigger value="security">Security</TabsTrigger>
          <TabsTrigger value="app">Application</TabsTrigger>
        </TabsList>

        <ScrollArea className="flex-1">
          <TabsContent value="users" className="p-4 space-y-4">
            <div className="flex justify-between items-center">
              <h3 className="font-medium">User Management</h3>
              <Dialog open={isCreatingUser} onOpenChange={setIsCreatingUser}>
                <DialogTrigger asChild>
                  <Button size="sm">
                    <Plus className="w-4 h-4 mr-1" />
                    Add User
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Create New User</DialogTitle>
                  </DialogHeader>
                  <div className="space-y-4">
                    <div>
                      <Label htmlFor="username">Username *</Label>
                      <Input
                        id="username"
                        value={newUser.username || ""}
                        onChange={(e) => setNewUser(prev => ({ ...prev, username: e.target.value }))}
                        placeholder="Enter username"
                      />
                    </div>
                    <div>
                      <Label htmlFor="email">Email *</Label>
                      <Input
                        id="email"
                        type="email"
                        value={newUser.email || ""}
                        onChange={(e) => setNewUser(prev => ({ ...prev, email: e.target.value }))}
                        placeholder="Enter email address"
                      />
                    </div>
                    <div>
                      <Label htmlFor="role">Role</Label>
                      <Select 
                        value={newUser.role || "player"} 
                        onValueChange={(value) => setNewUser(prev => ({ ...prev, role: value as any }))}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="player">Player</SelectItem>
                          <SelectItem value="dm">Dungeon Master</SelectItem>
                          <SelectItem value="admin">Administrator</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="flex justify-end gap-2 pt-4">
                    <Button variant="outline" onClick={() => setIsCreatingUser(false)}>
                      Cancel
                    </Button>
                    <Button onClick={handleCreateUser}>
                      Create User
                    </Button>
                  </div>
                </DialogContent>
              </Dialog>
            </div>

            <div className="space-y-2">
              {users.map((user) => (
                <Card key={user.id}>
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className={`w-2 h-2 rounded-full ${getStatusColor(user.status)}`} />
                        <div>
                          <div className="flex items-center gap-2">
                            {getRoleIcon(user.role)}
                            <h4 className="font-medium">{user.username}</h4>
                            <Badge variant={getRoleBadgeVariant(user.role)} className="text-xs capitalize">
                              {user.role}
                            </Badge>
                          </div>
                          <p className="text-sm text-muted-foreground">{user.email}</p>
                          <p className="text-xs text-muted-foreground">
                            Last login: {user.lastLogin.toLocaleDateString()} • {user.campaigns.length} campaigns
                          </p>
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <Button variant="outline" size="sm">
                          <Edit className="w-4 h-4 mr-1" />
                          Edit
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
                              <AlertDialogTitle>Delete User</AlertDialogTitle>
                              <AlertDialogDescription>
                                Are you sure you want to delete {user.username}? This action cannot be undone.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction
                                onClick={() => handleDeleteUser(user.id)}
                                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                              >
                                Delete
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </TabsContent>

          <TabsContent value="campaigns" className="p-4 space-y-4">
            <h3 className="font-medium">Campaign Overview</h3>
            <div className="space-y-2">
              {campaigns.map((campaign) => (
                <Card key={campaign.id}>
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <MapIcon className="w-5 h-5 text-muted-foreground" />
                        <div>
                          <h4 className="font-medium">{campaign.name}</h4>
                          <p className="text-sm text-muted-foreground">
                            {campaign.playerCount} players • Status: {campaign.status}
                          </p>
                        </div>
                      </div>
                      <Badge variant="outline" className="capitalize">
                        {campaign.status}
                      </Badge>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </TabsContent>

          <TabsContent value="llm" className="p-4 space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Bot className="w-5 h-5" />
                  LLM Configuration
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <Label>Enable LLM Integration</Label>
                    <p className="text-sm text-muted-foreground">
                      Enable AI assistance for campaign management and rule lookups
                    </p>
                  </div>
                  <Switch 
                    checked={llmSettings.enabled}
                    onCheckedChange={(checked) => setLlmSettings(prev => ({ ...prev, enabled: checked }))}
                  />
                </div>

                <Separator />

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="provider">Provider</Label>
                    <Select 
                      value={llmSettings.provider} 
                      onValueChange={(value) => setLlmSettings(prev => ({ ...prev, provider: value as any }))}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="openai">OpenAI</SelectItem>
                        <SelectItem value="anthropic">Anthropic</SelectItem>
                        <SelectItem value="local">Local Model</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label htmlFor="model">Model</Label>
                    <Input
                      id="model"
                      value={llmSettings.model}
                      onChange={(e) => setLlmSettings(prev => ({ ...prev, model: e.target.value }))}
                      placeholder="gpt-4"
                    />
                  </div>
                </div>

                <div>
                  <Label htmlFor="apiKey">API Key</Label>
                  <div className="relative">
                    <Input
                      id="apiKey"
                      type={showPassword ? "text" : "password"}
                      value={llmSettings.apiKey}
                      onChange={(e) => setLlmSettings(prev => ({ ...prev, apiKey: e.target.value }))}
                      placeholder="Enter your API key"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="absolute right-0 top-0 h-full px-3"
                      onClick={() => setShowPassword(!showPassword)}
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </Button>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="temperature">Temperature</Label>
                    <Input
                      id="temperature"
                      type="number"
                      min="0"
                      max="2"
                      step="0.1"
                      value={llmSettings.temperature}
                      onChange={(e) => setLlmSettings(prev => ({ ...prev, temperature: parseFloat(e.target.value) }))}
                    />
                  </div>
                  <div>
                    <Label htmlFor="maxTokens">Max Tokens</Label>
                    <Input
                      id="maxTokens"
                      type="number"
                      value={llmSettings.maxTokens}
                      onChange={(e) => setLlmSettings(prev => ({ ...prev, maxTokens: parseInt(e.target.value) }))}
                    />
                  </div>
                </div>

                <div>
                  <Label htmlFor="systemPrompt">System Prompt</Label>
                  <Textarea
                    id="systemPrompt"
                    value={llmSettings.systemPrompt}
                    onChange={(e) => setLlmSettings(prev => ({ ...prev, systemPrompt: e.target.value }))}
                    rows={4}
                    placeholder="Enter system prompt for the AI assistant"
                  />
                </div>

                <div className="flex gap-2">
                  <Button onClick={handleSaveLLMSettings}>
                    <Save className="w-4 h-4 mr-1" />
                    Save Settings
                  </Button>
                  <Button variant="outline" onClick={() => handleTestConnection("llm")}>
                    Test Connection
                  </Button>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="open5e" className="p-4 space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <ExternalLink className="w-5 h-5" />
                  Open5e Integration
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <Label>Enable Open5e Integration</Label>
                    <p className="text-sm text-muted-foreground">
                      Connect to Open5e API for spell and monster data
                    </p>
                  </div>
                  <Switch 
                    checked={open5eSettings.enabled}
                    onCheckedChange={(checked) => setOpen5eSettings(prev => ({ ...prev, enabled: checked }))}
                  />
                </div>

                <Separator />

                <div>
                  <Label htmlFor="apiUrl">API URL</Label>
                  <Input
                    id="apiUrl"
                    value={open5eSettings.apiUrl}
                    onChange={(e) => setOpen5eSettings(prev => ({ ...prev, apiUrl: e.target.value }))}
                    placeholder="https://api.open5e.com"
                  />
                </div>

                <div>
                  <Label htmlFor="cacheTimeout">Cache Timeout (seconds)</Label>
                  <Input
                    id="cacheTimeout"
                    type="number"
                    value={open5eSettings.cacheTimeout}
                    onChange={(e) => setOpen5eSettings(prev => ({ ...prev, cacheTimeout: parseInt(e.target.value) }))}
                  />
                </div>

                <div className="flex gap-2">
                  <Button onClick={handleSaveOpen5eSettings}>
                    <Save className="w-4 h-4 mr-1" />
                    Save Settings
                  </Button>
                  <Button variant="outline" onClick={() => handleTestConnection("open5e")}>
                    Test Connection
                  </Button>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="security" className="p-4 space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Lock className="w-5 h-5" />
                  Security Settings
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <Label htmlFor="currentPassword">Current Password</Label>
                  <Input
                    id="currentPassword"
                    type="password"
                    placeholder="Enter current password"
                  />
                </div>
                <div>
                  <Label htmlFor="newPassword">New Password</Label>
                  <Input
                    id="newPassword"
                    type="password"
                    placeholder="Enter new password"
                  />
                </div>
                <div>
                  <Label htmlFor="confirmPassword">Confirm New Password</Label>
                  <Input
                    id="confirmPassword"
                    type="password"
                    placeholder="Confirm new password"
                  />
                </div>
                <Button>
                  <Key className="w-4 h-4 mr-1" />
                  Update Password
                </Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Session Management</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <Label>Require Password Change</Label>
                    <p className="text-sm text-muted-foreground">
                      Force password change on next login
                    </p>
                  </div>
                  <Switch />
                </div>
                <div className="flex items-center justify-between">
                  <div>
                    <Label>Two-Factor Authentication</Label>
                    <p className="text-sm text-muted-foreground">
                      Enable 2FA for additional security
                    </p>
                  </div>
                  <Switch />
                </div>
                <Button variant="outline">
                  <Shield className="w-4 h-4 mr-1" />
                  Revoke All Sessions
                </Button>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="app" className="p-4 space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Palette className="w-5 h-5" />
                  Appearance
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <Label>Theme</Label>
                  <Select 
                    value={appSettings.theme} 
                    onValueChange={(value) => setAppSettings(prev => ({ ...prev, theme: value as any }))}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="light">
                        <div className="flex items-center gap-2">
                          <Sun className="w-4 h-4" />
                          Light
                        </div>
                      </SelectItem>
                      <SelectItem value="dark">
                        <div className="flex items-center gap-2">
                          <Moon className="w-4 h-4" />
                          Dark
                        </div>
                      </SelectItem>
                      <SelectItem value="system">
                        <div className="flex items-center gap-2">
                          <Monitor className="w-4 h-4" />
                          System
                        </div>
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex items-center justify-between">
                  <div>
                    <Label>Compact Mode</Label>
                    <p className="text-sm text-muted-foreground">
                      Use more compact interface elements
                    </p>
                  </div>
                  <Switch 
                    checked={appSettings.compactMode}
                    onCheckedChange={(checked) => setAppSettings(prev => ({ ...prev, compactMode: checked }))}
                  />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Bell className="w-5 h-5" />
                  Preferences
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <Label>Notifications</Label>
                    <p className="text-sm text-muted-foreground">
                      Show desktop notifications
                    </p>
                  </div>
                  <Switch 
                    checked={appSettings.notifications}
                    onCheckedChange={(checked) => setAppSettings(prev => ({ ...prev, notifications: checked }))}
                  />
                </div>

                <div className="flex items-center justify-between">
                  <div>
                    <Label>Auto Save</Label>
                    <p className="text-sm text-muted-foreground">
                      Automatically save changes
                    </p>
                  </div>
                  <Switch 
                    checked={appSettings.autoSave}
                    onCheckedChange={(checked) => setAppSettings(prev => ({ ...prev, autoSave: checked }))}
                  />
                </div>

                <div className="flex items-center justify-between">
                  <div>
                    <Label>Dice Sound Effects</Label>
                    <p className="text-sm text-muted-foreground">
                      Play sound when rolling dice
                    </p>
                  </div>
                  <Switch 
                    checked={appSettings.defaultDiceSound}
                    onCheckedChange={(checked) => setAppSettings(prev => ({ ...prev, defaultDiceSound: checked }))}
                  />
                </div>

                <div className="flex gap-2">
                  <Button onClick={handleSaveAppSettings}>
                    <Save className="w-4 h-4 mr-1" />
                    Save Settings
                  </Button>
                  <Button variant="outline">
                    <RotateCcw className="w-4 h-4 mr-1" />
                    Reset to Defaults
                  </Button>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </ScrollArea>
      </Tabs>
    </div>
  );
}
