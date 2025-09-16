import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { Input } from "./ui/input";
import { ScrollArea } from "./ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "./ui/accordion";
import { 
  Book,
  Search,
  Bookmark,
  Star,
  Download,
  ExternalLink,
  FileText,
  Dice6,
  Users,
  Zap,
  Sword
} from "lucide-react";

interface Rule {
  id: string;
  title: string;
  content: string;
  category: string;
  tags: string[];
  isFavorite: boolean;
  page?: number;
}

interface RuleBook {
  id: string;
  title: string;
  abbreviation: string;
  description: string;
  version: string;
  isOfficial: boolean;
  isOwned: boolean;
  coverImage?: string;
  rules: Rule[];
}

export function RuleBooks() {
  const [selectedBook, setSelectedBook] = useState<RuleBook | null>(null);
  const [selectedRule, setSelectedRule] = useState<Rule | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [activeCategory, setActiveCategory] = useState<string>("all");

  const [ruleBooks] = useState<RuleBook[]>([
    {
      id: "phb",
      title: "Player's Handbook",
      abbreviation: "PHB",
      description: "The essential sourcebook for players and Dungeon Masters of the world's greatest roleplaying game.",
      version: "5th Edition",
      isOfficial: true,
      isOwned: true,
      rules: [
        {
          id: "advantage",
          title: "Advantage and Disadvantage",
          content: "Sometimes a special ability or spell tells you that you have advantage or disadvantage on an ability check, a saving throw, or an attack roll. When that happens, you roll a second d20 when you make the roll. Use the higher of the two rolls if you have advantage, and use the lower roll if you have disadvantage.",
          category: "Core Mechanics",
          tags: ["dice", "rolling", "mechanics"],
          isFavorite: true,
          page: 173
        },
        {
          id: "spellcasting",
          title: "Spellcasting",
          content: "Magic permeates fantasy gaming worlds and often appears in the form of a spell. A spell is a discrete magical effect, a single shaping of the magical energies that suffuse the multiverse into a specific, limited expression.",
          category: "Magic",
          tags: ["spells", "magic", "casting"],
          isFavorite: false,
          page: 201
        },
        {
          id: "inspiration",
          title: "Inspiration",
          content: "Inspiration is a rule the Dungeon Master can use to reward you for playing your character in a way that's true to his or her personality traits, ideal, bond, and flaw. By using inspiration, you can draw on your personality trait of compassion for the downtrodden to give you an edge in negotiating with the Beggar Prince.",
          category: "Core Mechanics",
          tags: ["roleplay", "dm", "reward"],
          isFavorite: true,
          page: 125
        },
        {
          id: "combat",
          title: "Combat",
          content: "The clatter of a sword striking against a shield. The terrible rending sound as monstrous claws tear through armor. A brilliant flash of light as a ball of flame blossoms from a wizard's spell. The sharp tang of blood in the air, cutting through the stench of vile monsters. Roars of fury, shouts of triumph, cries of pain. Combat in D&D can be chaotic, deadly, and thrilling.",
          category: "Combat",
          tags: ["combat", "fighting", "turns"],
          isFavorite: false,
          page: 189
        },
        {
          id: "conditions",
          title: "Conditions",
          content: "Conditions alter a creature's capabilities in a variety of ways and can arise as a result of a spell, a class feature, a monster's attack, or other effect. Most conditions, such as blinded, are impairments, but a few, such as invisible, can be advantageous.",
          category: "Combat",
          tags: ["conditions", "effects", "status"],
          isFavorite: true,
          page: 290
        }
      ]
    },
    {
      id: "dmg",
      title: "Dungeon Master's Guide",
      abbreviation: "DMG",
      description: "The Dungeon Master's Guide provides the tools, tips, and rules you need to be a great DM.",
      version: "5th Edition",
      isOfficial: true,
      isOwned: true,
      rules: [
        {
          id: "difficulty-class",
          title: "Difficulty Class",
          content: "To set a DC, think of how hard the task is and then pick the associated number from the Typical DCs table. Use the modifier based on the circumstances.",
          category: "DM Guidance",
          tags: ["dc", "difficulty", "checks"],
          isFavorite: true,
          page: 238
        },
        {
          id: "magic-items",
          title: "Magic Items",
          content: "Magic items are gleaned from the hoards of conquered monsters or discovered in long-lost vaults. Such items grant capabilities a character could rarely have otherwise, or they complement their owner's capabilities in wondrous ways.",
          category: "Magic Items",
          tags: ["magic", "items", "treasure"],
          isFavorite: false,
          page: 135
        }
      ]
    },
    {
      id: "mm",
      title: "Monster Manual",
      abbreviation: "MM",
      description: "The Monster Manual presents a horde of classic Dungeons & Dragons creatures.",
      version: "5th Edition",
      isOfficial: true,
      isOwned: false,
      rules: [
        {
          id: "cr",
          title: "Challenge Rating",
          content: "A monster's challenge rating tells you how great a threat the monster is. An appropriately equipped and well-rested party of four adventurers should be able to defeat a monster that has a challenge rating equal to its level without suffering any deaths.",
          category: "Monsters",
          tags: ["cr", "challenge", "encounters"],
          isFavorite: false,
          page: 9
        }
      ]
    },
    {
      id: "xgte",
      title: "Xanathar's Guide to Everything",
      abbreviation: "XGtE",
      description: "Xanathar's Guide to Everything provides options for both players and Dungeon Masters.",
      version: "5th Edition",
      isOfficial: true,
      isOwned: true,
      rules: [
        {
          id: "downtime",
          title: "Downtime Activities",
          content: "Between adventures, the DM might ask you what your character is doing during his or her downtime. Periods of downtime can vary in duration, but each downtime activity requires a certain number of days to complete before you gain any benefit.",
          category: "Downtime",
          tags: ["downtime", "activities", "crafting"],
          isFavorite: false,
          page: 123
        }
      ]
    }
  ]);

  const categories = ["all", "Core Mechanics", "Combat", "Magic", "DM Guidance", "Magic Items", "Monsters", "Downtime"];

  const filteredRules = selectedBook?.rules.filter(rule => {
    const matchesSearch = rule.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         rule.content.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         rule.tags.some(tag => tag.toLowerCase().includes(searchTerm.toLowerCase()));
    const matchesCategory = activeCategory === "all" || rule.category === activeCategory;
    return matchesSearch && matchesCategory;
  }) || [];

  const favoriteRules = ruleBooks.flatMap(book => book.rules.filter(rule => rule.isFavorite));

  const handleToggleFavorite = (ruleId: string) => {
    // In a real app, this would update the backend
    console.log(`Toggle favorite for rule: ${ruleId}`);
  };

  const getRuleIcon = (category: string) => {
    switch (category) {
      case "Combat": return <Sword className="w-4 h-4" />;
      case "Magic": return <Zap className="w-4 h-4" />;
      case "DM Guidance": return <Users className="w-4 h-4" />;
      case "Monsters": return <Users className="w-4 h-4" />;
      case "Core Mechanics": return <Dice6 className="w-4 h-4" />;
      default: return <FileText className="w-4 h-4" />;
    }
  };

  return (
    <div className="h-full flex flex-col">
      <div className="p-4 border-b">
        <h2 className="font-semibold mb-4">Rule Books</h2>
        
        <Tabs defaultValue="browse" className="w-full">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="browse">Browse Books</TabsTrigger>
            <TabsTrigger value="search">Search Rules</TabsTrigger>
            <TabsTrigger value="favorites">Favorites</TabsTrigger>
          </TabsList>

          <TabsContent value="browse" className="mt-4">
            <div className="grid grid-cols-2 gap-3">
              {ruleBooks.map((book) => (
                <Card 
                  key={book.id}
                  className={`cursor-pointer transition-colors ${
                    selectedBook?.id === book.id ? 'ring-2 ring-primary' : ''
                  } ${!book.isOwned ? 'opacity-60' : ''}`}
                  onClick={() => setSelectedBook(book)}
                >
                  <CardContent className="p-3">
                    <div className="flex items-start gap-3">
                      <div className="w-12 h-16 bg-gradient-to-b from-primary/20 to-primary/5 rounded border flex items-center justify-center">
                        <Book className="w-6 h-6 text-primary" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <h3 className="font-medium text-sm truncate">{book.title}</h3>
                          <Badge variant="outline" className="text-xs">{book.abbreviation}</Badge>
                        </div>
                        <p className="text-xs text-muted-foreground mb-2 line-clamp-2">
                          {book.description}
                        </p>
                        <div className="flex items-center justify-between">
                          <div className="flex gap-2">
                            {book.isOfficial && <Badge variant="secondary" className="text-xs">Official</Badge>}
                            {book.isOwned ? (
                              <Badge variant="default" className="text-xs">Owned</Badge>
                            ) : (
                              <Badge variant="outline" className="text-xs">Not Owned</Badge>
                            )}
                          </div>
                          <span className="text-xs text-muted-foreground">{book.rules.length} rules</span>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </TabsContent>

          <TabsContent value="search" className="mt-4">
            <div className="space-y-4">
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    placeholder="Search rules, content, or tags..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="pl-10"
                  />
                </div>
                <select 
                  value={activeCategory}
                  onChange={(e) => setActiveCategory(e.target.value)}
                  className="px-3 py-2 border rounded-md bg-background"
                >
                  {categories.map(category => (
                    <option key={category} value={category}>
                      {category === "all" ? "All Categories" : category}
                    </option>
                  ))}
                </select>
              </div>

              {selectedBook && (
                <div className="space-y-2">
                  <h3 className="font-medium">Rules from {selectedBook.title}</h3>
                  {filteredRules.map((rule) => (
                    <Card 
                      key={rule.id}
                      className={`cursor-pointer transition-colors ${
                        selectedRule?.id === rule.id ? 'ring-2 ring-primary' : ''
                      }`}
                      onClick={() => setSelectedRule(rule)}
                    >
                      <CardContent className="p-3">
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-1">
                              {getRuleIcon(rule.category)}
                              <h4 className="font-medium text-sm">{rule.title}</h4>
                              <Badge variant="outline" className="text-xs">{rule.category}</Badge>
                              {rule.page && (
                                <span className="text-xs text-muted-foreground">p. {rule.page}</span>
                              )}
                            </div>
                            <p className="text-xs text-muted-foreground line-clamp-2 mb-2">
                              {rule.content}
                            </p>
                            <div className="flex flex-wrap gap-1">
                              {rule.tags.map((tag, index) => (
                                <Badge key={index} variant="secondary" className="text-xs">
                                  {tag}
                                </Badge>
                              ))}
                            </div>
                          </div>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleToggleFavorite(rule.id);
                            }}
                            className="h-6 w-6 p-0 ml-2"
                          >
                            <Star className={`w-3 h-3 ${rule.isFavorite ? 'text-yellow-500 fill-current' : ''}`} />
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </div>
          </TabsContent>

          <TabsContent value="favorites" className="mt-4">
            <div className="space-y-2">
              <h3 className="font-medium">Favorite Rules</h3>
              {favoriteRules.length > 0 ? (
                favoriteRules.map((rule) => (
                  <Card key={rule.id} className="cursor-pointer" onClick={() => setSelectedRule(rule)}>
                    <CardContent className="p-3">
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            {getRuleIcon(rule.category)}
                            <h4 className="font-medium text-sm">{rule.title}</h4>
                            <Badge variant="outline" className="text-xs">{rule.category}</Badge>
                          </div>
                          <p className="text-xs text-muted-foreground line-clamp-2">
                            {rule.content}
                          </p>
                        </div>
                        <Star className="w-4 h-4 text-yellow-500 fill-current ml-2" />
                      </div>
                    </CardContent>
                  </Card>
                ))
              ) : (
                <div className="text-center py-8 text-muted-foreground">
                  <Bookmark className="w-12 h-12 mx-auto mb-4 opacity-50" />
                  <p>No favorite rules yet</p>
                  <p className="text-sm">Star rules to add them to your favorites</p>
                </div>
              )}
            </div>
          </TabsContent>
        </Tabs>
      </div>

      {/* Rule Details Panel */}
      {selectedRule && (
        <div className="flex-1 border-t">
          <ScrollArea className="h-full">
            <div className="p-4">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  {getRuleIcon(selectedRule.category)}
                  <h2 className="text-lg font-semibold">{selectedRule.title}</h2>
                  <Badge variant="outline">{selectedRule.category}</Badge>
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleToggleFavorite(selectedRule.id)}
                  >
                    <Star className={`w-4 h-4 ${selectedRule.isFavorite ? 'text-yellow-500 fill-current' : ''}`} />
                  </Button>
                  <Button variant="ghost" size="sm">
                    <Download className="w-4 h-4" />
                  </Button>
                </div>
              </div>

              {selectedRule.page && (
                <p className="text-sm text-muted-foreground mb-3">
                  Page {selectedRule.page} in {selectedBook?.title}
                </p>
              )}

              <div className="prose prose-sm max-w-none">
                <p className="leading-relaxed">{selectedRule.content}</p>
              </div>

              {selectedRule.tags.length > 0 && (
                <div className="mt-6">
                  <h3 className="font-medium mb-2">Tags</h3>
                  <div className="flex flex-wrap gap-2">
                    {selectedRule.tags.map((tag, index) => (
                      <Badge key={index} variant="secondary" className="text-xs">
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