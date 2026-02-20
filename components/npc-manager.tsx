import { useState, useEffect, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Textarea } from './ui/textarea';
import { Badge } from './ui/badge';
import { Avatar, AvatarFallback } from './ui/avatar';
import { ScrollArea } from './ui/scroll-area';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from './ui/alert-dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs';
import { toast } from 'sonner';
import { fetchJson } from "../utils/api-client";
import { 
  Users,
  Plus,
  Trash2,
  Search,
  MapPin,
  Loader2
} from 'lucide-react';

interface NPC {
  id: string;
  campaign_id: string;
  name: string;
  description: string;
  race: string;
  occupation?: string;
  personality: string;
  appearance?: string;
  motivations?: string;
  secrets?: string;
  current_location_id: string | null;
  location_name?: string;
  avatar_url?: string;
  stats?: NPCStats;
  created_at: string;
  updated_at: string;
}

const NO_LOCATION_SELECT_VALUE = '__no_location__';

interface NPCStats {
  armor_class: number;
  hit_points: { max: number; current: number };
  speed: number;
  abilities: {
    strength: number;
    dexterity: number;
    constitution: number;
    intelligence: number;
    wisdom: number;
    charisma: number;
  };
  challenge_rating: number;
  actions: NPCAction[];
}

interface NPCAction {
  name: string;
  description: string;
  type: 'action' | 'bonus_action' | 'reaction' | 'legendary';
  recharge?: string;
}

interface NPCRelationship {
  id: string;
  npc_id: string;
  target_id: string;
  target_type: 'npc' | 'character';
  target_name: string;
  relationship_type: 'ally' | 'enemy' | 'neutral' | 'romantic' | 'family' | 'business';
  description: string;
  strength: number;
}

type NpcApiRecord = Omit<NPC, 'stats' | 'current_location_id'> & {
  stats?: NPCStats | string | null;
  current_location_id?: string | null;
};

interface LocationSummary {
  id: string;
  name: string;
}

const parseNpcRecord = (npc: NpcApiRecord): NPC => {
  let stats = npc?.stats ?? undefined;
  if (typeof stats === 'string') {
    try {
      stats = JSON.parse(stats);
    } catch (error) {
      console.warn('Failed to parse NPC stats payload', error);
      stats = undefined;
    }
  }

  const currentLocationId = typeof npc.current_location_id === 'string' && npc.current_location_id.trim()
    ? npc.current_location_id
    : null;

  return {
    ...npc,
    stats,
    current_location_id: currentLocationId,
  } as NPC;
};

