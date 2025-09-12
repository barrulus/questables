import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Progress } from "./ui/progress";
import { Separator } from "./ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";
import { Input } from "./ui/input";
import { Search, Zap, Target, Shield, Sparkles } from "lucide-react";

interface Spell {
  name: string;
  level: number;
  school: string;
  castingTime: string;
  range: string;
  components: string;
  duration: string;
  description: string;
  damage?: string;
  prepared?: boolean;
  ritual?: boolean;
}

export function Spellbook() {
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedSpell, setSelectedSpell] = useState<Spell | null>(null);

  const spellSlots = {
    1: { used: 2, total: 4 },
    2: { used: 1, total: 3 },
    3: { used: 0, total: 2 },
    4: { used: 1, total: 1 }
  };

  const spells: Record<number, Spell[]> = {
    1: [
      {
        name: "Hunter's Mark",
        level: 1,
        school: "Divination",
        castingTime: "1 bonus action",
        range: "90 feet",
        components: "V",
        duration: "Concentration, up to 1 hour",
        description: "You choose a creature you can see within range and mystically mark it as your quarry. Until the spell ends, you deal an extra 1d6 damage to the target whenever you hit it with a weapon attack.",
        damage: "1d6",
        prepared: true
      },
      {
        name: "Cure Wounds",
        level: 1,
        school: "Evocation",
        castingTime: "1 action",
        range: "Touch",
        components: "V, S",
        duration: "Instantaneous",
        description: "A creature you touch regains a number of hit points equal to 1d8 + your spellcasting ability modifier.",
        damage: "1d8 + 4 healing",
        prepared: true
      },
      {
        name: "Speak with Animals",
        level: 1,
        school: "Divination", 
        castingTime: "1 action",
        range: "Self",
        components: "V, S",
        duration: "10 minutes",
        description: "You gain the ability to comprehend and verbally communicate with beasts for the duration.",
        prepared: false,
        ritual: true
      }
    ],
    2: [
      {
        name: "Pass without Trace",
        level: 2,
        school: "Abjuration",
        castingTime: "1 action",
        range: "Self",
        components: "V, S, M",
        duration: "Concentration, up to 1 hour",
        description: "A veil of shadows and silence radiates from you, masking you and your companions from detection. Each creature of your choice within 30 feet of you has a +10 bonus to Dexterity (Stealth) checks.",
        prepared: true
      },
      {
        name: "Healing Spirit",
        level: 2,
        school: "Conjuration",
        castingTime: "1 bonus action",
        range: "60 feet",
        components: "V, S",
        duration: "Concentration, up to 1 minute",
        description: "You call forth a nature spirit to soothe the wounded. The spirit appears in a space that is a 5-foot cube you can see within range.",
        damage: "1d6 healing",
        prepared: true
      }
    ],
    3: [
      {
        name: "Lightning Arrow",
        level: 3,
        school: "Transmutation",
        castingTime: "1 bonus action",
        range: "Self",
        components: "V, S",
        duration: "Concentration, up to 1 minute",
        description: "The next time you make a ranged weapon attack during the spell's duration, the weapon's ammunition transforms into a bolt of lightning.",
        damage: "4d8 lightning",
        prepared: true
      }
    ],
    4: [
      {
        name: "Freedom of Movement",
        level: 4,
        school: "Abjuration",
        castingTime: "1 action",
        range: "Touch",
        components: "V, S, M",
        duration: "1 hour",
        description: "You touch a willing creature. For the duration, the target's movement is unaffected by difficult terrain, and spells and other magical effects can neither reduce the target's speed nor cause the target to be paralyzed or restrained.",
        prepared: true
      }
    ]
  };

  const filteredSpells = Object.entries(spells).reduce((acc, [level, levelSpells]) => {
    const filtered = levelSpells.filter(spell =>
      spell.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      spell.school.toLowerCase().includes(searchTerm.toLowerCase())
    );
    if (filtered.length > 0) {
      acc[parseInt(level)] = filtered;
    }
    return acc;
  }, {} as Record<number, Spell[]>);

  const getSchoolIcon = (school: string) => {
    switch (school) {
      case "Evocation": return <Zap className="w-4 h-4" />;
      case "Abjuration": return <Shield className="w-4 h-4" />;
      case "Divination": return <Target className="w-4 h-4" />;
      default: return <Sparkles className="w-4 h-4" />;
    }
  };

  return (
    <div className="space-y-6">
      {/* Spell Slots */}
      <Card>
        <CardHeader>
          <CardTitle>Spell Slots</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-4 gap-4">
            {Object.entries(spellSlots).map(([level, slots]) => (
              <div key={level} className="space-y-2">
                <div className="text-center">
                  <div className="font-medium">Level {level}</div>
                  <div className="text-sm text-muted-foreground">
                    {slots.total - slots.used} / {slots.total}
                  </div>
                </div>
                <Progress 
                  value={((slots.total - slots.used) / slots.total) * 100} 
                  className="h-2"
                />
                <div className="flex gap-1 justify-center">
                  {Array.from({ length: slots.total }, (_, i) => (
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
                <CardTitle>Spellbook</CardTitle>
                <div className="relative">
                  <Search className="w-4 h-4 absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground" />
                  <Input
                    placeholder="Search spells..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="pl-10 w-64"
                  />
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <Tabs defaultValue="all" className="space-y-4">
                <TabsList>
                  <TabsTrigger value="all">All</TabsTrigger>
                  <TabsTrigger value="prepared">Prepared</TabsTrigger>
                  <TabsTrigger value="cantrips">Cantrips</TabsTrigger>
                </TabsList>

                <TabsContent value="all" className="space-y-4">
                  {Object.entries(filteredSpells).map(([level, levelSpells]) => (
                    <div key={level}>
                      <h3 className="font-medium mb-2">
                        {level === "0" ? "Cantrips" : `Level ${level} Spells`}
                      </h3>
                      <div className="space-y-2">
                        {levelSpells.map((spell, index) => (
                          <div
                            key={index}
                            className={`p-3 border rounded cursor-pointer hover:bg-accent ${
                              selectedSpell?.name === spell.name ? 'ring-2 ring-primary' : ''
                            }`}
                            onClick={() => setSelectedSpell(spell)}
                          >
                            <div className="flex justify-between items-start">
                              <div className="flex items-center gap-2">
                                {getSchoolIcon(spell.school)}
                                <span className="font-medium">{spell.name}</span>
                                {spell.ritual && <Badge variant="outline" className="text-xs">Ritual</Badge>}
                                {spell.prepared && <Badge variant="secondary" className="text-xs">Prepared</Badge>}
                              </div>
                              <Badge variant="outline">{spell.school}</Badge>
                            </div>
                          </div>
                        ))}
                      </div>
                      <Separator className="mt-4" />
                    </div>
                  ))}
                </TabsContent>

                <TabsContent value="prepared">
                  <div className="space-y-2">
                    {Object.values(spells).flat().filter(spell => spell.prepared).map((spell, index) => (
                      <div
                        key={index}
                        className={`p-3 border rounded cursor-pointer hover:bg-accent ${
                          selectedSpell?.name === spell.name ? 'ring-2 ring-primary' : ''
                        }`}
                        onClick={() => setSelectedSpell(spell)}
                      >
                        <div className="flex justify-between items-start">
                          <div className="flex items-center gap-2">
                            {getSchoolIcon(spell.school)}
                            <span className="font-medium">{spell.name}</span>
                            <Badge variant="outline">Level {spell.level}</Badge>
                          </div>
                          <Button size="sm" variant="outline">Cast</Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </TabsContent>
              </Tabs>
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
                    Level {selectedSpell.level} {selectedSpell.school}
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
                    <span className="text-muted-foreground">{selectedSpell.components}</span>
                  </div>
                  <div>
                    <span className="font-medium">Duration: </span>
                    <span className="text-muted-foreground">{selectedSpell.duration}</span>
                  </div>
                  {selectedSpell.damage && (
                    <div>
                      <span className="font-medium">Damage: </span>
                      <span className="text-muted-foreground">{selectedSpell.damage}</span>
                    </div>
                  )}
                </div>

                <Separator />

                <div>
                  <p className="text-sm">{selectedSpell.description}</p>
                </div>

                <div className="flex gap-2">
                  <Button 
                    className="flex-1"
                    disabled={!selectedSpell.prepared}
                  >
                    Cast Spell
                  </Button>
                  <Button variant="outline">
                    {selectedSpell.prepared ? "Unprepare" : "Prepare"}
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
    </div>
  );
}