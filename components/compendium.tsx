import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { Input } from "./ui/input";
import { ScrollArea } from "./ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "./ui/accordion";
import { 
  Library,
  Search,
  Bookmark,
  Star,
  Users,
  Sword,
  Sparkles,
  Crown,
  MapPin,
  Scroll,
  Shield,
  Zap,
  Eye,
  Filter
} from "lucide-react";

interface CompendiumItem {
  id: string;
  name: string;
  type: "spell" | "monster" | "item" | "location" | "npc" | "organization" | "lore";
  description: string;
  details: Record<string, any>;
  tags: string[];
  source: string;
  isFavorite: boolean;
  isCustom: boolean;
}

export function Compendium() {
  const [activeTab, setActiveTab] = useState<string>("spells");
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedItem, setSelectedItem] = useState<CompendiumItem | null>(null);
  const [filterSource, setFilterSource] = useState<string>("all");

  const [compendiumData] = useState<CompendiumItem[]>([
    // Spells
    {
      id: "fireball",
      name: "Fireball",
      type: "spell",
      description: "A bright streak flashes from your pointing finger to a point you choose within range and then blossoms with a low roar into an explosion of flame.",
      details: {
        level: 3,
        school: "Evocation",
        castingTime: "1 action",
        range: "150 feet",
        components: "V, S, M (a tiny ball of bat guano and sulfur)",
        duration: "Instantaneous",
        damage: "8d6 fire damage",
        saveType: "Dexterity",
        ritual: false,
        concentration: false
      },
      tags: ["fire", "damage", "area", "wizard", "sorcerer"],
      source: "Player's Handbook",
      isFavorite: true,
      isCustom: false
    },
    {
      id: "healing-word",
      name: "Healing Word",
      type: "spell",
      description: "A creature of your choice that you can see within range regains hit points equal to 1d4 + your spellcasting ability modifier.",
      details: {
        level: 1,
        school: "Evocation",
        castingTime: "1 bonus action",
        range: "60 feet",
        components: "V",
        duration: "Instantaneous",
        healing: "1d4 + spellcasting modifier",
        ritual: false,
        concentration: false
      },
      tags: ["healing", "bonus action", "cleric", "bard"],
      source: "Player's Handbook",
      isFavorite: false,
      isCustom: false
    },
    
    // Monsters
    {
      id: "ancient-red-dragon",
      name: "Ancient Red Dragon",
      type: "monster",
      description: "The most covetous of the true dragons, red dragons tirelessly seek to increase their treasure hoards.",
      details: {
        size: "Gargantuan",
        type: "dragon",
        alignment: "Chaotic Evil",
        armorClass: 22,
        hitPoints: 546,
        speed: "40 ft., climb 40 ft., fly 80 ft.",
        challengeRating: 24,
        abilities: {
          strength: 30,
          dexterity: 10,
          constitution: 29,
          intelligence: 18,
          wisdom: 15,
          charisma: 23
        },
        savingThrows: "Dex +7, Con +17, Wis +9, Cha +13",
        skills: "Perception +16, Stealth +7",
        damageImmunities: "Fire",
        senses: "Blindsight 60 ft., Darkvision 120 ft., Passive Perception 26",
        languages: "Common, Draconic"
      },
      tags: ["dragon", "fire", "legendary", "lair", "boss"],
      source: "Monster Manual",
      isFavorite: true,
      isCustom: false
    },
    {
      id: "goblin",
      name: "Goblin",
      type: "monster",
      description: "Goblins are small, black-hearted humanoids that lair in despoiled dungeons and other dismal settings.",
      details: {
        size: "Small",
        type: "humanoid (goblinoid)",
        alignment: "Neutral Evil",
        armorClass: 15,
        hitPoints: 7,
        speed: "30 ft.",
        challengeRating: "1/4",
        abilities: {
          strength: 8,
          dexterity: 14,
          constitution: 10,
          intelligence: 10,
          wisdom: 8,
          charisma: 8
        },
        skills: "Stealth +6",
        senses: "Darkvision 60 ft., Passive Perception 9",
        languages: "Common, Goblin"
      },
      tags: ["humanoid", "small", "stealth", "low-level"],
      source: "Monster Manual",
      isFavorite: false,
      isCustom: false
    },

    // Magic Items
    {
      id: "bag-of-holding",
      name: "Bag of Holding",
      type: "item",
      description: "This bag has an interior space considerably larger than its outside dimensions.",
      details: {
        rarity: "Uncommon",
        type: "Wondrous item",
        attunement: false,
        weight: "15 lbs",
        capacity: "500 lbs",
        volume: "64 cubic feet",
        effect: "The bag can hold up to 500 pounds, not exceeding a volume of 64 cubic feet. If overloaded, pierced, or torn, it ruptures and is destroyed, and its contents are scattered in the Astral Plane."
      },
      tags: ["storage", "utility", "uncommon", "wondrous"],
      source: "Dungeon Master's Guide",
      isFavorite: true,
      isCustom: false
    },
    {
      id: "flame-tongue",
      name: "Flame Tongue",
      type: "item",
      description: "You can use a bonus action to speak this magic sword's command word, causing flames to erupt from the blade.",
      details: {
        rarity: "Rare",
        type: "Weapon (any sword)",
        attunement: true,
        damage: "+2d6 fire damage",
        effect: "While the sword is ablaze, it deals an extra 2d6 fire damage to any target it hits. The flames last until you use a bonus action to speak the command word again or until you drop or sheathe the sword.",
        light: "The flaming blade sheds bright light in a 40-foot radius and dim light for an additional 40 feet."
      },
      tags: ["weapon", "fire", "rare", "attunement"],
      source: "Dungeon Master's Guide",
      isFavorite: false,
      isCustom: false
    },

    // Locations
    {
      id: "rivendell",
      name: "Rivendell",
      type: "location",
      description: "A hidden valley and elven outpost in Middle-earth, also known as Imladris.",
      details: {
        region: "Rhudaur",
        type: "Elven refuge",
        population: "Small elven community",
        ruler: "Elrond",
        notable_features: [
          "House of Elrond",
          "Council chamber",
          "Healing halls",
          "Great library",
          "Ford of Bruinen"
        ],
        climate: "Temperate, magically protected",
        defenses: "Hidden by elven magic, protected by the Bruinen river"
      },
      tags: ["elven", "safe haven", "magic", "healing", "hidden"],
      source: "Custom",
      isFavorite: true,
      isCustom: true
    },

    // NPCs
    {
      id: "elrond",
      name: "Elrond",
      type: "npc",
      description: "The Lord of Rivendell, one of the mightiest Elves in Middle-earth.",
      details: {
        race: "Half-elf",
        class: "Noble/Lore Master",
        level: 20,
        alignment: "Lawful Good",
        location: "Rivendell",
        role: "Lord of Rivendell, Keeper of Vilya",
        personality: "Wise, noble, somewhat melancholy",
        background: "Herald of Gil-galad, survivor of the Last Alliance",
        relationships: {
          "Gandalf": "Close ally and friend",
          "Aragorn": "Foster father",
          "Arwen": "Daughter"
        }
      },
      tags: ["elf", "noble", "wise", "powerful", "ally"],
      source: "Custom",
      isFavorite: true,
      isCustom: true
    },

    // Organizations
    {
      id: "fellowship",
      name: "The Fellowship of the Ring",
      type: "organization",
      description: "A company formed to protect the Ring-bearer on his journey to destroy the One Ring.",
      details: {
        type: "Adventuring company",
        founded: "Council of Elrond",
        purpose: "Protect Frodo and destroy the One Ring",
        size: 9,
        status: "Active",
        members: [
          "Frodo Baggins (Ring-bearer)",
          "Gandalf the Grey (Wizard)",
          "Aragorn (Ranger)",
          "Boromir (Warrior of Gondor)",
          "Legolas (Elf-prince)",
          "Gimli (Dwarf-lord)",
          "Samwise Gamgee (Hobbit)",
          "Meriadoc Brandybuck (Hobbit)",
          "Peregrin Took (Hobbit)"
        ],
        motto: "One Ring to rule them all"
      },
      tags: ["fellowship", "heroes", "quest", "ring"],
      source: "Custom",
      isFavorite: true,
      isCustom: true
    }
  ]);

  const tabCategories = {
    spells: { icon: <Sparkles className="w-4 h-4" />, label: "Spells" },
    monsters: { icon: <Users className="w-4 h-4" />, label: "Monsters" },
    items: { icon: <Crown className="w-4 h-4" />, label: "Magic Items" },
    locations: { icon: <MapPin className="w-4 h-4" />, label: "Locations" },
    npcs: { icon: <Eye className="w-4 h-4" />, label: "NPCs" },
    organizations: { icon: <Shield className="w-4 h-4" />, label: "Organizations" },
    lore: { icon: <Scroll className="w-4 h-4" />, label: "Lore" }
  };

  const filteredItems = compendiumData.filter(item => {
    const matchesTab = activeTab === "all" || item.type === activeTab.slice(0, -1) || 
                      (activeTab === "items" && item.type === "item") ||
                      (activeTab === "npcs" && item.type === "npc");
    const matchesSearch = item.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         item.description.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         item.tags.some(tag => tag.toLowerCase().includes(searchTerm.toLowerCase()));
    const matchesSource = filterSource === "all" || 
                         (filterSource === "official" && !item.isCustom) ||
                         (filterSource === "custom" && item.isCustom);
    return matchesTab && matchesSearch && matchesSource;
  });

  const favoriteItems = compendiumData.filter(item => item.isFavorite);

  const handleToggleFavorite = (itemId: string) => {
    // In a real app, this would update the backend
    console.log(`Toggle favorite for item: ${itemId}`);
  };

  const getItemIcon = (type: string) => {
    switch (type) {
      case "spell": return <Sparkles className="w-4 h-4" />;
      case "monster": return <Users className="w-4 h-4" />;
      case "item": return <Crown className="w-4 h-4" />;
      case "location": return <MapPin className="w-4 h-4" />;
      case "npc": return <Eye className="w-4 h-4" />;
      case "organization": return <Shield className="w-4 h-4" />;
      case "lore": return <Scroll className="w-4 h-4" />;
      default: return <Library className="w-4 h-4" />;
    }
  };

  const renderItemDetails = (item: CompendiumItem) => {
    switch (item.type) {
      case "spell":
        return (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <span className="font-medium">Level:</span> {item.details.level}
              </div>
              <div>
                <span className="font-medium">School:</span> {item.details.school}
              </div>
              <div>
                <span className="font-medium">Casting Time:</span> {item.details.castingTime}
              </div>
              <div>
                <span className="font-medium">Range:</span> {item.details.range}
              </div>
              <div>
                <span className="font-medium">Components:</span> {item.details.components}
              </div>
              <div>
                <span className="font-medium">Duration:</span> {item.details.duration}
              </div>
            </div>
            {item.details.damage && (
              <div>
                <span className="font-medium">Damage:</span> {item.details.damage}
              </div>
            )}
            {item.details.healing && (
              <div>
                <span className="font-medium">Healing:</span> {item.details.healing}
              </div>
            )}
          </div>
        );
      
      case "monster":
        return (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <span className="font-medium">Size:</span> {item.details.size}
              </div>
              <div>
                <span className="font-medium">Type:</span> {item.details.type}
              </div>
              <div>
                <span className="font-medium">AC:</span> {item.details.armorClass}
              </div>
              <div>
                <span className="font-medium">HP:</span> {item.details.hitPoints}
              </div>
              <div>
                <span className="font-medium">Speed:</span> {item.details.speed}
              </div>
              <div>
                <span className="font-medium">CR:</span> {item.details.challengeRating}
              </div>
            </div>
            
            <div>
              <h4 className="font-medium mb-2">Ability Scores</h4>
              <div className="grid grid-cols-6 gap-2 text-sm">
                {Object.entries(item.details.abilities).map(([ability, score]) => (
                  <div key={ability} className="text-center">
                    <div className="font-medium capitalize">{ability.slice(0, 3)}</div>
                    <div>{score as number} ({Math.floor(((score as number) - 10) / 2) >= 0 ? '+' : ''}{Math.floor(((score as number) - 10) / 2)})</div>
                  </div>
                ))}
              </div>
            </div>

            {item.details.skills && (
              <div>
                <span className="font-medium">Skills:</span> {item.details.skills}
              </div>
            )}
            {item.details.damageImmunities && (
              <div>
                <span className="font-medium">Damage Immunities:</span> {item.details.damageImmunities}
              </div>
            )}
            <div>
              <span className="font-medium">Senses:</span> {item.details.senses}
            </div>
            <div>
              <span className="font-medium">Languages:</span> {item.details.languages}
            </div>
          </div>
        );

      case "item":
        return (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <span className="font-medium">Rarity:</span> {item.details.rarity}
              </div>
              <div>
                <span className="font-medium">Type:</span> {item.details.type}
              </div>
              <div>
                <span className="font-medium">Attunement:</span> {item.details.attunement ? "Required" : "Not required"}
              </div>
              {item.details.weight && (
                <div>
                  <span className="font-medium">Weight:</span> {item.details.weight}
                </div>
              )}
            </div>
            <div>
              <span className="font-medium">Effect:</span> {item.details.effect}
            </div>
            {item.details.damage && (
              <div>
                <span className="font-medium">Damage:</span> {item.details.damage}
              </div>
            )}
          </div>
        );

      case "location":
        return (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <span className="font-medium">Region:</span> {item.details.region}
              </div>
              <div>
                <span className="font-medium">Type:</span> {item.details.type}
              </div>
              <div>
                <span className="font-medium">Population:</span> {item.details.population}
              </div>
              <div>
                <span className="font-medium">Ruler:</span> {item.details.ruler}
              </div>
            </div>
            {item.details.notable_features && (
              <div>
                <h4 className="font-medium mb-2">Notable Features</h4>
                <ul className="list-disc list-inside space-y-1">
                  {item.details.notable_features.map((feature: string, index: number) => (
                    <li key={index} className="text-sm">{feature}</li>
                  ))}
                </ul>
              </div>
            )}
            <div>
              <span className="font-medium">Climate:</span> {item.details.climate}
            </div>
            <div>
              <span className="font-medium">Defenses:</span> {item.details.defenses}
            </div>
          </div>
        );

      case "npc":
        return (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <span className="font-medium">Race:</span> {item.details.race}
              </div>
              <div>
                <span className="font-medium">Class:</span> {item.details.class}
              </div>
              <div>
                <span className="font-medium">Level:</span> {item.details.level}
              </div>
              <div>
                <span className="font-medium">Alignment:</span> {item.details.alignment}
              </div>
              <div>
                <span className="font-medium">Location:</span> {item.details.location}
              </div>
              <div>
                <span className="font-medium">Role:</span> {item.details.role}
              </div>
            </div>
            <div>
              <span className="font-medium">Personality:</span> {item.details.personality}
            </div>
            <div>
              <span className="font-medium">Background:</span> {item.details.background}
            </div>
            {item.details.relationships && (
              <div>
                <h4 className="font-medium mb-2">Relationships</h4>
                <div className="space-y-1">
                  {Object.entries(item.details.relationships).map(([name, relationship]) => (
                    <div key={name} className="text-sm">
                      <span className="font-medium">{name}:</span> {relationship as string}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        );

      case "organization":
        return (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <span className="font-medium">Type:</span> {item.details.type}
              </div>
              <div>
                <span className="font-medium">Founded:</span> {item.details.founded}
              </div>
              <div>
                <span className="font-medium">Size:</span> {item.details.size}
              </div>
              <div>
                <span className="font-medium">Status:</span> {item.details.status}
              </div>
            </div>
            <div>
              <span className="font-medium">Purpose:</span> {item.details.purpose}
            </div>
            {item.details.members && (
              <div>
                <h4 className="font-medium mb-2">Members</h4>
                <ul className="list-disc list-inside space-y-1">
                  {item.details.members.map((member: string, index: number) => (
                    <li key={index} className="text-sm">{member}</li>
                  ))}
                </ul>
              </div>
            )}
            {item.details.motto && (
              <div>
                <span className="font-medium">Motto:</span> <em>"{item.details.motto}"</em>
              </div>
            )}
          </div>
        );

      default:
        return (
          <div>
            <pre className="whitespace-pre-wrap text-sm">
              {JSON.stringify(item.details, null, 2)}
            </pre>
          </div>
        );
    }
  };

  return (
    <div className="h-full flex flex-col">
      <div className="p-4 border-b">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold">Compendium</h2>
          <div className="flex gap-2">
            <select 
              value={filterSource}
              onChange={(e) => setFilterSource(e.target.value)}
              className="px-3 py-1 border rounded-md bg-background text-sm"
            >
              <option value="all">All Sources</option>
              <option value="official">Official</option>
              <option value="custom">Custom</option>
            </select>
          </div>
        </div>
        
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="grid w-full grid-cols-7">
            {Object.entries(tabCategories).map(([key, { icon, label }]) => (
              <TabsTrigger key={key} value={key} className="flex items-center gap-1">
                {icon}
                <span className="hidden sm:inline">{label}</span>
              </TabsTrigger>
            ))}
          </TabsList>

          <div className="mt-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder={`Search ${tabCategories[activeTab as keyof typeof tabCategories]?.label.toLowerCase() || 'items'}...`}
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10"
              />
            </div>
          </div>

          {Object.keys(tabCategories).map(category => (
            <TabsContent key={category} value={category} className="mt-4">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {filteredItems.map((item) => (
                  <Card 
                    key={item.id}
                    className={`cursor-pointer transition-colors ${
                      selectedItem?.id === item.id ? 'ring-2 ring-primary' : ''
                    }`}
                    onClick={() => setSelectedItem(item)}
                  >
                    <CardContent className="p-3">
                      <div className="flex items-start justify-between mb-2">
                        <div className="flex items-center gap-2">
                          {getItemIcon(item.type)}
                          <h3 className="font-medium text-sm">{item.name}</h3>
                        </div>
                        <div className="flex gap-1">
                          {item.isCustom && (
                            <Badge variant="outline" className="text-xs">Custom</Badge>
                          )}
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleToggleFavorite(item.id);
                            }}
                            className="h-5 w-5 p-0"
                          >
                            <Star className={`w-3 h-3 ${item.isFavorite ? 'text-yellow-500 fill-current' : ''}`} />
                          </Button>
                        </div>
                      </div>
                      
                      <p className="text-xs text-muted-foreground line-clamp-3 mb-2">
                        {item.description}
                      </p>

                      <div className="flex items-center justify-between">
                        <div className="flex flex-wrap gap-1">
                          {item.tags.slice(0, 2).map((tag, index) => (
                            <Badge key={index} variant="secondary" className="text-xs">
                              {tag}
                            </Badge>
                          ))}
                          {item.tags.length > 2 && (
                            <span className="text-xs text-muted-foreground">
                              +{item.tags.length - 2}
                            </span>
                          )}
                        </div>
                        <span className="text-xs text-muted-foreground">{item.source}</span>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </TabsContent>
          ))}
        </Tabs>
      </div>

      {/* Item Details Panel */}
      {selectedItem && (
        <div className="flex-1 border-t">
          <ScrollArea className="h-full">
            <div className="p-4">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  {getItemIcon(selectedItem.type)}
                  <h2 className="text-lg font-semibold">{selectedItem.name}</h2>
                  <Badge variant="outline" className="capitalize">{selectedItem.type}</Badge>
                  {selectedItem.isCustom && <Badge variant="secondary">Custom</Badge>}
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleToggleFavorite(selectedItem.id)}
                  >
                    <Star className={`w-4 h-4 ${selectedItem.isFavorite ? 'text-yellow-500 fill-current' : ''}`} />
                  </Button>
                  <Button variant="ghost" size="sm">
                    <Bookmark className="w-4 h-4" />
                  </Button>
                </div>
              </div>

              <p className="text-sm text-muted-foreground mb-2">Source: {selectedItem.source}</p>

              <div className="prose prose-sm max-w-none mb-6">
                <p className="leading-relaxed">{selectedItem.description}</p>
              </div>

              {renderItemDetails(selectedItem)}

              {selectedItem.tags.length > 0 && (
                <div className="mt-6">
                  <h3 className="font-medium mb-2">Tags</h3>
                  <div className="flex flex-wrap gap-2">
                    {selectedItem.tags.map((tag, index) => (
                      <Badge key={index} variant="outline" className="text-xs">
                        {tag}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </ScrollArea>
        </div>
      )}
    </div>
  );
}