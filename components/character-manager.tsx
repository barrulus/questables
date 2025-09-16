import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { ScrollArea } from "./ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "./ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { Textarea } from "./ui/textarea";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "./ui/alert-dialog";
import { toast } from "sonner";
import { 
  Plus, 
  Trash2, 
  Edit, 
  Download, 
  Upload, 
  FileText, 
  FileDown,
  User,
  Star,
  Copy,
  Settings,
  Eye,
  Users
} from "lucide-react";

interface Character {
  id: string;
  name: string;
  class: string;
  level: number;
  race: string;
  background: string;
  hitPoints: { current: number; maximum: number };
  armorClass: number;
  proficiencyBonus: number;
  abilities: {
    strength: number;
    dexterity: number;
    constitution: number;
    intelligence: number;
    wisdom: number;
    charisma: number;
  };
  skills: string[];
  equipment: string[];
  spells: string[];
  backstory: string;
  notes: string;
  isActive: boolean;
  isFavorite: boolean;
  lastPlayed: Date;
  createdAt: Date;
}

export function CharacterManager() {
  const [characters, setCharacters] = useState<Character[]>([
    {
      id: "1",
      name: "Aragorn Strider",
      class: "Ranger",
      level: 8,
      race: "Human",
      background: "Folk Hero",
      hitPoints: { current: 72, maximum: 72 },
      armorClass: 16,
      proficiencyBonus: 3,
      abilities: {
        strength: 16,
        dexterity: 17,
        constitution: 14,
        intelligence: 12,
        wisdom: 18,
        charisma: 10
      },
      skills: ["Animal Handling", "Athletics", "Insight", "Investigation", "Nature", "Perception", "Stealth", "Survival"],
      equipment: ["Longsword +1", "Longbow", "Studded Leather Armor", "Explorer's Pack"],
      spells: ["Hunter's Mark", "Cure Wounds", "Pass without Trace", "Healing Spirit"],
      backstory: "A ranger of the North, heir to the throne of Gondor.",
      notes: "Currently tracking the Fellowship. Has Andúril, the reforged sword.",
      isActive: true,
      isFavorite: true,
      lastPlayed: new Date(),
      createdAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    },
    {
      id: "2",
      name: "Gandalf the Grey",
      class: "Wizard",
      level: 20,
      race: "Maia",
      background: "Hermit",
      hitPoints: { current: 165, maximum: 165 },
      armorClass: 17,
      proficiencyBonus: 6,
      abilities: {
        strength: 10,
        dexterity: 14,
        constitution: 16,
        intelligence: 20,
        wisdom: 18,
        charisma: 16
      },
      skills: ["Arcana", "History", "Insight", "Investigation", "Medicine", "Religion"],
      equipment: ["Staff of Power", "Glamdring", "Robes of the Archmagi", "Ring of Fire"],
      spells: ["Fireball", "Lightning Bolt", "Counterspell", "Teleport", "Wish"],
      backstory: "One of the Istari, sent to Middle-earth to oppose Sauron.",
      notes: "Wielder of Narya, the Red Ring. Recently returned as Gandalf the White.",
      isActive: false,
      isFavorite: true,
      lastPlayed: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
      createdAt: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000)
    },
    {
      id: "3",
      name: "Legolas Greenleaf",
      class: "Fighter",
      level: 7,
      race: "Elf",
      background: "Noble",
      hitPoints: { current: 58, maximum: 58 },
      armorClass: 15,
      proficiencyBonus: 3,
      abilities: {
        strength: 13,
        dexterity: 20,
        constitution: 14,
        intelligence: 12,
        wisdom: 16,
        charisma: 15
      },
      skills: ["Acrobatics", "Animal Handling", "Athletics", "Insight", "Perception", "Stealth"],
      equipment: ["Elven Bow", "White Knives", "Elven Cloak", "Mithril Shirt"],
      spells: [],
      backstory: "Prince of the Woodland Realm, son of Thranduil.",
      notes: "Expert archer. Member of the Fellowship.",
      isActive: false,
      isFavorite: false,
      lastPlayed: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000),
      createdAt: new Date(Date.now() - 45 * 24 * 60 * 60 * 1000)
    },
    {
      id: "4",
      name: "Gimli, son of Glóin",
      class: "Fighter",
      level: 7,
      race: "Dwarf",
      background: "Guild Artisan",
      hitPoints: { current: 68, maximum: 68 },
      armorClass: 18,
      proficiencyBonus: 3,
      abilities: {
        strength: 18,
        dexterity: 12,
        constitution: 17,
        intelligence: 11,
        wisdom: 13,
        charisma: 10
      },
      skills: ["Athletics", "History", "Insight", "Intimidation", "Perception"],
      equipment: ["Dwarven War Axe", "Chain Mail", "Shield", "Smith's Tools"],
      spells: [],
      backstory: "Dwarf of Erebor, skilled warrior and craftsman.",
      notes: "Member of the Fellowship. Surprisingly good friends with Legolas.",
      isActive: false,
      isFavorite: false,
      lastPlayed: new Date(Date.now() - 21 * 24 * 60 * 60 * 1000),
      createdAt: new Date(Date.now() - 50 * 24 * 60 * 60 * 1000)
    }
  ]);

  const [selectedCharacter, setSelectedCharacter] = useState<Character | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [sortBy, setSortBy] = useState<"name" | "level" | "lastPlayed" | "class">("lastPlayed");
  const [filterClass, setFilterClass] = useState<string>("all");

  const [newCharacter, setNewCharacter] = useState<Partial<Character>>({
    name: "",
    class: "",
    level: 1,
    race: "",
    background: "",
    hitPoints: { current: 0, maximum: 0 },
    armorClass: 10,
    proficiencyBonus: 2,
    abilities: {
      strength: 10,
      dexterity: 10,
      constitution: 10,
      intelligence: 10,
      wisdom: 10,
      charisma: 10
    },
    skills: [],
    equipment: [],
    spells: [],
    backstory: "",
    notes: ""
  });

  const classes = ["Barbarian", "Bard", "Cleric", "Druid", "Fighter", "Monk", "Paladin", "Ranger", "Rogue", "Sorcerer", "Warlock", "Wizard"];
  const races = ["Human", "Elf", "Dwarf", "Halfling", "Dragonborn", "Gnome", "Half-Elf", "Half-Orc", "Tiefling"];

  const filteredCharacters = characters
    .filter(char => 
      char.name.toLowerCase().includes(searchTerm.toLowerCase()) &&
      (filterClass === "all" || char.class === filterClass)
    )
    .sort((a, b) => {
      switch (sortBy) {
        case "name": return a.name.localeCompare(b.name);
        case "level": return b.level - a.level;
        case "class": return a.class.localeCompare(b.class);
        case "lastPlayed": return b.lastPlayed.getTime() - a.lastPlayed.getTime();
        default: return 0;
      }
    });

  const handleCreateCharacter = () => {
    if (!newCharacter.name || !newCharacter.class || !newCharacter.race) {
      toast.error("Please fill in all required fields");
      return;
    }

    const character: Character = {
      ...newCharacter as Character,
      id: Date.now().toString(),
      isActive: false,
      isFavorite: false,
      lastPlayed: new Date(),
      createdAt: new Date()
    };

    setCharacters(prev => [...prev, character]);
    setNewCharacter({
      name: "",
      class: "",
      level: 1,
      race: "",
      background: "",
      hitPoints: { current: 0, maximum: 0 },
      armorClass: 10,
      proficiencyBonus: 2,
      abilities: {
        strength: 10,
        dexterity: 10,
        constitution: 10,
        intelligence: 10,
        wisdom: 10,
        charisma: 10
      },
      skills: [],
      equipment: [],
      spells: [],
      backstory: "",
      notes: ""
    });
    setIsCreating(false);
    toast.success("Character created successfully!");
  };

  const handleDeleteCharacter = (id: string) => {
    setCharacters(prev => prev.filter(char => char.id !== id));
    if (selectedCharacter?.id === id) {
      setSelectedCharacter(null);
    }
    toast.success("Character deleted");
  };

  const handleSetActive = (id: string) => {
    setCharacters(prev => prev.map(char => ({
      ...char,
      isActive: char.id === id
    })));
    toast.success("Active character updated");
  };

  const handleToggleFavorite = (id: string) => {
    setCharacters(prev => prev.map(char => 
      char.id === id ? { ...char, isFavorite: !char.isFavorite } : char
    ));
  };

  const handleDuplicateCharacter = (character: Character) => {
    const duplicate: Character = {
      ...character,
      id: Date.now().toString(),
      name: `${character.name} (Copy)`,
      isActive: false,
      createdAt: new Date(),
      lastPlayed: new Date()
    };
    setCharacters(prev => [...prev, duplicate]);
    toast.success("Character duplicated");
  };

  const exportToJSON = (character?: Character) => {
    const data = character ? [character] : characters;
    const dataStr = JSON.stringify(data, null, 2);
    const dataBlob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(dataBlob);
    const link = document.createElement('a');
    link.href = url;
    link.download = character ? `${character.name}.json` : 'characters.json';
    link.click();
    URL.revokeObjectURL(url);
    toast.success(character ? "Character exported" : "All characters exported");
  };

  const exportToPDF = (character: Character) => {
    // This would integrate with a PDF library like jsPDF in a real implementation
    toast.info("PDF export would be implemented with a PDF library");
  };

  const importFromJSON = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const importedData = JSON.parse(e.target?.result as string);
        const importedCharacters = Array.isArray(importedData) ? importedData : [importedData];
        
        // Generate new IDs to avoid conflicts
        const newCharacters = importedCharacters.map((char: Character) => ({
          ...char,
          id: Date.now().toString() + Math.random(),
          isActive: false,
          createdAt: new Date(),
          lastPlayed: new Date()
        }));

        setCharacters(prev => [...prev, ...newCharacters]);
        toast.success(`Imported ${newCharacters.length} character(s)`);
      } catch (error) {
        toast.error("Invalid JSON file");
      }
    };
    reader.readAsText(file);
    event.target.value = ''; // Reset input
  };

  const getAbilityModifier = (score: number) => Math.floor((score - 10) / 2);

  return (
    <div className="h-full flex flex-col">
      <div className="p-4 border-b">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold">Character Manager</h2>
          <div className="flex gap-2">
            <input
              type="file"
              accept=".json"
              onChange={importFromJSON}
              className="hidden"
              id="import-json"
            />
            <Button
              variant="outline"
              size="sm"
              onClick={() => document.getElementById('import-json')?.click()}
            >
              <Upload className="w-4 h-4 mr-1" />
              Import
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => exportToJSON()}
            >
              <Download className="w-4 h-4 mr-1" />
              Export All
            </Button>
            <Dialog open={isCreating} onOpenChange={setIsCreating}>
              <DialogTrigger asChild>
                <Button size="sm">
                  <Plus className="w-4 h-4 mr-1" />
                  New Character
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle>Create New Character</DialogTitle>
                </DialogHeader>
                <Tabs defaultValue="basic" className="w-full">
                  <TabsList className="grid w-full grid-cols-3">
                    <TabsTrigger value="basic">Basic Info</TabsTrigger>
                    <TabsTrigger value="stats">Stats</TabsTrigger>
                    <TabsTrigger value="details">Details</TabsTrigger>
                  </TabsList>
                  
                  <TabsContent value="basic" className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <Label htmlFor="name">Character Name *</Label>
                        <Input
                          id="name"
                          value={newCharacter.name || ""}
                          onChange={(e) => setNewCharacter(prev => ({ ...prev, name: e.target.value }))}
                          placeholder="Enter character name"
                        />
                      </div>
                      <div>
                        <Label htmlFor="level">Level</Label>
                        <Input
                          id="level"
                          type="number"
                          min="1"
                          max="20"
                          value={newCharacter.level || 1}
                          onChange={(e) => setNewCharacter(prev => ({ ...prev, level: parseInt(e.target.value) }))}
                        />
                      </div>
                      <div>
                        <Label htmlFor="class">Class *</Label>
                        <Select 
                          value={newCharacter.class || ""} 
                          onValueChange={(value) => setNewCharacter(prev => ({ ...prev, class: value }))}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Select a class" />
                          </SelectTrigger>
                          <SelectContent>
                            {classes.map(cls => (
                              <SelectItem key={cls} value={cls}>{cls}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <Label htmlFor="race">Race *</Label>
                        <Select 
                          value={newCharacter.race || ""} 
                          onValueChange={(value) => setNewCharacter(prev => ({ ...prev, race: value }))}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Select a race" />
                          </SelectTrigger>
                          <SelectContent>
                            {races.map(race => (
                              <SelectItem key={race} value={race}>{race}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="col-span-2">
                        <Label htmlFor="background">Background</Label>
                        <Input
                          id="background"
                          value={newCharacter.background || ""}
                          onChange={(e) => setNewCharacter(prev => ({ ...prev, background: e.target.value }))}
                          placeholder="Enter background"
                        />
                      </div>
                    </div>
                  </TabsContent>

                  <TabsContent value="stats" className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <Label htmlFor="ac">Armor Class</Label>
                        <Input
                          id="ac"
                          type="number"
                          value={newCharacter.armorClass || 10}
                          onChange={(e) => setNewCharacter(prev => ({ ...prev, armorClass: parseInt(e.target.value) }))}
                        />
                      </div>
                      <div>
                        <Label htmlFor="hp">Hit Points</Label>
                        <Input
                          id="hp"
                          type="number"
                          value={newCharacter.hitPoints?.maximum || 0}
                          onChange={(e) => {
                            const hp = parseInt(e.target.value);
                            setNewCharacter(prev => ({ 
                              ...prev, 
                              hitPoints: { current: hp, maximum: hp }
                            }));
                          }}
                        />
                      </div>
                    </div>
                    
                    <div>
                      <Label>Ability Scores</Label>
                      <div className="grid grid-cols-3 gap-4 mt-2">
                        {Object.entries(newCharacter.abilities || {}).map(([ability, score]) => (
                          <div key={ability}>
                            <Label className="text-sm capitalize">{ability}</Label>
                            <Input
                              type="number"
                              min="3"
                              max="20"
                              value={score}
                              onChange={(e) => setNewCharacter(prev => ({
                                ...prev,
                                abilities: {
                                  ...prev.abilities!,
                                  [ability]: parseInt(e.target.value)
                                }
                              }))}
                            />
                          </div>
                        ))}
                      </div>
                    </div>
                  </TabsContent>

                  <TabsContent value="details" className="space-y-4">
                    <div>
                      <Label htmlFor="backstory">Backstory</Label>
                      <Textarea
                        id="backstory"
                        value={newCharacter.backstory || ""}
                        onChange={(e) => setNewCharacter(prev => ({ ...prev, backstory: e.target.value }))}
                        placeholder="Enter character backstory"
                        rows={4}
                      />
                    </div>
                    <div>
                      <Label htmlFor="notes">Notes</Label>
                      <Textarea
                        id="notes"
                        value={newCharacter.notes || ""}
                        onChange={(e) => setNewCharacter(prev => ({ ...prev, notes: e.target.value }))}
                        placeholder="Enter any additional notes"
                        rows={3}
                      />
                    </div>
                  </TabsContent>
                </Tabs>
                
                <div className="flex justify-end gap-2 pt-4">
                  <Button variant="outline" onClick={() => setIsCreating(false)}>
                    Cancel
                  </Button>
                  <Button onClick={handleCreateCharacter}>
                    Create Character
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          </div>
        </div>

        {/* Search and Filter */}
        <div className="flex gap-2 mb-4">
          <Input
            placeholder="Search characters..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="flex-1"
          />
          <Select value={sortBy} onValueChange={(value) => setSortBy(value as any)}>
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="lastPlayed">Last Played</SelectItem>
              <SelectItem value="name">Name</SelectItem>
              <SelectItem value="level">Level</SelectItem>
              <SelectItem value="class">Class</SelectItem>
            </SelectContent>
          </Select>
          <Select value={filterClass} onValueChange={setFilterClass}>
            <SelectTrigger className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Classes</SelectItem>
              {classes.map(cls => (
                <SelectItem key={cls} value={cls}>{cls}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Character List */}
        <div className="w-80 border-r">
          <ScrollArea className="h-full">
            <div className="p-2 space-y-2">
              {filteredCharacters.map((character) => (
                <Card 
                  key={character.id}
                  className={`cursor-pointer transition-colors ${
                    selectedCharacter?.id === character.id ? 'ring-2 ring-primary' : ''
                  } ${character.isActive ? 'bg-primary/5 border-primary/20' : ''}`}
                  onClick={() => setSelectedCharacter(character)}
                >
                  <CardContent className="p-3">
                    <div className="flex items-start justify-between">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <h3 className="font-medium truncate">{character.name}</h3>
                          {character.isActive && <Badge variant="default" className="text-xs">Active</Badge>}
                          {character.isFavorite && <Star className="w-3 h-3 text-yellow-500 fill-current" />}
                        </div>
                        <p className="text-sm text-muted-foreground">
                          Level {character.level} {character.race} {character.class}
                        </p>
                        <p className="text-xs text-muted-foreground mt-1">
                          Played {character.lastPlayed.toLocaleDateString()}
                        </p>
                      </div>
                      <div className="flex flex-col gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleToggleFavorite(character.id);
                          }}
                          className="h-6 w-6 p-0"
                        >
                          <Star className={`w-3 h-3 ${character.isFavorite ? 'text-yellow-500 fill-current' : ''}`} />
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </ScrollArea>
        </div>

        {/* Character Details */}
        <div className="flex-1">
          {selectedCharacter ? (
            <div className="h-full flex flex-col">
              <div className="p-4 border-b">
                <div className="flex items-center justify-between mb-2">
                  <h2 className="text-xl font-semibold">{selectedCharacter.name}</h2>
                  <div className="flex gap-2">
                    {!selectedCharacter.isActive && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleSetActive(selectedCharacter.id)}
                      >
                        <User className="w-4 h-4 mr-1" />
                        Set Active
                      </Button>
                    )}
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleDuplicateCharacter(selectedCharacter)}
                    >
                      <Copy className="w-4 h-4 mr-1" />
                      Duplicate
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => exportToJSON(selectedCharacter)}
                    >
                      <FileDown className="w-4 h-4 mr-1" />
                      JSON
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => exportToPDF(selectedCharacter)}
                    >
                      <FileText className="w-4 h-4 mr-1" />
                      PDF
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
                          <AlertDialogTitle>Delete Character</AlertDialogTitle>
                          <AlertDialogDescription>
                            Are you sure you want to delete {selectedCharacter.name}? This action cannot be undone.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction
                            onClick={() => handleDeleteCharacter(selectedCharacter.id)}
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
                  <span>Level {selectedCharacter.level} {selectedCharacter.race} {selectedCharacter.class}</span>
                  <span>•</span>
                  <span>{selectedCharacter.background}</span>
                  <span>•</span>
                  <span>AC {selectedCharacter.armorClass}</span>
                  <span>•</span>
                  <span>{selectedCharacter.hitPoints.current}/{selectedCharacter.hitPoints.maximum} HP</span>
                </div>
              </div>

              <ScrollArea className="flex-1">
                <div className="p-4 space-y-6">
                  {/* Ability Scores */}
                  <div>
                    <h3 className="font-medium mb-3">Ability Scores</h3>
                    <div className="grid grid-cols-6 gap-3">
                      {Object.entries(selectedCharacter.abilities).map(([ability, score]) => (
                        <div key={ability} className="text-center p-3 border rounded">
                          <div className="text-xs font-medium capitalize mb-1">{ability.slice(0, 3)}</div>
                          <div className="font-bold text-lg">{getAbilityModifier(score) >= 0 ? '+' : ''}{getAbilityModifier(score)}</div>
                          <div className="text-xs text-muted-foreground">({score})</div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Skills */}
                  {selectedCharacter.skills.length > 0 && (
                    <div>
                      <h3 className="font-medium mb-3">Skills</h3>
                      <div className="flex flex-wrap gap-2">
                        {selectedCharacter.skills.map((skill, index) => (
                          <Badge key={index} variant="secondary">{skill}</Badge>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Equipment */}
                  {selectedCharacter.equipment.length > 0 && (
                    <div>
                      <h3 className="font-medium mb-3">Equipment</h3>
                      <div className="space-y-2">
                        {selectedCharacter.equipment.map((item, index) => (
                          <div key={index} className="p-2 border rounded text-sm">{item}</div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Spells */}
                  {selectedCharacter.spells.length > 0 && (
                    <div>
                      <h3 className="font-medium mb-3">Spells</h3>
                      <div className="space-y-2">
                        {selectedCharacter.spells.map((spell, index) => (
                          <div key={index} className="p-2 border rounded text-sm">{spell}</div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Backstory */}
                  {selectedCharacter.backstory && (
                    <div>
                      <h3 className="font-medium mb-3">Backstory</h3>
                      <p className="text-sm leading-relaxed">{selectedCharacter.backstory}</p>
                    </div>
                  )}

                  {/* Notes */}
                  {selectedCharacter.notes && (
                    <div>
                      <h3 className="font-medium mb-3">Notes</h3>
                      <p className="text-sm leading-relaxed">{selectedCharacter.notes}</p>
                    </div>
                  )}
                </div>
              </ScrollArea>
            </div>
          ) : (
            <div className="flex-1 flex items-center justify-center text-muted-foreground">
              <div className="text-center">
                <Users className="w-12 h-12 mx-auto mb-4 opacity-50" />
                <p>Select a character to view details</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
