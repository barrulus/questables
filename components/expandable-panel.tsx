import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { Progress } from "./ui/progress";
import { Input } from "./ui/input";
import { Separator } from "./ui/separator";
import { ScrollArea } from "./ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";

import { RuleBooks } from "./rule-books";
import { Journals } from "./journals";
import { Compendium } from "./compendium";
import { Settings } from "./settings";
import { 
  User, 
  Package, 
  Dice6, 
  BookOpen, 
  Sword,
  Compass,
  Heart,
  Shield,
  Coins,
  Plus,
  Minus,
  X,
  Zap,
  ScrollText,
  Book,
  Library,
  Cog
} from "lucide-react";

interface ExpandablePanelProps {
  activePanel: string | null;
  onClose: () => void;
}

export function ExpandablePanel({ activePanel, onClose }: ExpandablePanelProps) {
  if (!activePanel) return null;

  const renderPanelContent = () => {
    switch (activePanel) {
      case "character":
        return <CharacterPanel />;
      case "inventory":
        return <InventoryPanel />;
      case "spells":
        return <SpellsPanel />;
      case "dice":
        return <DicePanel />;
      case "combat":
        return <CombatPanel />;
      case "exploration":
        return <ExplorationPanel />;
      case "rulebooks":
        return <RuleBooks />;
      case "journals":
        return <Journals />;
      case "compendium":
        return <Compendium />;
      case "settings":
        return <Settings />;
      default:
        return null;
    }
  };

  const getPanelTitle = () => {
    switch (activePanel) {
      case "character": return "Active Character";
      case "inventory": return "Inventory";
      case "spells": return "Spellbook";
      case "dice": return "Dice Roller";
      case "combat": return "Combat Tracker";
      case "exploration": return "Exploration Tools";
      case "rulebooks": return "Rule Books";
      case "journals": return "Session Notes";
      case "compendium": return "Compendium";
      case "settings": return "Settings";
      default: return "";
    }
  };

  const getPanelIcon = () => {
    switch (activePanel) {
      case "character": return <User className="w-5 h-5" />;
      case "inventory": return <Package className="w-5 h-5" />;
      case "spells": return <BookOpen className="w-5 h-5" />;
      case "dice": return <Dice6 className="w-5 h-5" />;
      case "combat": return <Sword className="w-5 h-5" />;
      case "exploration": return <Compass className="w-5 h-5" />;
      case "rulebooks": return <Book className="w-5 h-5" />;
      case "journals": return <ScrollText className="w-5 h-5" />;
      case "compendium": return <Library className="w-5 h-5" />;
      case "settings": return <Cog className="w-5 h-5" />;
      default: return null;
    }
  };

  return (
    <div className="w-96 border-r bg-card flex flex-col">
      <div className="border-b p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {getPanelIcon()}
            <h2 className="font-semibold">{getPanelTitle()}</h2>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose}>
            <X className="w-4 h-4" />
          </Button>
        </div>
      </div>
      
      <ScrollArea className="flex-1">
        <div className="p-4">
          {renderPanelContent()}
        </div>
      </ScrollArea>
    </div>
  );
}

