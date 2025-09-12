import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Badge } from "./ui/badge";
import { Progress } from "./ui/progress";
import { Separator } from "./ui/separator";

export function CharacterSheet() {
  const character = {
    name: "Aragorn Strider",
    class: "Ranger",
    level: 8,
    race: "Human",
    background: "Outlander",
    alignment: "Chaotic Good",
    experiencePoints: 34000,
    proficiencyBonus: 3,
    hitPoints: { current: 72, maximum: 72, temporary: 0 },
    hitDice: "8d10",
    armorClass: 16,
    initiative: 3,
    speed: 30,
    abilities: {
      strength: { score: 16, modifier: 3, savingThrow: 3 },
      dexterity: { score: 17, modifier: 3, savingThrow: 6 },
      constitution: { score: 14, modifier: 2, savingThrow: 2 },
      intelligence: { score: 12, modifier: 1, savingThrow: 1 },
      wisdom: { score: 18, modifier: 4, savingThrow: 7 },
      charisma: { score: 10, modifier: 0, savingThrow: 0 }
    },
    skills: {
      "Animal Handling": 7,
      "Athletics": 6,
      "Insight": 7,
      "Investigation": 4,
      "Nature": 7,
      "Perception": 7,
      "Stealth": 6,
      "Survival": 10
    }
  };

  return (
    <div className="space-y-6">
      {/* Character Info Header */}
      <Card>
        <CardHeader>
          <div className="flex justify-between items-start">
            <div>
              <CardTitle className="text-2xl">{character.name}</CardTitle>
              <p className="text-muted-foreground">
                Level {character.level} {character.race} {character.class}
              </p>
              <p className="text-sm text-muted-foreground">
                {character.background} • {character.alignment}
              </p>
            </div>
            <Badge variant="outline">XP: {character.experiencePoints.toLocaleString()}</Badge>
          </div>
        </CardHeader>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Combat Stats */}
        <Card>
          <CardHeader>
            <CardTitle>Combat Stats</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <div className="flex justify-between">
                <span>Hit Points</span>
                <span>{character.hitPoints.current}/{character.hitPoints.maximum}</span>
              </div>
              <Progress value={(character.hitPoints.current / character.hitPoints.maximum) * 100} />
            </div>
            
            <div className="grid grid-cols-2 gap-4 text-center">
              <div className="p-3 border rounded">
                <div className="text-2xl font-bold">{character.armorClass}</div>
                <div className="text-sm text-muted-foreground">Armor Class</div>
              </div>
              <div className="p-3 border rounded">
                <div className="text-2xl font-bold">+{character.initiative}</div>
                <div className="text-sm text-muted-foreground">Initiative</div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4 text-center">
              <div className="p-3 border rounded">
                <div className="text-2xl font-bold">{character.speed} ft</div>
                <div className="text-sm text-muted-foreground">Speed</div>
              </div>
              <div className="p-3 border rounded">
                <div className="text-2xl font-bold">{character.hitDice}</div>
                <div className="text-sm text-muted-foreground">Hit Dice</div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Ability Scores */}
        <Card>
          <CardHeader>
            <CardTitle>Ability Scores</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-3">
              {Object.entries(character.abilities).map(([ability, stats]) => (
                <div key={ability} className="text-center p-3 border rounded">
                  <div className="text-sm font-medium capitalize mb-1">{ability.slice(0, 3)}</div>
                  <div className="text-2xl font-bold">{stats.modifier >= 0 ? '+' : ''}{stats.modifier}</div>
                  <div className="text-xs text-muted-foreground">{stats.score}</div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Skills */}
        <Card>
          <CardHeader>
            <CardTitle>Skills</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {Object.entries(character.skills).map(([skill, bonus]) => (
                <div key={skill} className="flex justify-between items-center">
                  <span className="text-sm">{skill}</span>
                  <Badge variant="secondary">+{bonus}</Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Proficiencies & Features */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Proficiencies</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <h4 className="font-medium">Armor</h4>
              <p className="text-sm text-muted-foreground">Light armor, medium armor, shields</p>
            </div>
            <Separator />
            <div>
              <h4 className="font-medium">Weapons</h4>
              <p className="text-sm text-muted-foreground">Simple weapons, martial weapons</p>
            </div>
            <Separator />
            <div>
              <h4 className="font-medium">Languages</h4>
              <p className="text-sm text-muted-foreground">Common, Elvish, Orc</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Features & Traits</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <h4 className="font-medium">Favored Enemy</h4>
              <p className="text-sm text-muted-foreground">Orcs, Undead</p>
            </div>
            <Separator />
            <div>
              <h4 className="font-medium">Natural Explorer</h4>
              <p className="text-sm text-muted-foreground">Forest, Mountains</p>
            </div>
            <Separator />
            <div>
              <h4 className="font-medium">Hunter's Mark</h4>
              <p className="text-sm text-muted-foreground">Mark a creature for additional damage</p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}