export default function NPCManager({ campaignId, isDM }: { campaignId: string; isDM: boolean }) {
  const [npcs, setNpcs] = useState<NPC[]>([]);
  const [selectedNPC, setSelectedNPC] = useState<NPC | null>(null);
  const [detailNPC, setDetailNPC] = useState<NPC | null>(null);
  const [deleteNPCTarget, setDeleteNPCTarget] = useState<NPC | null>(null);
  const [locations, setLocations] = useState<LocationSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterLocation, setFilterLocation] = useState<string>('all');
  const [relationships, setRelationships] = useState<NPCRelationship[]>([]);

  // Create NPC form state
  const [showCreateForm, setShowCreateForm] = useState(false);
  const emptyNPC: Partial<NPC> = {
    name: '',
    description: '',
    race: '',
    occupation: '',
    personality: '',
    appearance: '',
    motivations: '',
    secrets: ''
  };
  const [newNPC, setNewNPC] = useState<Partial<NPC>>(emptyNPC);
  const npcInitialStateRef = useRef<Partial<NPC>>(emptyNPC);

  const isNpcFormDirty = () =>
    JSON.stringify(newNPC) !== JSON.stringify(npcInitialStateRef.current);

  const handleCreateFormClose = (open: boolean) => {
    if (!open && isNpcFormDirty()) {
      if (!window.confirm("You have unsaved changes. Discard them?")) return;
    }
    setShowCreateForm(open);
  };

  // Load NPCs and locations
  const loadNPCs = async () => {
    try {
      const data = await fetchJson<NpcApiRecord[]>(
        `/api/campaigns/${campaignId}/npcs`,
        undefined,
        'Failed to load NPCs',
      );
      setNpcs((data ?? []).map(parseNpcRecord));
    } catch (error) {
      console.error('Failed to load NPCs:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to load NPCs');
    }
  };

  const loadLocations = async () => {
    try {
      const data = await fetchJson<LocationSummary[]>(
        `/api/campaigns/${campaignId}/locations`,
        undefined,
        'Failed to load locations',
      );
      setLocations(data ?? []);
    } catch (error) {
      console.error('Failed to load locations:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to load locations');
    }
  };

  const loadRelationships = async (npcId: string) => {
    try {
      const data = await fetchJson<NPCRelationship[]>(
        `/api/npcs/${npcId}/relationships`,
        undefined,
        'Failed to load relationships',
      );
      setRelationships(data ?? []);
    } catch (error) {
      console.error('Failed to load relationships:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to load relationships');
    }
  };

  // Create NPC
  const createNPC = async (npcData: Partial<NPC>) => {
    if (!isDM) {
      toast.error('Only DMs can create NPCs');
      return;
    }

    try {
      await fetchJson<NpcApiRecord>(
        `/api/campaigns/${campaignId}/npcs`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(npcData),
        },
        'Failed to create NPC',
      );

      await loadNPCs();
      setShowCreateForm(false);
      setNewNPC({
        name: '',
        description: '',
        race: '',
        occupation: '',
        personality: '',
        appearance: '',
        motivations: '',
        secrets: ''
      });
      toast.success('NPC created successfully');
    } catch (error) {
      console.error('Failed to create NPC:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to create NPC');
    }
  };

  // Delete NPC
  const deleteNPC = async (npcId: string) => {
    if (!isDM) {
      toast.error('Only DMs can delete NPCs');
      return;
    }

    try {
      await fetchJson<{ success: boolean }>(
        `/api/npcs/${npcId}`,
        { method: 'DELETE' },
        'Failed to delete NPC',
      );

      await loadNPCs();
      if (selectedNPC?.id === npcId) {
        setSelectedNPC(null);
      }
      toast.success('NPC deleted successfully');
    } catch (error) {
      console.error('Failed to delete NPC:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to delete NPC');
    }
  };

  // Filter NPCs
  const filteredNPCs = npcs.filter(npc => {
    const matchesSearch = npc.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         npc.description.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         npc.race.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         npc.occupation?.toLowerCase().includes(searchTerm.toLowerCase());
    
    const matchesLocation = filterLocation === 'all' || 
                           (filterLocation === 'no_location' && !npc.current_location_id) ||
                           npc.current_location_id === filterLocation;
    
    return matchesSearch && matchesLocation;
  });

  // Format ability modifier
  const getAbilityModifier = (score: number) => {
    const modifier = Math.floor((score - 10) / 2);
    return modifier >= 0 ? `+${modifier}` : `${modifier}`;
  };

  // Get relationship color
  const getRelationshipColor = (type: string) => {
    switch (type) {
      case 'ally': return 'bg-green-500';
      case 'enemy': return 'bg-red-500';
      case 'neutral': return 'bg-gray-500';
      case 'romantic': return 'bg-pink-500';
      case 'family': return 'bg-blue-500';
      case 'business': return 'bg-yellow-500';
      default: return 'bg-gray-500';
    }
  };

  useEffect(() => {
    Promise.all([loadNPCs(), loadLocations()])
      .finally(() => setLoading(false));
  }, [campaignId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-48">
        <Loader2 className="w-6 h-6 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex justify-between items-center">
            <CardTitle className="flex items-center gap-2">
              <Users className="w-5 h-5" />
              NPC Management
            </CardTitle>
            <div className="flex items-center gap-2">
              <Badge variant="outline">
                {filteredNPCs.length} NPCs
              </Badge>
              {isDM && (
                <Button onClick={() => setShowCreateForm(true)}>
                  <Plus className="w-4 h-4 mr-2" />
                  Create NPC
                </Button>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {/* Search and Filter */}
          <div className="flex gap-4 mb-6">
            <div className="flex-1">
              <div className="relative">
                <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search NPCs..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-9"
                />
              </div>
            </div>
            <Select value={filterLocation} onValueChange={setFilterLocation}>
              <SelectTrigger className="w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Locations</SelectItem>
                <SelectItem value="no_location">No Location</SelectItem>
                {locations.map(location => (
                  <SelectItem key={location.id} value={location.id}>
                    {location.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* NPC Grid */}
          <ScrollArea className="h-96">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredNPCs.length === 0 ? (
                <div className="col-span-full text-center py-12">
                  <Users className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
                  <p className="text-muted-foreground">
                    {npcs.length === 0 
                      ? 'No NPCs created yet. Create some NPCs to populate your campaign world.'
                      : 'No NPCs match your search criteria.'}
                  </p>
                </div>
              ) : (
                filteredNPCs.map((npc) => (
                  <Card key={npc.id} className="cursor-pointer hover:shadow-md transition-shadow">
                    <CardContent className="p-4">
                      <div className="flex items-start gap-3 mb-3">
                        <Avatar>
                          <AvatarFallback>
                            {npc.name.slice(0, 2)}
                          </AvatarFallback>
                        </Avatar>
                        <div className="flex-1 min-w-0">
                          <h3 className="font-medium truncate">{npc.name}</h3>
                          <p className="text-sm text-muted-foreground">
                            {npc.race} {npc.occupation && `• ${npc.occupation}`}
                          </p>
                          {npc.location_name && (
                            <div className="flex items-center gap-1 mt-1">
                              <MapPin className="w-3 h-3" />
                              <span className="text-xs text-muted-foreground truncate">
                                {npc.location_name}
                              </span>
                            </div>
                          )}
                        </div>
                      </div>
                      
                      <p className="text-sm text-muted-foreground line-clamp-2 mb-3">
                        {npc.description}
                      </p>
                      
                      <div className="flex gap-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="flex-1"
                          onClick={() => {
                            setDetailNPC(npc);
                            loadRelationships(npc.id);
                          }}
                        >
                          View Details
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                ))
              )}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>

      {/* NPC Detail Dialog */}
      <Dialog open={Boolean(detailNPC)} onOpenChange={(open) => { if (!open) setDetailNPC(null); }}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          {detailNPC && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <Avatar>
                    <AvatarFallback>{detailNPC.name.slice(0, 2)}</AvatarFallback>
                  </Avatar>
                  {detailNPC.name}
                </DialogTitle>
              </DialogHeader>

              <Tabs defaultValue="details" className="w-full">
                <TabsList className="grid w-full grid-cols-3">
                  <TabsTrigger value="details">Details</TabsTrigger>
                  <TabsTrigger value="stats">Stats</TabsTrigger>
                  <TabsTrigger value="relationships">Relationships</TabsTrigger>
                </TabsList>

                <TabsContent value="details" className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label className="text-sm font-medium">Race</Label>
                      <p className="text-sm text-muted-foreground">{detailNPC.race}</p>
                    </div>
                    {detailNPC.occupation && (
                      <div>
                        <Label className="text-sm font-medium">Occupation</Label>
                        <p className="text-sm text-muted-foreground">{detailNPC.occupation}</p>
                      </div>
                    )}
                    {detailNPC.location_name && (
                      <div>
                        <Label className="text-sm font-medium">Location</Label>
                        <p className="text-sm text-muted-foreground">{detailNPC.location_name}</p>
                      </div>
                    )}
                  </div>
                  <div>
                    <Label className="text-sm font-medium">Description</Label>
                    <p className="text-sm text-muted-foreground mt-1">{detailNPC.description}</p>
                  </div>
                  <div>
                    <Label className="text-sm font-medium">Personality</Label>
                    <p className="text-sm text-muted-foreground mt-1">{detailNPC.personality}</p>
                  </div>
                  {detailNPC.appearance && (
                    <div>
                      <Label className="text-sm font-medium">Appearance</Label>
                      <p className="text-sm text-muted-foreground mt-1">{detailNPC.appearance}</p>
                    </div>
                  )}
                  {detailNPC.motivations && (
                    <div>
                      <Label className="text-sm font-medium">Motivations</Label>
                      <p className="text-sm text-muted-foreground mt-1">{detailNPC.motivations}</p>
                    </div>
                  )}
                  {isDM && detailNPC.secrets && (
                    <div>
                      <Label className="text-sm font-medium text-red-600">Secrets (DM Only)</Label>
                      <p className="text-sm text-muted-foreground mt-1 p-2 bg-red-50 rounded">{detailNPC.secrets}</p>
                    </div>
                  )}
                </TabsContent>

                <TabsContent value="stats" className="space-y-4">
                  {detailNPC.stats ? (
                    <div className="space-y-4">
                      <div className="grid grid-cols-3 gap-4">
                        <div className="text-center">
                          <Label className="text-sm font-medium">Armor Class</Label>
                          <p className="text-2xl font-bold">{detailNPC.stats.armor_class}</p>
                        </div>
                        <div className="text-center">
                          <Label className="text-sm font-medium">Hit Points</Label>
                          <p className="text-2xl font-bold">{detailNPC.stats.hit_points.current}/{detailNPC.stats.hit_points.max}</p>
                        </div>
                        <div className="text-center">
                          <Label className="text-sm font-medium">Speed</Label>
                          <p className="text-2xl font-bold">{detailNPC.stats.speed} ft.</p>
                        </div>
                      </div>
                      <div>
                        <Label className="text-sm font-medium">Abilities</Label>
                        <div className="grid grid-cols-6 gap-2 mt-2">
                          {Object.entries(detailNPC.stats.abilities).map(([ability, score]) => (
                            <div key={ability} className="text-center">
                              <p className="text-xs font-medium uppercase">{ability.substring(0, 3)}</p>
                              <p className="text-sm">{score}</p>
                              <p className="text-xs text-muted-foreground">({getAbilityModifier(score)})</p>
                            </div>
                          ))}
                        </div>
                      </div>
                      {detailNPC.stats.actions && detailNPC.stats.actions.length > 0 && (
                        <div>
                          <Label className="text-sm font-medium">Actions</Label>
                          <div className="space-y-2 mt-2">
                            {detailNPC.stats.actions.map((action, index) => (
                              <div key={index} className="border rounded p-2">
                                <div className="flex items-center gap-2">
                                  <h4 className="font-medium text-sm">{action.name}</h4>
                                  <Badge variant="outline" className="text-xs">{action.type.replace('_', ' ')}</Badge>
                                  {action.recharge && <Badge variant="secondary" className="text-xs">{action.recharge}</Badge>}
                                </div>
                                <p className="text-xs text-muted-foreground mt-1">{action.description}</p>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="text-center py-8">
                      <p className="text-muted-foreground">No stats defined for this NPC.</p>
                    </div>
                  )}
                </TabsContent>

                <TabsContent value="relationships" className="space-y-4">
                  <div className="flex justify-between items-center">
                    <Label className="text-sm font-medium">Relationships</Label>
                  </div>
                  {relationships.length === 0 ? (
                    <div className="text-center py-8">
                      <p className="text-muted-foreground">No relationships defined.</p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {relationships.map((relationship) => (
                        <div key={relationship.id} className="border rounded p-3">
                          <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center gap-2">
                              <Badge className={`text-xs ${getRelationshipColor(relationship.relationship_type)}`}>
                                {relationship.relationship_type}
                              </Badge>
                              <span className="font-medium text-sm">{relationship.target_name}</span>
                            </div>
                            <div className="flex items-center gap-1">
                              <span className="text-xs text-muted-foreground">Strength:</span>
                              <span className="text-xs">{relationship.strength}/10</span>
                            </div>
                          </div>
                          <p className="text-xs text-muted-foreground">{relationship.description}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </TabsContent>
              </Tabs>

              {isDM && (
                <div className="flex gap-2 pt-4 border-t">
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={() => {
                      setDeleteNPCTarget(detailNPC);
                    }}
                  >
                    <Trash2 className="w-4 h-4 mr-1" />
                    Delete
                  </Button>
                </div>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Delete NPC Confirmation */}
      <AlertDialog open={Boolean(deleteNPCTarget)} onOpenChange={(open) => { if (!open) setDeleteNPCTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete NPC</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete {deleteNPCTarget?.name}? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (deleteNPCTarget) {
                  deleteNPC(deleteNPCTarget.id);
                  setDeleteNPCTarget(null);
                  setDetailNPC(null);
                }
              }}
              className="bg-red-600 hover:bg-red-700"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Create NPC Dialog */}
      {showCreateForm && (
        <Dialog open={showCreateForm} onOpenChange={handleCreateFormClose}>
          <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Create New NPC</DialogTitle>
            </DialogHeader>
            
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Name *</Label>
                  <Input
                    value={newNPC.name || ''}
                    onChange={(e) => setNewNPC(prev => ({ ...prev, name: e.target.value }))}
                    placeholder="NPC name"
                  />
                </div>
                <div>
                  <Label>Race *</Label>
                  <Input
                    value={newNPC.race || ''}
                    onChange={(e) => setNewNPC(prev => ({ ...prev, race: e.target.value }))}
                    placeholder="e.g., Human, Elf, Dwarf"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Occupation</Label>
                  <Input
                    value={newNPC.occupation || ''}
                    onChange={(e) => setNewNPC(prev => ({ ...prev, occupation: e.target.value }))}
                    placeholder="e.g., Blacksmith, Guard, Merchant"
                  />
                </div>
                <div>
                  <Label>Location</Label>
                  <Select
                    value={newNPC.current_location_id ?? NO_LOCATION_SELECT_VALUE}
                    onValueChange={(value) =>
                      setNewNPC((prev) => ({
                        ...prev,
                        current_location_id: value === NO_LOCATION_SELECT_VALUE ? null : value,
                      }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select location" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NO_LOCATION_SELECT_VALUE}>No specific location</SelectItem>
                      {locations.map(location => (
                        <SelectItem key={location.id} value={location.id}>
                          {location.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div>
                <Label>Description *</Label>
                <Textarea
                  value={newNPC.description || ''}
                  onChange={(e) => setNewNPC(prev => ({ ...prev, description: e.target.value }))}
                  placeholder="Brief description of the NPC"
                  rows={3}
                />
              </div>

              <div>
                <Label>Personality *</Label>
                <Textarea
                  value={newNPC.personality || ''}
                  onChange={(e) => setNewNPC(prev => ({ ...prev, personality: e.target.value }))}
                  placeholder="Personality traits, mannerisms, speech patterns"
                  rows={3}
                />
              </div>

              <div>
                <Label>Appearance</Label>
                <Textarea
                  value={newNPC.appearance || ''}
                  onChange={(e) => setNewNPC(prev => ({ ...prev, appearance: e.target.value }))}
                  placeholder="Physical appearance and distinctive features"
                  rows={2}
                />
              </div>

              <div>
                <Label>Motivations</Label>
                <Textarea
                  value={newNPC.motivations || ''}
                  onChange={(e) => setNewNPC(prev => ({ ...prev, motivations: e.target.value }))}
                  placeholder="Goals, desires, fears"
                  rows={2}
                />
              </div>

              <div>
                <Label>Secrets (DM Only)</Label>
                <Textarea
                  value={newNPC.secrets || ''}
                  onChange={(e) => setNewNPC(prev => ({ ...prev, secrets: e.target.value }))}
                  placeholder="Hidden information, plot hooks"
                  rows={2}
                />
              </div>

              <div className="flex gap-2 pt-4 border-t">
                <Button
                  onClick={() => createNPC(newNPC)}
                  disabled={!newNPC.name?.trim() || !newNPC.race?.trim() || !newNPC.description?.trim() || !newNPC.personality?.trim()}
                  className="flex-1"
                >
                  Create NPC
                </Button>
                <Button variant="outline" onClick={() => handleCreateFormClose(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