function CharacterPanel() {
  const character = {
    name: "Aragorn Strider",
    class: "Ranger",
    level: 8,
    hitPoints: { current: 72, maximum: 72 },
    armorClass: 16,
    abilities: {
      strength: { modifier: 3, score: 16 },
      dexterity: { modifier: 3, score: 17 },
      constitution: { modifier: 2, score: 14 },
      intelligence: { modifier: 1, score: 12 },
      wisdom: { modifier: 4, score: 18 },
      charisma: { modifier: 0, score: 10 }
    }
  };

  return (
    <div className="space-y-6">
      {/* Character Info */}
      <div>
        <h3 className="font-medium mb-2">{character.name}</h3>
        <p className="text-sm text-muted-foreground">
          Level {character.level} {character.class}
        </p>
      </div>

      {/* HP and AC */}
      <div className="grid grid-cols-2 gap-3">
        <div className="text-center p-3 border rounded">
          <div className="flex items-center justify-center gap-1 mb-1">
            <Heart className="w-4 h-4 text-red-500" />
            <span className="font-medium">
              {character.hitPoints.current}/{character.hitPoints.maximum}
            </span>
          </div>
          <div className="text-xs text-muted-foreground mb-2">Hit Points</div>
          <Progress 
            value={(character.hitPoints.current / character.hitPoints.maximum) * 100} 
            className="h-2"
          />
        </div>
        <div className="text-center p-3 border rounded">
          <div className="flex items-center justify-center gap-1 mb-1">
            <Shield className="w-4 h-4" />
            <span className="font-medium">{character.armorClass}</span>
          </div>
          <div className="text-xs text-muted-foreground">Armor Class</div>
        </div>
      </div>

      {/* Ability Scores */}
      <div>
        <h4 className="font-medium mb-3">Ability Scores</h4>
        <div className="grid grid-cols-2 gap-3">
          {Object.entries(character.abilities).map(([ability, stats]) => (
            <div key={ability} className="text-center p-3 border rounded">
              <div className="text-xs font-medium capitalize mb-1">{ability.slice(0, 3)}</div>
              <div className="font-bold text-lg">{stats.modifier >= 0 ? '+' : ''}{stats.modifier}</div>
              <div className="text-xs text-muted-foreground">({stats.score})</div>
            </div>
          ))}
        </div>
      </div>

      {/* Quick Actions */}
      <div className="space-y-2">
        <h4 className="font-medium">Quick Actions</h4>
        <Button variant="outline" size="sm" className="w-full">Short Rest</Button>
        <Button variant="outline" size="sm" className="w-full">Long Rest</Button>
        <Button variant="outline" size="sm" className="w-full">Death Saves</Button>
      </div>
    </div>
  );
}

