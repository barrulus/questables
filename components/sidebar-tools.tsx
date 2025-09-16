import { useState } from "react";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "./ui/accordion";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Progress } from "./ui/progress";
import { Input } from "./ui/input";
import { Separator } from "./ui/separator";
import { ScrollArea } from "./ui/scroll-area";
import { 
  User, 
  Package, 
  Dice6, 
  BookOpen, 
  Sword,
  Heart,
  Coins,
  Zap,
  Shield,
  Plus,
  Minus
} from "lucide-react";

export function SidebarTools() {
  // Character data (condensed version)
  const character = {
    name: "Aragorn Strider",
    class: "Ranger",
    level: 8,
    hitPoints: { current: 72, maximum: 72 },
    armorClass: 16,
    abilities: {
      strength: { modifier: 3 },
      dexterity: { modifier: 3 },
      constitution: { modifier: 2 },
      intelligence: { modifier: 1 },
      wisdom: { modifier: 4 },
      charisma: { modifier: 0 }
    }
  };

  // Dice rolling
  const [lastRoll, setLastRoll] = useState<{ result: number; total: number; dice: string } | null>(null);

  const rollDice = (sides: number, diceName: string) => {
    const result = Math.floor(Math.random() * sides) + 1;
    const modifier = 3; // Example modifier
    const total = result + modifier;
    setLastRoll({ result, total, dice: diceName });
  };

  // Spell slots
  const spellSlots = {
    1: { used: 2, total: 4 },
    2: { used: 1, total: 3 },
    3: { used: 0, total: 2 },
    4: { used: 1, total: 1 }
  };

  // Quick inventory
  const quickItems = [
    { name: "Healing Potion", quantity: 3 },
    { name: "Arrows", quantity: 47 },
    { name: "Rations", quantity: 7 },
    { name: "Rope (50ft)", quantity: 1 }
  ];

  const currency = { gold: 247, silver: 38, copper: 156 };

  return (
    <div className="w-80 border-r bg-card">
      <div className="p-4 border-b">
        <h2 className="font-semibold">Character Tools</h2>
        <p className="text-sm text-muted-foreground">{character.name}</p>
      </div>

      <ScrollArea className="h-[calc(100vh-120px)]">
        <Accordion type="multiple" defaultValue={["character", "dice"]} className="p-4">
          {/* Character Sheet */}
          <AccordionItem value="character">
            <AccordionTrigger className="hover:no-underline">
              <div className="flex items-center gap-2">
                <User className="w-4 h-4" />
                Character
              </div>
            </AccordionTrigger>
            <AccordionContent className="space-y-4">
              {/* HP and AC */}
              <div className="grid grid-cols-2 gap-3">
                <div className="text-center p-3 border rounded">
                  <div className="flex items-center justify-center gap-1">
                    <Heart className="w-4 h-4 text-red-500" />
                    <span className="font-medium">
                      {character.hitPoints.current}/{character.hitPoints.maximum}
                    </span>
                  </div>
                  <div className="text-xs text-muted-foreground">Hit Points</div>
                  <Progress 
                    value={(character.hitPoints.current / character.hitPoints.maximum) * 100} 
                    className="h-2 mt-1"
                  />
                </div>
                <div className="text-center p-3 border rounded">
                  <div className="flex items-center justify-center gap-1">
                    <Shield className="w-4 h-4" />
                    <span className="font-medium">{character.armorClass}</span>
                  </div>
                  <div className="text-xs text-muted-foreground">Armor Class</div>
                </div>
              </div>

              {/* Ability Scores */}
              <div>
                <h4 className="font-medium mb-2">Ability Scores</h4>
                <div className="grid grid-cols-3 gap-2">
                  {Object.entries(character.abilities).map(([ability, stats]) => (
                    <div key={ability} className="text-center p-2 border rounded">
                      <div className="text-xs font-medium capitalize">{ability.slice(0, 3)}</div>
                      <div className="font-bold">{stats.modifier >= 0 ? '+' : ''}{stats.modifier}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Quick Actions */}
              <div className="space-y-2">
                <Button variant="outline" size="sm" className="w-full">
                  Short Rest
                </Button>
                <Button variant="outline" size="sm" className="w-full">
                  Long Rest
                </Button>
              </div>
            </AccordionContent>
          </AccordionItem>

          {/* Dice Roller */}
          <AccordionItem value="dice">
            <AccordionTrigger className="hover:no-underline">
              <div className="flex items-center gap-2">
                <Dice6 className="w-4 h-4" />
                Dice Roller
              </div>
            </AccordionTrigger>
            <AccordionContent className="space-y-4">
              {/* Last Roll */}
              {lastRoll && (
                <div className="p-3 bg-accent rounded">
                  <div className="text-center">
                    <div className="text-2xl font-bold">{lastRoll.total}</div>
                    <div className="text-sm text-muted-foreground">
                      {lastRoll.dice}: {lastRoll.result} + 3
                    </div>
                  </div>
                </div>
              )}

              {/* Dice Grid */}
              <div className="grid grid-cols-4 gap-2">
                {[
                  { name: "d4", sides: 4 },
                  { name: "d6", sides: 6 },
                  { name: "d8", sides: 8 },
                  { name: "d10", sides: 10 },
                  { name: "d12", sides: 12 },
                  { name: "d20", sides: 20 }
                ].map((dice) => (
                  <Button
                    key={dice.name}
                    variant="outline"
                    size="sm"
                    onClick={() => rollDice(dice.sides, dice.name)}
                    className="h-12"
                  >
                    {dice.name}
                  </Button>
                ))}
              </div>

              {/* Quick Rolls */}
              <div className="space-y-1">
                <h5 className="font-medium text-sm">Quick Rolls</h5>
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full justify-between"
                  onClick={() => rollDice(20, "d20")}
                >
                  <span>Attack Roll</span>
                  <span className="text-xs">d20+6</span>
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full justify-between"
                  onClick={() => rollDice(8, "d8")}
                >
                  <span>Damage</span>
                  <span className="text-xs">d8+3</span>
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full justify-between"
                  onClick={() => rollDice(20, "d20")}
                >
                  <span>Initiative</span>
                  <span className="text-xs">d20+3</span>
                </Button>
              </div>
            </AccordionContent>
          </AccordionItem>

          {/* Spells */}
          <AccordionItem value="spells">
            <AccordionTrigger className="hover:no-underline">
              <div className="flex items-center gap-2">
                <BookOpen className="w-4 h-4" />
                Spells
              </div>
            </AccordionTrigger>
            <AccordionContent className="space-y-4">
              {/* Spell Slots */}
              <div>
                <h5 className="font-medium text-sm mb-2">Spell Slots</h5>
                <div className="space-y-2">
                  {Object.entries(spellSlots).map(([level, slots]) => (
                    <div key={level} className="flex items-center justify-between">
                      <span className="text-sm">Level {level}</span>
                      <div className="flex items-center gap-1">
                        {Array.from({ length: slots.total }, (_, i) => (
                          <div
                            key={i}
                            className={`w-2 h-2 rounded-full border ${
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
                <h5 className="font-medium text-sm mb-2">Prepared Spells</h5>
                <div className="space-y-1">
                  {[
                    { name: "Hunter's Mark", level: 1 },
                    { name: "Cure Wounds", level: 1 },
                    { name: "Pass without Trace", level: 2 },
                    { name: "Lightning Arrow", level: 3 }
                  ].map((spell, index) => (
                    <Button
                      key={index}
                      variant="ghost"
                      size="sm"
                      className="w-full justify-between"
                    >
                      <span className="text-sm">{spell.name}</span>
                      <Badge variant="outline" className="text-xs">
                        {spell.level}
                      </Badge>
                    </Button>
                  ))}
                </div>
              </div>
            </AccordionContent>
          </AccordionItem>

          {/* Inventory */}
          <AccordionItem value="inventory">
            <AccordionTrigger className="hover:no-underline">
              <div className="flex items-center gap-2">
                <Package className="w-4 h-4" />
                Inventory
              </div>
            </AccordionTrigger>
            <AccordionContent className="space-y-4">
              {/* Currency */}
              <div>
                <h5 className="font-medium text-sm mb-2">Currency</h5>
                <div className="flex items-center gap-3 text-sm">
                  <div className="flex items-center gap-1">
                    <Coins className="w-3 h-3 text-yellow-600" />
                    <span>{currency.gold}g</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <Coins className="w-3 h-3 text-gray-500" />
                    <span>{currency.silver}s</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <Coins className="w-3 h-3 text-amber-600" />
                    <span>{currency.copper}c</span>
                  </div>
                </div>
              </div>

              {/* Quick Items */}
              <div>
                <h5 className="font-medium text-sm mb-2">Quick Items</h5>
                <div className="space-y-1">
                  {quickItems.map((item, index) => (
                    <div key={index} className="flex items-center justify-between text-sm">
                      <span>{item.name}</span>
                      <div className="flex items-center gap-1">
                        <Button variant="ghost" size="sm" className="h-6 w-6 p-0">
                          <Minus className="w-3 h-3" />
                        </Button>
                        <span className="w-6 text-center">{item.quantity}</span>
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
                <h5 className="font-medium text-sm mb-2">Equipped</h5>
                <div className="space-y-1 text-sm">
                  <div className="flex items-center gap-2">
                    <Sword className="w-3 h-3" />
                    <span>Longsword +1</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Shield className="w-3 h-3" />
                    <span>Studded Leather</span>
                  </div>
                </div>
              </div>
            </AccordionContent>
          </AccordionItem>

          {/* Combat Tracker */}
          <AccordionItem value="combat">
            <AccordionTrigger className="hover:no-underline">
              <div className="flex items-center gap-2">
                <Sword className="w-4 h-4" />
                Combat
              </div>
            </AccordionTrigger>
            <AccordionContent className="space-y-4">
              <div className="p-3 border rounded">
                <div className="flex justify-between items-center mb-2">
                  <span className="font-medium">Round 3</span>
                  <Badge variant="secondary">Your Turn</Badge>
                </div>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span>Aragorn (You)</span>
                    <span>18</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Goblin Warrior</span>
                    <span>15</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Legolas</span>
                    <span>14</span>
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <Button variant="outline" size="sm" className="w-full">
                  Next Turn
                </Button>
                <Button variant="outline" size="sm" className="w-full">
                  Add Combatant
                </Button>
              </div>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </ScrollArea>
    </div>
  );
}