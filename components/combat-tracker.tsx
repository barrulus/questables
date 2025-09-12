import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Badge } from "./ui/badge";
import { Progress } from "./ui/progress";
import { Separator } from "./ui/separator";
import { Avatar, AvatarFallback } from "./ui/avatar";
import { Sword, Shield, Heart, Zap, Plus, Minus, RotateCcw } from "lucide-react";

interface Combatant {
  id: number;
  name: string;
  initiative: number;
  hitPoints: { current: number; max: number };
  armorClass: number;
  conditions: string[];
  isPlayer: boolean;
  isActive: boolean;
}

interface Condition {
  name: string;
  description: string;
  color: string;
}

export function CombatTracker() {
  const [combatants, setCombatants] = useState<Combatant[]>([
    {
      id: 1,
      name: "Aragorn",
      initiative: 18,
      hitPoints: { current: 72, max: 72 },
      armorClass: 16,
      conditions: [],
      isPlayer: true,
      isActive: true
    },
    {
      id: 2,
      name: "Goblin Warrior",
      initiative: 15,
      hitPoints: { current: 7, max: 7 },
      armorClass: 13,
      conditions: [],
      isPlayer: false,
      isActive: false
    },
    {
      id: 3,
      name: "Legolas",
      initiative: 14,
      hitPoints: { current: 58, max: 58 },
      armorClass: 15,
      conditions: ["Blessed"],
      isPlayer: true,
      isActive: false
    },
    {
      id: 4,
      name: "Goblin Archer",
      initiative: 12,
      hitPoints: { current: 0, max: 7 },
      armorClass: 14,
      conditions: ["Unconscious"],
      isPlayer: false,
      isActive: false
    },
    {
      id: 5,
      name: "Gimli",
      initiative: 8,
      hitPoints: { current: 45, max: 68 },
      armorClass: 18,
      conditions: ["Poisoned"],
      isPlayer: true,
      isActive: false
    }
  ]);

  const [round, setRound] = useState(3);
  const [newCombatantName, setNewCombatantName] = useState("");
  const [newInitiative, setNewInitiative] = useState("");

  const conditions: Condition[] = [
    { name: "Blessed", description: "+1d4 to attacks and saves", color: "bg-blue-500" },
    { name: "Poisoned", description: "Disadvantage on attacks and ability checks", color: "bg-green-500" },
    { name: "Unconscious", description: "Incapacitated and prone", color: "bg-red-500" },
    { name: "Prone", description: "Disadvantage on attacks", color: "bg-yellow-500" },
    { name: "Blinded", description: "Cannot see, attacks have disadvantage", color: "bg-gray-500" },
    { name: "Stunned", description: "Incapacitated, cannot move", color: "bg-purple-500" }
  ];

  const sortedCombatants = [...combatants].sort((a, b) => b.initiative - a.initiative);

  const nextTurn = () => {
    const currentIndex = sortedCombatants.findIndex(c => c.isActive);
    const nextIndex = (currentIndex + 1) % sortedCombatants.length;
    
    setCombatants(prev => prev.map(c => ({
      ...c,
      isActive: c.id === sortedCombatants[nextIndex].id
    })));

    if (nextIndex === 0) {
      setRound(prev => prev + 1);
    }
  };

  const updateHitPoints = (id: number, change: number) => {
    setCombatants(prev => prev.map(c => {
      if (c.id === id) {
        const newCurrent = Math.max(0, Math.min(c.hitPoints.max, c.hitPoints.current + change));
        return {
          ...c,
          hitPoints: { ...c.hitPoints, current: newCurrent }
        };
      }
      return c;
    }));
  };

  const toggleCondition = (combatantId: number, condition: string) => {
    setCombatants(prev => prev.map(c => {
      if (c.id === combatantId) {
        const hasCondition = c.conditions.includes(condition);
        return {
          ...c,
          conditions: hasCondition 
            ? c.conditions.filter(cond => cond !== condition)
            : [...c.conditions, condition]
        };
      }
      return c;
    }));
  };

  const addCombatant = () => {
    if (!newCombatantName.trim() || !newInitiative) return;

    const newCombatant: Combatant = {
      id: Date.now(),
      name: newCombatantName.trim(),
      initiative: parseInt(newInitiative),
      hitPoints: { current: 10, max: 10 },
      armorClass: 10,
      conditions: [],
      isPlayer: false,
      isActive: false
    };

    setCombatants(prev => [...prev, newCombatant]);
    setNewCombatantName("");
    setNewInitiative("");
  };

  const removeCombatant = (id: number) => {
    setCombatants(prev => prev.filter(c => c.id !== id));
  };

  return (
    <div className="space-y-6">
      {/* Combat Controls */}
      <Card>
        <CardHeader>
          <div className="flex justify-between items-center">
            <CardTitle className="flex items-center gap-2">
              <Sword className="w-5 h-5" />
              Combat Tracker
            </CardTitle>
            <div className="flex items-center gap-4">
              <Badge variant="outline" className="text-lg px-3 py-1">
                Round {round}
              </Badge>
              <Button onClick={nextTurn}>
                Next Turn
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex gap-2">
            <Input
              placeholder="Combatant name"
              value={newCombatantName}
              onChange={(e) => setNewCombatantName(e.target.value)}
              className="flex-1"
            />
            <Input
              type="number"
              placeholder="Init"
              value={newInitiative}
              onChange={(e) => setNewInitiative(e.target.value)}
              className="w-20"
            />
            <Button onClick={addCombatant}>
              <Plus className="w-4 h-4" />
            </Button>
            <Button variant="outline" onClick={() => setRound(1)}>
              <RotateCcw className="w-4 h-4" />
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Initiative Order */}
      <Card>
        <CardHeader>
          <CardTitle>Initiative Order</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {sortedCombatants.map((combatant, index) => (
              <div
                key={combatant.id}
                className={`p-4 border rounded-lg ${
                  combatant.isActive ? 'ring-2 ring-primary bg-accent' : ''
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="text-2xl font-bold text-muted-foreground">
                      {index + 1}
                    </div>
                    <Avatar>
                      <AvatarFallback className={combatant.isPlayer ? 'bg-blue-100' : 'bg-red-100'}>
                        {combatant.name.slice(0, 2)}
                      </AvatarFallback>
                    </Avatar>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{combatant.name}</span>
                        {combatant.isPlayer && <Badge variant="secondary">Player</Badge>}
                      </div>
                      <div className="text-sm text-muted-foreground">
                        Initiative: {combatant.initiative} • AC: {combatant.armorClass}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-4">
                    {/* Hit Points */}
                    <div className="flex items-center gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => updateHitPoints(combatant.id, -1)}
                      >
                        <Minus className="w-4 h-4" />
                      </Button>
                      
                      <div className="text-center min-w-16">
                        <div className="flex items-center gap-1">
                          <Heart className="w-4 h-4" />
                          <span className="font-medium">
                            {combatant.hitPoints.current}/{combatant.hitPoints.max}
                          </span>
                        </div>
                        <Progress 
                          value={(combatant.hitPoints.current / combatant.hitPoints.max) * 100}
                          className="h-2 w-16"
                        />
                      </div>

                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => updateHitPoints(combatant.id, 1)}
                      >
                        <Plus className="w-4 h-4" />
                      </Button>
                    </div>

                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => removeCombatant(combatant.id)}
                    >
                      Remove
                    </Button>
                  </div>
                </div>

                {/* Conditions */}
                {combatant.conditions.length > 0 && (
                  <div className="flex gap-1 mt-2">
                    {combatant.conditions.map((condition, idx) => {
                      const conditionData = conditions.find(c => c.name === condition);
                      return (
                        <Badge
                          key={idx}
                          variant="secondary"
                          className="text-xs cursor-pointer"
                          onClick={() => toggleCondition(combatant.id, condition)}
                        >
                          {condition}
                        </Badge>
                      );
                    })}
                  </div>
                )}

                {/* Add Condition */}
                <div className="flex gap-1 mt-2">
                  {conditions.map((condition) => (
                    <Button
                      key={condition.name}
                      variant="ghost"
                      size="sm"
                      className="h-6 px-2 text-xs"
                      onClick={() => toggleCondition(combatant.id, condition.name)}
                    >
                      +{condition.name}
                    </Button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Quick Actions */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Quick Damage</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="grid grid-cols-3 gap-2">
              <Button variant="outline" size="sm">1d4</Button>
              <Button variant="outline" size="sm">1d6</Button>
              <Button variant="outline" size="sm">1d8</Button>
              <Button variant="outline" size="sm">1d10</Button>
              <Button variant="outline" size="sm">1d12</Button>
              <Button variant="outline" size="sm">2d6</Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Status Effects</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="grid grid-cols-2 gap-1">
              {conditions.slice(0, 6).map((condition) => (
                <Badge key={condition.name} variant="outline" className="text-xs justify-center">
                  {condition.name}
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Combat Stats</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="text-sm space-y-1">
              <div className="flex justify-between">
                <span>Active Combatants:</span>
                <span>{combatants.filter(c => c.hitPoints.current > 0).length}</span>
              </div>
              <div className="flex justify-between">
                <span>Players:</span>
                <span>{combatants.filter(c => c.isPlayer).length}</span>
              </div>
              <div className="flex justify-between">
                <span>Enemies:</span>
                <span>{combatants.filter(c => !c.isPlayer).length}</span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}