function InventoryPanel() {
  const currency = { platinum: 15, gold: 247, silver: 38, copper: 156 };
  const quickItems = [
    { name: "Healing Potion", quantity: 3 },
    { name: "Arrows", quantity: 47 },
    { name: "Rations", quantity: 7 },
    { name: "Rope (50ft)", quantity: 1 },
    { name: "Thieves' Tools", quantity: 1 }
  ];

  return (
    <div className="space-y-6">
      {/* Currency */}
      <div>
        <h4 className="font-medium mb-3">Currency</h4>
        <div className="grid grid-cols-2 gap-2">
          <div className="text-center p-2 border rounded">
            <div className="flex items-center justify-center gap-1">
              <Coins className="w-3 h-3 text-blue-600" />
              <span className="font-medium">{currency.platinum}</span>
            </div>
            <div className="text-xs text-muted-foreground">Platinum</div>
          </div>
          <div className="text-center p-2 border rounded">
            <div className="flex items-center justify-center gap-1">
              <Coins className="w-3 h-3 text-yellow-600" />
              <span className="font-medium">{currency.gold}</span>
            </div>
            <div className="text-xs text-muted-foreground">Gold</div>
          </div>
          <div className="text-center p-2 border rounded">
            <div className="flex items-center justify-center gap-1">
              <Coins className="w-3 h-3 text-gray-500" />
              <span className="font-medium">{currency.silver}</span>
            </div>
            <div className="text-xs text-muted-foreground">Silver</div>
          </div>
          <div className="text-center p-2 border rounded">
            <div className="flex items-center justify-center gap-1">
              <Coins className="w-3 h-3 text-amber-600" />
              <span className="font-medium">{currency.copper}</span>
            </div>
            <div className="text-xs text-muted-foreground">Copper</div>
          </div>
        </div>
      </div>

      {/* Quick Items */}
      <div>
        <h4 className="font-medium mb-3">Quick Items</h4>
        <div className="space-y-2">
          {quickItems.map((item, index) => (
            <div key={index} className="flex items-center justify-between p-2 border rounded">
              <span className="text-sm">{item.name}</span>
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="sm" className="h-6 w-6 p-0">
                  <Minus className="w-3 h-3" />
                </Button>
                <span className="w-8 text-center text-sm">{item.quantity}</span>
                <Button variant="ghost" size="sm" className="h-6 w-6 p-0">
                  <Plus className="w-3 h-3" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Equipment */}
      <div>
        <h4 className="font-medium mb-3">Equipped</h4>
        <div className="space-y-2">
          {[
            { name: "Longsword +1", type: "weapon" },
            { name: "Studded Leather", type: "armor" },
            { name: "Shield", type: "shield" },
            { name: "Longbow", type: "weapon" }
          ].map((item, index) => (
            <div key={index} className="flex items-center justify-between p-2 border rounded">
              <span className="text-sm">{item.name}</span>
              <Badge variant="outline" className="text-xs">{item.type}</Badge>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function SpellsPanel() {
  const spellSlots = {
    1: { used: 2, total: 4 },
    2: { used: 1, total: 3 },
    3: { used: 0, total: 2 },
    4: { used: 1, total: 1 }
  };

  const preparedSpells = [
    { name: "Hunter's Mark", level: 1 },
    { name: "Cure Wounds", level: 1 },
    { name: "Pass without Trace", level: 2 },
    { name: "Healing Spirit", level: 2 },
    { name: "Lightning Arrow", level: 3 },
    { name: "Freedom of Movement", level: 4 }
  ];

  return (
    <div className="space-y-6">
      {/* Spell Slots */}
      <div>
        <h4 className="font-medium mb-3">Spell Slots</h4>
        <div className="space-y-3">
          {Object.entries(spellSlots).map(([level, slots]) => (
            <div key={level}>
              <div className="flex justify-between items-center mb-1">
                <span className="text-sm font-medium">Level {level}</span>
                <span className="text-xs text-muted-foreground">
                  {slots.total - slots.used} / {slots.total}
                </span>
              </div>
              <div className="flex gap-1">
                {Array.from({ length: slots.total }, (_, i) => (
                  <div
                    key={i}
                    className={`w-4 h-4 rounded border ${
                      i < slots.used ? 'bg-muted' : 'bg-primary'
                    }`}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Prepared Spells */}
      <div>
        <h4 className="font-medium mb-3">Prepared Spells</h4>
        <div className="space-y-2">
          {preparedSpells.map((spell, index) => (
            <div key={index} className="flex items-center justify-between p-2 border rounded">
              <span className="text-sm">{spell.name}</span>
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="text-xs">L{spell.level}</Badge>
                <Button size="sm" variant="outline" className="h-6 px-2 text-xs">Cast</Button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function DicePanel() {
  const diceTypes = [
    { name: "d4", sides: 4 },
    { name: "d6", sides: 6 },
    { name: "d8", sides: 8 },
    { name: "d10", sides: 10 },
    { name: "d12", sides: 12 },
    { name: "d20", sides: 20 }
  ];

  const quickRolls = [
    { name: "Attack Roll", dice: "d20+6" },
    { name: "Damage", dice: "d8+3" },
    { name: "Initiative", dice: "d20+3" },
    { name: "Saving Throw", dice: "d20+4" }
  ];

  return (
    <div className="space-y-6">
      {/* Dice Grid */}
      <div>
        <h4 className="font-medium mb-3">Roll Dice</h4>
        <div className="grid grid-cols-3 gap-2">
          {diceTypes.map((dice) => (
            <Button
              key={dice.name}
              variant="outline"
              className="h-12 flex flex-col"
            >
              <Dice6 className="w-4 h-4" />
              <span className="text-sm">{dice.name}</span>
            </Button>
          ))}
        </div>
      </div>

      {/* Modifier */}
      <div>
        <h4 className="font-medium mb-3">Modifier</h4>
        <Input type="number" placeholder="Enter modifier" className="w-full" />
      </div>

      {/* Quick Rolls */}
      <div>
        <h4 className="font-medium mb-3">Quick Rolls</h4>
        <div className="space-y-2">
          {quickRolls.map((roll, index) => (
            <Button
              key={index}
              variant="outline"
              className="w-full justify-between"
            >
              <span className="text-sm">{roll.name}</span>
              <span className="text-xs text-muted-foreground">{roll.dice}</span>
            </Button>
          ))}
        </div>
      </div>

      {/* Last Roll Result */}
      <div className="p-3 bg-accent rounded">
        <div className="text-center">
          <div className="text-2xl font-bold">18</div>
          <div className="text-sm text-muted-foreground">d20: 15 + 3</div>
        </div>
      </div>
    </div>
  );
}

function CombatPanel() {
  const combatants = [
    { name: "Aragorn (You)", initiative: 18, isActive: true },
    { name: "Goblin Warrior", initiative: 15, isActive: false },
    { name: "Legolas", initiative: 14, isActive: false },
    { name: "Gimli", initiative: 8, isActive: false }
  ];

  return (
    <div className="space-y-6">
      {/* Round Counter */}
      <div className="text-center p-3 border rounded">
        <div className="text-xl font-bold">Round 3</div>
        <div className="text-sm text-muted-foreground">Current Turn: Aragorn</div>
      </div>

      {/* Initiative Order */}
      <div>
        <h4 className="font-medium mb-3">Initiative Order</h4>
        <div className="space-y-2">
          {combatants.map((combatant, index) => (
            <div
              key={index}
              className={`p-2 border rounded flex justify-between items-center ${
                combatant.isActive ? 'bg-primary/10 border-primary' : ''
              }`}
            >
              <span className="text-sm font-medium">{combatant.name}</span>
              <Badge variant={combatant.isActive ? "default" : "outline"}>
                {combatant.initiative}
              </Badge>
            </div>
          ))}
        </div>
      </div>

      {/* Combat Actions */}
      <div>
        <h4 className="font-medium mb-3">Quick Actions</h4>
        <div className="space-y-2">
          <Button variant="outline" size="sm" className="w-full">Next Turn</Button>
          <Button variant="outline" size="sm" className="w-full">Add Combatant</Button>
          <Button variant="outline" size="sm" className="w-full">End Combat</Button>
        </div>
      </div>
    </div>
  );
}

function ExplorationPanel() {
  const checks = [
    { name: "Navigation", dc: 15, skill: "Survival" },
    { name: "Perception", dc: 12, skill: "Perception" },
    { name: "Investigation", dc: 14, skill: "Investigation" },
    { name: "Stealth", dc: 13, skill: "Stealth" }
  ];

  return (
    <div className="space-y-6">
      {/* Environment */}
      <div>
        <h4 className="font-medium mb-3">Current Environment</h4>
        <div className="p-3 border rounded">
          <div className="text-sm">
            <div className="flex justify-between mb-1">
              <span>Terrain:</span>
              <span className="text-muted-foreground">Forest</span>
            </div>
            <div className="flex justify-between mb-1">
              <span>Weather:</span>
              <span className="text-muted-foreground">Clear</span>
            </div>
            <div className="flex justify-between">
              <span>Time:</span>
              <span className="text-muted-foreground">Afternoon</span>
            </div>
          </div>
        </div>
      </div>

      {/* Exploration Checks */}
      <div>
        <h4 className="font-medium mb-3">Exploration Checks</h4>
        <div className="space-y-2">
          {checks.map((check, index) => (
            <div key={index} className="p-2 border rounded">
              <div className="flex justify-between items-center mb-1">
                <span className="text-sm font-medium">{check.name}</span>
                <Badge variant="outline" className="text-xs">DC {check.dc}</Badge>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-xs text-muted-foreground">{check.skill}</span>
                <Button size="sm" variant="outline" className="h-6 px-2 text-xs">
                  Roll
                </Button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Rest Options */}
      <div>
        <h4 className="font-medium mb-3">Rest</h4>
        <div className="space-y-2">
          <Button variant="outline" size="sm" className="w-full">Short Rest (1 hour)</Button>
          <Button variant="outline" size="sm" className="w-full">Long Rest (8 hours)</Button>
        </div>
      </div>
    </div>
  );
}