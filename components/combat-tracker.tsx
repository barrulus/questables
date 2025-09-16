import { useState, useEffect, useContext } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Badge } from "./ui/badge";
import { Progress } from "./ui/progress";
import { Separator } from "./ui/separator";
import { Avatar, AvatarFallback } from "./ui/avatar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";
import { Textarea } from "./ui/textarea";
import { useUser } from "../contexts/UserContext";
import { useWebSocket } from '../hooks/useWebSocket';
import { 
  Sword, 
  Shield, 
  Heart, 
  Zap, 
  Plus, 
  Minus, 
  RotateCcw, 
  Play, 
  Square,
  Loader2,
  Users
} from "lucide-react";

interface Encounter {
  id: string;
  campaign_id: string;
  session_id?: string;
  location_id?: string;
  name: string;
  description: string;
  type: 'combat' | 'social' | 'exploration' | 'puzzle';
  difficulty: 'easy' | 'medium' | 'hard' | 'deadly';
  status: 'planned' | 'active' | 'completed';
  current_round: number;
  initiative_order?: any[];
  participant_count: number;
  location_name?: string;
  session_title?: string;
}

interface EncounterParticipant {
  id: string;
  encounter_id: string;
  participant_id: string;
  participant_type: 'character' | 'npc';
  name: string;
  initiative?: number;
  hit_points: { max: number; current: number; temporary: number };
  armor_class: number;
  conditions: string[];
  has_acted: boolean;
}

interface Condition {
  name: string;
  description: string;
  color: string;
}

