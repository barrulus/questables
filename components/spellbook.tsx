import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Progress } from "./ui/progress";
import { Separator } from "./ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";
import { Input } from "./ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "./ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { toast } from "sonner";
import { Search, Zap, Target, Shield, Sparkles, Plus, RefreshCw, Loader2 } from "lucide-react";
import { characterHelpers, type Character, type SpellcastingInfo } from '../utils/database/data-helpers';

interface SpellbookProps {
  characterId: string;
  onSpellcastingChange?: () => void;
}

interface Spell {
  id: string;
  name: string;
  level: number;
  school: string;
  castingTime: string;
  range: string;
  components: string[];
  duration: string;
  description: string;
  damage?: string;
  ritual?: boolean;
  higherLevel?: string;
}

interface SpellSlot {
  level: number;
  max: number;
  used: number;
}

export function Spellbook({ characterId, onSpellcastingChange }: SpellbookProps) {
  const [character, setCharacter] = useState<Character | null>(null);
  const [spellcasting, setSpellcasting] = useState<SpellcastingInfo | null>(null);
  const [knownSpells, setKnownSpells] = useState<Spell[]>([]);
  const [allSpells] = useState<Spell[]>([
    // Basic D&D 5e spells - in a real app this would come from an API
    {
      id: "hunters-mark",
      name: "Hunter's Mark",
      level: 1,
      school: "Divination",
      castingTime: "1 bonus action",
      range: "90 feet",
      components: ["V"],
      duration: "Concentration, up to 1 hour",
      description: "You choose a creature you can see within range and mystically mark it as your quarry. Until the spell ends, you deal an extra 1d6 damage to the target whenever you hit it with a weapon attack.",
      damage: "1d6"
    },
    {
      id: "cure-wounds",
      name: "Cure Wounds",
      level: 1,
      school: "Evocation",
      castingTime: "1 action",
      range: "Touch",
      components: ["V", "S"],
      duration: "Instantaneous",
      description: "A creature you touch regains a number of hit points equal to 1d8 + your spellcasting ability modifier.",
      damage: "1d8 + modifier healing"
    },
    {
      id: "speak-with-animals",
      name: "Speak with Animals",
      level: 1,
      school: "Divination",
      castingTime: "1 action",
      range: "Self",
      components: ["V", "S"],
      duration: "10 minutes",
      description: "You gain the ability to comprehend and verbally communicate with beasts for the duration.",
      ritual: true
    },
    {
      id: "pass-without-trace",
      name: "Pass without Trace",
      level: 2,
      school: "Abjuration",
      castingTime: "1 action",
      range: "Self",
      components: ["V", "S", "M"],
      duration: "Concentration, up to 1 hour",
      description: "A veil of shadows and silence radiates from you, masking you and your companions from detection. Each creature of your choice within 30 feet of you has a +10 bonus to Dexterity (Stealth) checks."
    },
    {
      id: "healing-spirit",
      name: "Healing Spirit",
      level: 2,
      school: "Conjuration",
      castingTime: "1 bonus action",
      range: "60 feet",
      components: ["V", "S"],
      duration: "Concentration, up to 1 minute",
      description: "You call forth a nature spirit to soothe the wounded. The spirit appears in a space that is a 5-foot cube you can see within range.",
      damage: "1d6 healing"
    },
    {
      id: "lightning-arrow",
      name: "Lightning Arrow",
      level: 3,
      school: "Transmutation",
      castingTime: "1 bonus action",
      range: "Self",
      components: ["V", "S"],
      duration: "Concentration, up to 1 minute",
      description: "The next time you make a ranged weapon attack during the spell's duration, the weapon's ammunition transforms into a bolt of lightning.",
      damage: "4d8 lightning"
    },
    {
      id: "freedom-of-movement",
      name: "Freedom of Movement",
      level: 4,
      school: "Abjuration",
      castingTime: "1 action",
      range: "Touch",
      components: ["V", "S", "M"],
      duration: "1 hour",
      description: "You touch a willing creature. For the duration, the target's movement is unaffected by difficult terrain, and spells and other magical effects can neither reduce the target's speed nor cause the target to be paralyzed or restrained."
    }
  ]);
  
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedSpell, setSelectedSpell] = useState<Spell | null>(null);
  const [showLearnDialog, setShowLearnDialog] = useState(false);

  // Load character spellcasting data
  const loadCharacterSpellcasting = async () => {
    try {
      setLoading(true);
      const char = await characterHelpers.getCharacter(characterId);
      if (char) {
        setCharacter(char);
        setSpellcasting(char.spellcasting || null);
        
        // Load known spells based on character's spell IDs
        if (char.spellcasting?.spellsKnown) {
          const characterSpells = allSpells.filter(spell => 
            char.spellcasting.spellsKnown.includes(spell.id)
          );
          setKnownSpells(characterSpells);
        } else {
          setKnownSpells([]);
        }
      }
    } catch (error) {
      console.error('Failed to load character spellcasting:', error);
      toast.error('Failed to load spellcasting data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (characterId) {
      loadCharacterSpellcasting();
    }
  }, [characterId]);

  // Update character spellcasting in database
  const updateCharacterSpellcasting = async (updates: Partial<SpellcastingInfo>) => {
    if (!character) return;

    try {
      setUpdating(true);
      const updatedSpellcasting = { ...spellcasting, ...updates };
      
      await characterHelpers.updateCharacter(characterId, { 
        spellcasting: updatedSpellcasting 
      });
      
      setSpellcasting(updatedSpellcasting);
      onSpellcastingChange?.();
    } catch (error) {
      console.error('Failed to update spellcasting:', error);
      toast.error('Failed to save changes');
    } finally {
      setUpdating(false);
    }
  };

  // Cast a spell (use spell slot)
  const castSpell = async (spellLevel: number) => {
    if (!spellcasting?.spellSlots?.[spellLevel]) {
      toast.error('No spell slots available for this level');
      return;
    }

    const currentSlot = spellcasting.spellSlots[spellLevel];
    if (currentSlot.used >= currentSlot.max) {
      toast.error('No remaining spell slots of this level');
      return;
    }

    try {
      const updatedSpellSlots = {
        ...spellcasting.spellSlots,
        [spellLevel]: {
          ...currentSlot,
          used: currentSlot.used + 1
        }
      };

      await updateCharacterSpellcasting({
        spellSlots: updatedSpellSlots
      });

      toast.success(`Cast spell using level ${spellLevel} slot`);
    } catch (error) {
      console.error('Failed to cast spell:', error);
      toast.error('Failed to cast spell');
    }
  };

  // Learn a new spell
  const learnSpell = async (spellId: string) => {
    if (!spellcasting) {
      toast.error('Character has no spellcasting ability');
      return;
    }

    if (spellcasting.spellsKnown?.includes(spellId)) {
      toast.error('Spell already known');
      return;
    }

    try {
      const updatedSpellsKnown = [...(spellcasting.spellsKnown || []), spellId];
      await updateCharacterSpellcasting({
        spellsKnown: updatedSpellsKnown
      });

      // Update local known spells
      const newSpell = allSpells.find(spell => spell.id === spellId);
      if (newSpell) {
        setKnownSpells(prev => [...prev, newSpell]);
      }

      setShowLearnDialog(false);
      toast.success('Spell learned successfully');
    } catch (error) {
      console.error('Failed to learn spell:', error);
      toast.error('Failed to learn spell');
    }
  };

  // Forget a spell
  const forgetSpell = async (spellId: string) => {
    if (!spellcasting?.spellsKnown?.includes(spellId)) {
      toast.error('Spell not known');
      return;
    }

    try {
      const updatedSpellsKnown = spellcasting.spellsKnown.filter(id => id !== spellId);
      await updateCharacterSpellcasting({
        spellsKnown: updatedSpellsKnown
      });

      // Update local known spells
      setKnownSpells(prev => prev.filter(spell => spell.id !== spellId));
      
      // Clear selected spell if it was forgotten
      if (selectedSpell?.id === spellId) {
        setSelectedSpell(null);
      }

      toast.success('Spell forgotten');
    } catch (error) {
      console.error('Failed to forget spell:', error);
      toast.error('Failed to forget spell');
    }
  };

  // Restore spell slots (rest)
  const restoreSpellSlots = async (restType: 'short' | 'long') => {
    if (!spellcasting?.spellSlots) {
      toast.error('No spell slots to restore');
      return;
    }

    try {
      const updatedSpellSlots = { ...spellcasting.spellSlots };

      if (restType === 'long') {
        // Long rest restores all spell slots
        Object.keys(updatedSpellSlots).forEach(level => {
          updatedSpellSlots[level].used = 0;
        });
      } else {
        // Short rest logic could be implemented for specific classes (e.g., Warlocks)
        // For now, we'll just show a message
        toast.info('Short rest effects vary by class');
        return;
      }

      await updateCharacterSpellcasting({
        spellSlots: updatedSpellSlots
      });

      toast.success(`${restType === 'long' ? 'Long' : 'Short'} rest completed - spell slots restored`);
    } catch (error) {
      console.error('Failed to restore spell slots:', error);
      toast.error('Failed to restore spell slots');
    }
  };

  // Filter spells based on search term
  const filteredKnownSpells = knownSpells.filter(spell =>
    spell.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    spell.school.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const availableSpells = allSpells.filter(spell => 
    !knownSpells.some(known => known.id === spell.id) &&
    (spell.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
     spell.school.toLowerCase().includes(searchTerm.toLowerCase()))
  );

  // Get school icon
  const getSchoolIcon = (school: string) => {
    switch (school) {
      case "Evocation": return <Zap className="w-4 h-4" />;
      case "Abjuration": return <Shield className="w-4 h-4" />;
      case "Divination": return <Target className="w-4 h-4" />;
      default: return <Sparkles className="w-4 h-4" />;
    }
  };

  // Group spells by level
  const spellsByLevel = filteredKnownSpells.reduce((acc, spell) => {
    if (!acc[spell.level]) acc[spell.level] = [];
    acc[spell.level].push(spell);
    return acc;
  }, {} as Record<number, Spell[]>);

  if (loading) {
    return (
      <div className="text-center py-8">
        <Loader2 className="w-8 h-8 animate-spin mx-auto mb-4" />
        <p>Loading spellbook...</p>
      </div>
    );
  }

  if (!spellcasting) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        <Sparkles className="w-12 h-12 mx-auto mb-4 opacity-50" />
        <p>This character has no spellcasting ability</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Spell Slots */}
      <Card>
        <CardHeader>
          <div className="flex justify-between items-center">
            <CardTitle>Spell Slots</CardTitle>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => restoreSpellSlots('long')}
                disabled={updating}
              >
                <RefreshCw className="w-4 h-4 mr-2" />
                Long Rest
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {Object.entries(spellcasting.spellSlots || {}).map(([level, slots]) => (
              <div key={level} className="space-y-2">
                <div className="text-center">
                  <div className="font-medium">Level {level}</div>
                  <div className="text-sm text-muted-foreground">
                    {slots.max - slots.used} / {slots.max}
                  </div>
                </div>
                <Progress 
                  value={((slots.max - slots.used) / slots.max) * 100} 
                  className="h-2"
                />
                <div className="flex gap-1 justify-center">
                  {Array.from({ length: slots.max }, (_, i) => (
                    <div
                      key={i}
                      className={`w-3 h-3 rounded-full border ${
                        i < slots.used ? 'bg-muted' : 'bg-primary'
                      }`}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Spell List */}
        <div className="lg:col-span-2">
          <Card>
            <CardHeader>
              <div className="flex justify-between items-center">
                <CardTitle>Known Spells ({knownSpells.length})</CardTitle>
                <div className="flex gap-2">
                  <Dialog open={showLearnDialog} onOpenChange={setShowLearnDialog}>
                    <DialogTrigger asChild>
                      <Button size="sm">
                        <Plus className="w-4 h-4 mr-2" />
                        Learn Spell
                      </Button>
                    </DialogTrigger>
                    <DialogContent className="max-w-2xl">
                      <DialogHeader>
                        <DialogTitle>Learn New Spell</DialogTitle>
                      </DialogHeader>
                      <div className="space-y-4">
                        <Input
                          placeholder="Search available spells..."
                          value={searchTerm}
                          onChange={(e) => setSearchTerm(e.target.value)}
                        />
                        <div className="max-h-96 overflow-y-auto space-y-2">
                          {availableSpells.map((spell) => (
                            <div
                              key={spell.id}
                              className="p-3 border rounded hover:bg-accent cursor-pointer"
                              onClick={() => learnSpell(spell.id)}
                            >
                              <div className="flex justify-between items-start">
                                <div className="flex items-center gap-2">
                                  {getSchoolIcon(spell.school)}
                                  <span className="font-medium">{spell.name}</span>
                                  <Badge variant="outline">Level {spell.level}</Badge>
                                  {spell.ritual && <Badge variant="outline" className="text-xs">Ritual</Badge>}
                                </div>
                                <Badge variant="outline">{spell.school}</Badge>
                              </div>
                              <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
                                {spell.description}
                              </p>
                            </div>
                          ))}
                          {availableSpells.length === 0 && (
                            <p className="text-center text-muted-foreground py-4">
                              No spells found
                            </p>
                          )}
                        </div>
                      </div>
                    </DialogContent>
                  </Dialog>
                  
                  <div className="relative">
                    <Search className="w-4 h-4 absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground" />
                    <Input
                      placeholder="Search spells..."
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      className="pl-10 w-48"
                    />
                  </div>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {Object.entries(spellsByLevel).map(([level, levelSpells]) => (
                  <div key={level}>
                    <h3 className="font-medium mb-2">
                      {level === "0" ? "Cantrips" : `Level ${level} Spells`}
                    </h3>
                    <div className="space-y-2">
                      {levelSpells.map((spell) => (
                        <div
                          key={spell.id}
                          className={`p-3 border rounded cursor-pointer hover:bg-accent ${
                            selectedSpell?.id === spell.id ? 'ring-2 ring-primary' : ''
                          }`}
                          onClick={() => setSelectedSpell(spell)}
                        >
                          <div className="flex justify-between items-start">
                            <div className="flex items-center gap-2">
                              {getSchoolIcon(spell.school)}
                              <span className="font-medium">{spell.name}</span>
                              {spell.ritual && <Badge variant="outline" className="text-xs">Ritual</Badge>}
                            </div>
                            <div className="flex gap-2">
                              <Badge variant="outline">{spell.school}</Badge>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  castSpell(spell.level);
                                }}
                                disabled={updating || spell.level === 0}
                              >
                                Cast
                              </Button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                    {level !== "0" && <Separator className="mt-4" />}
                  </div>
                ))}
                
                {knownSpells.length === 0 && (
                  <div className="text-center py-8 text-muted-foreground">
                    <Sparkles className="w-12 h-12 mx-auto mb-4 opacity-50" />
                    <p>No spells known</p>
                    <p className="text-sm">Learn your first spell to get started</p>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Spell Details */}
        <Card>
          <CardHeader>
            <CardTitle>Spell Details</CardTitle>
          </CardHeader>
          <CardContent>
            {selectedSpell ? (
              <div className="space-y-4">
                <div>
                  <h3 className="text-lg font-bold">{selectedSpell.name}</h3>
                  <p className="text-muted-foreground">
                    {selectedSpell.level === 0 ? "Cantrip" : `Level ${selectedSpell.level}`} {selectedSpell.school}
                  </p>
                </div>

                <Separator />

                <div className="space-y-3">
                  <div>
                    <span className="font-medium">Casting Time: </span>
                    <span className="text-muted-foreground">{selectedSpell.castingTime}</span>
                  </div>
                  <div>
                    <span className="font-medium">Range: </span>
                    <span className="text-muted-foreground">{selectedSpell.range}</span>
                  </div>
                  <div>
                    <span className="font-medium">Components: </span>
                    <span className="text-muted-foreground">{selectedSpell.components.join(", ")}</span>
                  </div>
                  <div>
                    <span className="font-medium">Duration: </span>
                    <span className="text-muted-foreground">{selectedSpell.duration}</span>
                  </div>
                  {selectedSpell.damage && (
                    <div>
                      <span className="font-medium">Effect: </span>
                      <span className="text-muted-foreground">{selectedSpell.damage}</span>
                    </div>
                  )}
                </div>

                <Separator />

                <div>
                  <p className="text-sm leading-relaxed">{selectedSpell.description}</p>
                  {selectedSpell.higherLevel && (
                    <div className="mt-3 p-2 bg-muted rounded">
                      <span className="font-medium text-sm">At Higher Levels: </span>
                      <span className="text-sm">{selectedSpell.higherLevel}</span>
                    </div>
                  )}
                </div>

                <div className="flex gap-2">
                  <Button 
                    className="flex-1"
                    onClick={() => castSpell(selectedSpell.level)}
                    disabled={updating || selectedSpell.level === 0}
                  >
                    {updating ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                    {selectedSpell.level === 0 ? "Cantrip" : "Cast Spell"}
                  </Button>
                  <Button 
                    variant="outline"
                    onClick={() => forgetSpell(selectedSpell.id)}
                    disabled={updating}
                  >
                    Forget
                  </Button>
                </div>
              </div>
            ) : (
              <p className="text-muted-foreground text-center py-8">
                Select a spell to view details
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {updating && (
        <div className="text-center py-2">
          <Loader2 className="w-4 h-4 animate-spin inline mr-2" />
          Saving changes...
        </div>
      )}
    </div>
  );
}