import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { Input } from "./ui/input";
import { Separator } from "./ui/separator";
import { Dice1, Dice2, Dice3, Dice4, Dice5, Dice6, RotateCcw } from "lucide-react";

interface DiceRoll {
  id: number;
  dice: string;
  result: number[];
  total: number;
  modifier: number;
  timestamp: Date;
  description?: string;
}

export function DiceRoller() {
  const [rolls, setRolls] = useState<DiceRoll[]>([]);
  const [modifier, setModifier] = useState(0);
  const [description, setDescription] = useState("");

  const diceTypes = [
    { name: "d4", sides: 4 },
    { name: "d6", sides: 6 },
    { name: "d8", sides: 8 },
    { name: "d10", sides: 10 },
    { name: "d12", sides: 12 },
    { name: "d20", sides: 20 },
    { name: "d100", sides: 100 }
  ];

  const rollDice = (sides: number, count: number = 1, diceName: string) => {
    const results = [];
    for (let i = 0; i < count; i++) {
      results.push(Math.floor(Math.random() * sides) + 1);
    }
    
    const total = results.reduce((sum, roll) => sum + roll, 0) + modifier;
    
    const newRoll: DiceRoll = {
      id: Date.now(),
      dice: count > 1 ? `${count}${diceName}` : diceName,
      result: results,
      total,
      modifier,
      timestamp: new Date(),
      description: description || undefined
    };

    setRolls(prev => [newRoll, ...prev.slice(0, 9)]); // Keep last 10 rolls
  };

  const quickRolls = [
    { name: "Attack Roll", dice: "d20", mod: 6 },
    { name: "Damage", dice: "d8", mod: 3 },
    { name: "Healing Potion", dice: "2d4", mod: 2 },
    { name: "Initiative", dice: "d20", mod: 3 },
    { name: "Saving Throw", dice: "d20", mod: 4 },
  ];

  const getDiceIcon = (result: number) => {
    switch (result) {
      case 1: return <Dice1 className="w-4 h-4" />;
      case 2: return <Dice2 className="w-4 h-4" />;
      case 3: return <Dice3 className="w-4 h-4" />;
      case 4: return <Dice4 className="w-4 h-4" />;
      case 5: return <Dice5 className="w-4 h-4" />;
      case 6: return <Dice6 className="w-4 h-4" />;
      default: return <span className="w-4 h-4 flex items-center justify-center text-xs font-bold border rounded">{result}</span>;
    }
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Dice Roller */}
        <Card>
          <CardHeader>
            <CardTitle>Dice Roller</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-4 gap-2">
              {diceTypes.map((dice) => (
                <Button
                  key={dice.name}
                  variant="outline"
                  onClick={() => rollDice(dice.sides, 1, dice.name)}
                  className="h-16 flex flex-col"
                >
                  <span className="text-lg font-bold">{dice.name}</span>
                </Button>
              ))}
              <Button
                variant="outline"
                onClick={() => rollDice(6, 2, "d6")}
                className="h-16 flex flex-col"
              >
                <span className="text-lg font-bold">2d6</span>
              </Button>
            </div>

            <Separator />

            <div className="space-y-2">
              <div className="flex gap-2">
                <Input
                  type="number"
                  placeholder="Modifier"
                  value={modifier || ""}
                  onChange={(e) => setModifier(parseInt(e.target.value) || 0)}
                  className="w-24"
                />
                <Input
                  placeholder="Description (optional)"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="flex-1"
                />
              </div>
            </div>

            <Separator />

            <div>
              <h4 className="font-medium mb-2">Quick Rolls</h4>
              <div className="grid grid-cols-1 gap-2">
                {quickRolls.map((roll, index) => (
                  <Button
                    key={index}
                    variant="ghost"
                    onClick={() => {
                      const count = roll.dice.includes("2d") ? 2 : 1;
                      const diceName = roll.dice.replace("2", "");
                      const sides = parseInt(diceName.substring(1));
                      setModifier(roll.mod);
                      setDescription(roll.name);
                      rollDice(sides, count, diceName);
                    }}
                    className="justify-between"
                  >
                    <span>{roll.name}</span>
                    <span className="text-muted-foreground">{roll.dice}+{roll.mod}</span>
                  </Button>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Roll History */}
        <Card>
          <CardHeader>
            <div className="flex justify-between items-center">
              <CardTitle>Roll History</CardTitle>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setRolls([])}
              >
                <RotateCcw className="w-4 h-4" />
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-3 max-h-96 overflow-y-auto">
              {rolls.length === 0 ? (
                <p className="text-muted-foreground text-center py-8">No rolls yet</p>
              ) : (
                rolls.map((roll) => (
                  <div key={roll.id} className="p-3 border rounded space-y-2">
                    <div className="flex justify-between items-start">
                      <div>
                        {roll.description && (
                          <p className="font-medium text-sm">{roll.description}</p>
                        )}
                        <div className="flex items-center gap-2">
                          <Badge variant="outline">{roll.dice}</Badge>
                          {roll.modifier !== 0 && (
                            <Badge variant="secondary">
                              {roll.modifier > 0 ? "+" : ""}{roll.modifier}
                            </Badge>
                          )}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-2xl font-bold">{roll.total}</div>
                        <div className="text-xs text-muted-foreground">
                          {roll.timestamp.toLocaleTimeString()}
                        </div>
                      </div>
                    </div>
                    
                    <div className="flex items-center gap-1">
                      <span className="text-sm text-muted-foreground">Rolled:</span>
                      {roll.result.map((result, index) => (
                        <div key={index} className="flex items-center gap-1">
                          {getDiceIcon(result)}
                          <span className="text-sm">{result}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}