export default function CombatTracker({ 
  campaignId, 
  sessionId, 
  isDM 
}: { 
  campaignId: string; 
  sessionId?: string; 
  isDM: boolean 
}) {
  const { user } = useUser();
  const [encounters, setEncounters] = useState<Encounter[]>([]);
  const [activeEncounter, setActiveEncounter] = useState<Encounter | null>(null);
  const [participants, setParticipants] = useState<EncounterParticipant[]>([]);
  const [loading, setLoading] = useState(true);
  
  // WebSocket integration for real-time combat updates
  const { 
    connected, 
    updateCombat, 
    getMessagesByType 
  } = useWebSocket(campaignId);
  
  // Create encounter form
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newEncounterName, setNewEncounterName] = useState('');
  const [newEncounterDescription, setNewEncounterDescription] = useState('');
  const [newEncounterType, setNewEncounterType] = useState<'combat' | 'social' | 'exploration' | 'puzzle'>('combat');
  const [newEncounterDifficulty, setNewEncounterDifficulty] = useState<'easy' | 'medium' | 'hard' | 'deadly'>('medium');
  
  // Add participant form
  const [showAddParticipant, setShowAddParticipant] = useState(false);
  const [newParticipantName, setNewParticipantName] = useState('');
  const [newParticipantType, setNewParticipantType] = useState<'character' | 'npc'>('npc');
  const [newParticipantHP, setNewParticipantHP] = useState<{ max: number; current: number }>({ max: 10, current: 10 });
  const [newParticipantAC, setNewParticipantAC] = useState(10);

  const conditions: Condition[] = [
    { name: "Blessed", description: "+1d4 to attacks and saves", color: "bg-blue-500" },
    { name: "Poisoned", description: "Disadvantage on attacks and ability checks", color: "bg-green-500" },
    { name: "Unconscious", description: "Incapacitated and prone", color: "bg-red-500" },
    { name: "Prone", description: "Disadvantage on attacks", color: "bg-yellow-500" },
    { name: "Blinded", description: "Cannot see, attacks have disadvantage", color: "bg-gray-500" },
    { name: "Stunned", description: "Incapacitated, cannot move", color: "bg-purple-500" }
  ];

  // Load encounters and participants
  const loadEncounters = async () => {
    try {
      const response = await fetch(`/api/campaigns/${campaignId}/encounters`);
      if (response.ok) {
        const data = await response.json();
        setEncounters(data);
        
        // Set active encounter if there is one
        const activeEnc = data.find((e: Encounter) => e.status === 'active');
        if (activeEnc) {
          setActiveEncounter(activeEnc);
          await loadParticipants(activeEnc.id);
        }
      }
    } catch (error) {
      console.error('Failed to load encounters:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadParticipants = async (encounterId: string) => {
    try {
      const response = await fetch(`/api/encounters/${encounterId}/participants`);
      if (response.ok) {
        const data = await response.json();
        setParticipants(data);
      }
    } catch (error) {
      console.error('Failed to load participants:', error);
    }
  };

  // Create encounter
  const createEncounter = async (encounterData: Omit<Encounter, 'id' | 'campaign_id' | 'status' | 'current_round' | 'participant_count'>) => {
    try {
      const response = await fetch(`/api/campaigns/${campaignId}/encounters`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...encounterData, session_id: sessionId })
      });

      if (response.ok) {
        const newEncounter = await response.json();
        setEncounters(prev => [...prev, newEncounter]);
        setShowCreateForm(false);
        setNewEncounterName('');
        setNewEncounterDescription('');
      }
    } catch (error) {
      console.error('Failed to create encounter:', error);
    }
  };

  // Add participant
  const addParticipant = async (participantData: {
    participant_id: string;
    participant_type: 'character' | 'npc';
    name: string;
    hit_points: { max: number; current: number; temporary: number };
    armor_class: number;
  }) => {
    if (!activeEncounter) return;

    try {
      const response = await fetch(`/api/encounters/${activeEncounter.id}/participants`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(participantData)
      });

      if (response.ok) {
        await loadParticipants(activeEncounter.id);
        setShowAddParticipant(false);
        setNewParticipantName('');
      }
    } catch (error) {
      console.error('Failed to add participant:', error);
    }
  };

  // Roll initiative
  const rollInitiative = async () => {
    if (!activeEncounter) return;

    // Roll initiative for all participants
    const initiativeOrder = participants.map(p => ({
      participantId: p.id,
      initiative: Math.floor(Math.random() * 20) + 1, // Simple d20 roll
      hasActed: false
    })).sort((a, b) => b.initiative - a.initiative);

    try {
      const response = await fetch(`/api/encounters/${activeEncounter.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: 'active',
          current_round: 1,
          initiative_order: initiativeOrder
        })
      });

      if (response.ok) {
        const updatedEncounter = await response.json();
        setActiveEncounter(updatedEncounter);
        await loadParticipants(activeEncounter.id);
      }
    } catch (error) {
      console.error('Failed to roll initiative:', error);
    }
  };

  // Update participant HP
  const updateParticipantHP = async (participantId: string, newHP: { max: number; current: number; temporary: number }) => {
    try {
      const response = await fetch(`/api/encounter-participants/${participantId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hit_points: newHP })
      });

      if (response.ok) {
        setParticipants(prev => prev.map(p => 
          p.id === participantId ? { ...p, hit_points: newHP } : p
        ));
        
        // Broadcast HP update via WebSocket
        if (connected && activeEncounter) {
          updateCombat(activeEncounter.id, {
            participant_id: participantId,
            hit_points: newHP,
            type: 'hp_update'
          });
        }
      }
    } catch (error) {
      console.error('Failed to update participant HP:', error);
    }
  };

  // Add condition
  const addCondition = async (participantId: string, condition: string) => {
    const participant = participants.find(p => p.id === participantId);
    if (!participant) return;

    const newConditions = [...participant.conditions, condition];

    try {
      const response = await fetch(`/api/encounter-participants/${participantId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conditions: newConditions })
      });

      if (response.ok) {
        setParticipants(prev => prev.map(p => 
          p.id === participantId ? { ...p, conditions: newConditions } : p
        ));
      }
    } catch (error) {
      console.error('Failed to add condition:', error);
    }
  };

  // Remove condition
  const removeCondition = async (participantId: string, condition: string) => {
    const participant = participants.find(p => p.id === participantId);
    if (!participant) return;

    const newConditions = participant.conditions.filter(c => c !== condition);

    try {
      const response = await fetch(`/api/encounter-participants/${participantId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conditions: newConditions })
      });

      if (response.ok) {
        setParticipants(prev => prev.map(p => 
          p.id === participantId ? { ...p, conditions: newConditions } : p
        ));
      }
    } catch (error) {
      console.error('Failed to remove condition:', error);
    }
  };

  // Next turn
  const nextTurn = async () => {
    if (!activeEncounter?.initiative_order) return;

    const currentOrder = [...activeEncounter.initiative_order];
    const currentIndex = currentOrder.findIndex(p => !p.hasActed);
    
    if (currentIndex >= 0) {
      currentOrder[currentIndex].hasActed = true;
      
      // If all participants have acted, advance round
      const allActed = currentOrder.every(p => p.hasActed);
      if (allActed) {
        currentOrder.forEach(p => p.hasActed = false);
        
        const response = await fetch(`/api/encounters/${activeEncounter.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            current_round: activeEncounter.current_round + 1,
            initiative_order: currentOrder
          })
        });

        if (response.ok) {
          const updated = await response.json();
          setActiveEncounter(updated);
          
          // Broadcast combat update via WebSocket
          if (connected) {
            updateCombat(activeEncounter.id, {
              current_round: updated.current_round,
              initiative_order: updated.initiative_order,
              type: 'round_advance'
            });
          }
        }
      } else {
        const response = await fetch(`/api/encounters/${activeEncounter.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ initiative_order: currentOrder })
        });

        if (response.ok) {
          const updated = await response.json();
          setActiveEncounter(updated);
          
          // Broadcast combat update via WebSocket
          if (connected) {
            updateCombat(activeEncounter.id, {
              initiative_order: updated.initiative_order,
              type: 'turn_advance'
            });
          }
        }
      }
    }
  };

  // Get current turn participant
  const getCurrentTurnParticipant = () => {
    if (!activeEncounter?.initiative_order) return null;
    const currentTurn = activeEncounter.initiative_order.find(p => !p.hasActed);
    if (!currentTurn) return null;
    return participants.find(p => p.id === currentTurn.participantId);
  };

  // Get sorted participants by initiative
  const getSortedParticipants = () => {
    if (!activeEncounter?.initiative_order) return participants;
    
    return activeEncounter.initiative_order
      .map(order => ({
        ...participants.find(p => p.id === order.participantId)!,
        initiative: order.initiative,
        has_acted: order.hasActed
      }))
      .filter(p => p);
  };

  useEffect(() => {
    loadEncounters();
  }, [campaignId]);

  // Handle incoming WebSocket combat updates
  useEffect(() => {
    const combatUpdates = getMessagesByType('combat-update');
    if (combatUpdates.length > 0) {
      const latestUpdate = combatUpdates[combatUpdates.length - 1];
      const updateData = latestUpdate.data;
      
      if (updateData && updateData.encounterId && activeEncounter?.id === updateData.encounterId) {
        // Update encounter state from WebSocket
        setActiveEncounter(prev => {
          if (!prev) return prev;
          return {
            ...prev,
            current_round: updateData.update.current_round || prev.current_round,
            initiative_order: updateData.update.initiative_order || prev.initiative_order
          };
        });
        
        // Update participants if needed
        if (updateData.update.participants) {
          setParticipants(updateData.update.participants);
        }
        
        console.log('[Combat] Received real-time combat update:', updateData);
      }
    }
  }, [getMessagesByType, activeEncounter]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-48">
        <Loader2 className="w-6 h-6 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Tabs defaultValue="encounters" className="w-full">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="encounters">Encounters</TabsTrigger>
          <TabsTrigger value="combat" className="flex items-center gap-2">
            Active Combat
            {connected && activeEncounter && (
              <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" title="Live sync active" />
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="encounters">
          {/* Encounter Management */}
          <Card>
            <CardHeader>
              <div className="flex justify-between items-center">
                <CardTitle className="flex items-center gap-2">
                  <Sword className="w-5 h-5" />
                  Encounters
                </CardTitle>
                {isDM && (
                  <Button onClick={() => setShowCreateForm(true)}>
                    <Plus className="w-4 h-4 mr-2" />
                    Create Encounter
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {encounters.length === 0 ? (
                  <p className="text-muted-foreground text-center py-8">
                    No encounters created yet.
                  </p>
                ) : (
                  encounters.map((encounter) => (
                    <Card key={encounter.id} className="p-4">
                      <div className="flex justify-between items-start">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <h3 className="font-medium">{encounter.name}</h3>
                            <Badge variant={encounter.status === 'active' ? 'default' : 'secondary'}>
                              {encounter.status}
                            </Badge>
                            <Badge variant="outline">{encounter.difficulty}</Badge>
                          </div>
                          <p className="text-sm text-muted-foreground">{encounter.description}</p>
                          <div className="text-xs text-muted-foreground">
                            {encounter.participant_count} participants • Round {encounter.current_round}
                          </div>
                        </div>
                        <div className="flex gap-2">
                          {encounter.status === 'planned' && isDM && (
                            <Button
                              size="sm"
                              onClick={() => {
                                setActiveEncounter(encounter);
                                loadParticipants(encounter.id);
                              }}
                            >
                              <Play className="w-4 h-4 mr-1" />
                              Start
                            </Button>
                          )}
                          {encounter.status === 'active' && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                setActiveEncounter(encounter);
                                loadParticipants(encounter.id);
                              }}
                            >
                              <Users className="w-4 h-4 mr-1" />
                              View
                            </Button>
                          )}
                        </div>
                      </div>
                    </Card>
                  ))
                )}
              </div>
            </CardContent>
          </Card>

          {/* Create Encounter Form */}
          {showCreateForm && (
            <Card>
              <CardHeader>
                <CardTitle>Create New Encounter</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <label className="text-sm font-medium">Name</label>
                  <Input
                    value={newEncounterName}
                    onChange={(e) => setNewEncounterName(e.target.value)}
                    placeholder="Encounter name"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium">Description</label>
                  <Textarea
                    value={newEncounterDescription}
                    onChange={(e) => setNewEncounterDescription(e.target.value)}
                    placeholder="Encounter description"
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-sm font-medium">Type</label>
                    <Select value={newEncounterType} onValueChange={(value: any) => setNewEncounterType(value)}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="combat">Combat</SelectItem>
                        <SelectItem value="social">Social</SelectItem>
                        <SelectItem value="exploration">Exploration</SelectItem>
                        <SelectItem value="puzzle">Puzzle</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <label className="text-sm font-medium">Difficulty</label>
                    <Select value={newEncounterDifficulty} onValueChange={(value: any) => setNewEncounterDifficulty(value)}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="easy">Easy</SelectItem>
                        <SelectItem value="medium">Medium</SelectItem>
                        <SelectItem value="hard">Hard</SelectItem>
                        <SelectItem value="deadly">Deadly</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button
                    onClick={() => createEncounter({
                      name: newEncounterName,
                      description: newEncounterDescription,
                      type: newEncounterType,
                      difficulty: newEncounterDifficulty
                    })}
                    disabled={!newEncounterName.trim()}
                  >
                    Create
                  </Button>
                  <Button variant="outline" onClick={() => setShowCreateForm(false)}>
                    Cancel
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="combat">
          {!activeEncounter ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12">
                <Sword className="w-12 h-12 text-muted-foreground mb-4" />
                <p className="text-muted-foreground text-center">
                  No active encounter. Select an encounter to begin combat.
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-6">
              {/* Combat Controls */}
              <Card>
                <CardHeader>
                  <div className="flex justify-between items-center">
                    <div>
                      <CardTitle className="flex items-center gap-2">
                        <Sword className="w-5 h-5" />
                        {activeEncounter.name}
                      </CardTitle>
                      <p className="text-sm text-muted-foreground mt-1">
                        {activeEncounter.description}
                      </p>
                    </div>
                    <div className="flex items-center gap-4">
                      <Badge variant="outline" className="text-lg px-3 py-1">
                        Round {activeEncounter.current_round}
                      </Badge>
                      {isDM && (
                        <div className="flex gap-2">
                          <Button onClick={() => setShowAddParticipant(true)}>
                            <Plus className="w-4 h-4 mr-2" />
                            Add Combatant
                          </Button>
                          {activeEncounter.status === 'planned' && (
                            <Button onClick={rollInitiative}>
                              <Play className="w-4 h-4 mr-2" />
                              Roll Initiative
                            </Button>
                          )}
                          {activeEncounter.status === 'active' && (
                            <Button onClick={nextTurn}>
                              Next Turn
                            </Button>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </CardHeader>
              </Card>

              {/* Initiative Order */}
              {activeEncounter.status === 'active' && (
                <Card>
                  <CardHeader>
                    <CardTitle>Initiative Order</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-3">
                      {getSortedParticipants().map((participant, index) => (
                        <div
                          key={participant.id}
                          className={`p-4 border rounded-lg ${
                            !participant.has_acted ? 'ring-2 ring-primary bg-accent' : ''
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                              <div className="text-2xl font-bold text-muted-foreground">
                                {index + 1}
                              </div>
                              <Avatar>
                                <AvatarFallback className={participant.participant_type === 'character' ? 'bg-blue-100' : 'bg-red-100'}>
                                  {participant.name.slice(0, 2)}
                                </AvatarFallback>
                              </Avatar>
                              <div>
                                <div className="flex items-center gap-2">
                                  <span className="font-medium">{participant.name}</span>
                                  {participant.participant_type === 'character' && <Badge variant="secondary">Player</Badge>}
                                </div>
                                <div className="text-sm text-muted-foreground">
                                  Initiative: {participant.initiative} • AC: {participant.armor_class}
                                </div>
                              </div>
                            </div>

                            <div className="flex items-center gap-4">
                              {/* Hit Points */}
                              <div className="flex items-center gap-2">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => updateParticipantHP(participant.id, {
                                    ...participant.hit_points,
                                    current: Math.max(0, participant.hit_points.current - 1)
                                  })}
                                  disabled={!isDM}
                                >
                                  <Minus className="w-4 h-4" />
                                </Button>
                                
                                <div className="text-center min-w-16">
                                  <div className="flex items-center gap-1">
                                    <Heart className="w-4 h-4" />
                                    <span className="font-medium">
                                      {participant.hit_points.current}/{participant.hit_points.max}
                                    </span>
                                  </div>
                                  <Progress 
                                    value={(participant.hit_points.current / participant.hit_points.max) * 100}
                                    className="h-2 w-16"
                                  />
                                </div>

                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => updateParticipantHP(participant.id, {
                                    ...participant.hit_points,
                                    current: Math.min(participant.hit_points.max, participant.hit_points.current + 1)
                                  })}
                                  disabled={!isDM}
                                >
                                  <Plus className="w-4 h-4" />
                                </Button>
                              </div>
                            </div>
                          </div>

                          {/* Conditions */}
                          {participant.conditions.length > 0 && (
                            <div className="flex gap-1 mt-2">
                              {participant.conditions.map((condition, idx) => (
                                <Badge
                                  key={idx}
                                  variant="secondary"
                                  className="text-xs cursor-pointer"
                                  onClick={() => isDM && removeCondition(participant.id, condition)}
                                >
                                  {condition}
                                </Badge>
                              ))}
                            </div>
                          )}

                          {/* Add Condition */}
                          {isDM && (
                            <div className="flex gap-1 mt-2">
                              {conditions.map((condition) => (
                                <Button
                                  key={condition.name}
                                  variant="ghost"
                                  size="sm"
                                  className="h-6 px-2 text-xs"
                                  onClick={() => addCondition(participant.id, condition.name)}
                                >
                                  +{condition.name}
                                </Button>
                              ))}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Add Participant Form */}
              {showAddParticipant && (
                <Card>
                  <CardHeader>
                    <CardTitle>Add Combatant</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="text-sm font-medium">Name</label>
                        <Input
                          value={newParticipantName}
                          onChange={(e) => setNewParticipantName(e.target.value)}
                          placeholder="Combatant name"
                        />
                      </div>
                      <div>
                        <label className="text-sm font-medium">Type</label>
                        <Select value={newParticipantType} onValueChange={(value: any) => setNewParticipantType(value)}>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="character">Character</SelectItem>
                            <SelectItem value="npc">NPC</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <div className="grid grid-cols-3 gap-4">
                      <div>
                        <label className="text-sm font-medium">Max HP</label>
                        <Input
                          type="number"
                          value={newParticipantHP.max}
                          onChange={(e) => setNewParticipantHP(prev => ({ 
                            ...prev, 
                            max: parseInt(e.target.value) || 0,
                            current: parseInt(e.target.value) || 0
                          }))}
                        />
                      </div>
                      <div>
                        <label className="text-sm font-medium">Current HP</label>
                        <Input
                          type="number"
                          value={newParticipantHP.current}
                          onChange={(e) => setNewParticipantHP(prev => ({ 
                            ...prev, 
                            current: parseInt(e.target.value) || 0
                          }))}
                        />
                      </div>
                      <div>
                        <label className="text-sm font-medium">AC</label>
                        <Input
                          type="number"
                          value={newParticipantAC}
                          onChange={(e) => setNewParticipantAC(parseInt(e.target.value) || 10)}
                        />
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        onClick={() => addParticipant({
                          participant_id: `${newParticipantType}-${Date.now()}`,
                          participant_type: newParticipantType,
                          name: newParticipantName,
                          hit_points: { 
                            max: newParticipantHP.max, 
                            current: newParticipantHP.current, 
                            temporary: 0 
                          },
                          armor_class: newParticipantAC
                        })}
                        disabled={!newParticipantName.trim()}
                      >
                        Add
                      </Button>
                      <Button variant="outline" onClick={() => setShowAddParticipant(false)}>
                        Cancel
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
