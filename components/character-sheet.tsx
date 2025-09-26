import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Badge } from "./ui/badge";
import { Progress } from "./ui/progress";
import { Separator } from "./ui/separator";
import { getCharacter } from "../utils/api/characters";
import { Character } from "../utils/database/data-structures";

interface CharacterSheetProps {
  characterId?: string;
  refreshTrigger?: number;
  onInventoryChange?: () => void;
  onSpellcastingChange?: () => void;
}

export function CharacterSheet({ characterId, refreshTrigger }: CharacterSheetProps) {
  const [character, setCharacter] = useState<Character | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (characterId) {
      loadCharacter();
    } else {
      setLoading(false);
    }
  }, [characterId, refreshTrigger]);

  const loadCharacter = async () => {
    try {
      setLoading(true);
      setError(null);
      const char = await getCharacter(characterId!);
      if (char) {
        setCharacter(char);
      } else {
        setError('Character not found');
      }
    } catch (error) {
      console.error('Failed to load character:', error);
      setError('Failed to load character');
    } finally {
      setLoading(false);
    }
  };

  // Calculate ability modifier
  const getAbilityModifier = (score: number): number => {
    return Math.floor((score - 10) / 2);
  };

  // Calculate skill bonus (ability modifier + proficiency if proficient)
  const getSkillBonus = (skillName: string, abilityScore: number): number => {
    const modifier = getAbilityModifier(abilityScore);
    const proficiencyBonus = character?.proficiency_bonus || character?.proficiencyBonus || 2;
    
    // Check if character is proficient in this skill
    const skills = character?.skills || {};
    const isSkillProficient = skills[skillName] !== undefined;
    
    return isSkillProficient ? modifier + proficiencyBonus : modifier;
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <Card>
          <CardContent className="p-6">
            <div className="animate-pulse space-y-4">
              <div className="h-6 bg-muted rounded w-1/3"></div>
              <div className="h-4 bg-muted rounded w-1/2"></div>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (error || !character) {
    return (
      <div className="space-y-6">
        <Card>
          <CardContent className="p-6">
            <div className="text-center text-muted-foreground">
              {error || 'No character selected'}
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Transform database character data for display
  const abilities = character.abilities || {
    strength: 10,
    dexterity: 10,
    constitution: 10,
    intelligence: 10,
    wisdom: 10,
    charisma: 10
  };

  const hitPoints = character.hit_points || character.hitPoints || { current: 0, max: 0, temporary: 0 };
  const armorClass = character.armor_class || character.armorClass || 10;
  const proficiencyBonus = character.proficiency_bonus || character.proficiencyBonus || 2;

  // Calculate initiative (dexterity modifier)
  const initiative = getAbilityModifier(abilities.dexterity);

  // Transform abilities for display
  const displayAbilities = Object.entries(abilities).map(([name, score]) => {
    const modifier = getAbilityModifier(score);
    const savingThrowBonus = character.saving_throws?.[name] ? modifier + proficiencyBonus : modifier;
    
    return [name, {
      score,
      modifier,
      savingThrow: savingThrowBonus
    }];
  }).reduce((acc, [name, data]) => ({ ...acc, [name]: data }), {});

  // Common D&D skills mapped to abilities
  const skillList = [
    { name: "Acrobatics", ability: "dexterity" },
    { name: "Animal Handling", ability: "wisdom" },
    { name: "Arcana", ability: "intelligence" },
    { name: "Athletics", ability: "strength" },
    { name: "Deception", ability: "charisma" },
    { name: "History", ability: "intelligence" },
    { name: "Insight", ability: "wisdom" },
    { name: "Intimidation", ability: "charisma" },
    { name: "Investigation", ability: "intelligence" },
    { name: "Medicine", ability: "wisdom" },
    { name: "Nature", ability: "intelligence" },
    { name: "Perception", ability: "wisdom" },
    { name: "Performance", ability: "charisma" },
    { name: "Persuasion", ability: "charisma" },
    { name: "Religion", ability: "intelligence" },
    { name: "Sleight of Hand", ability: "dexterity" },
    { name: "Stealth", ability: "dexterity" },
    { name: "Survival", ability: "wisdom" }
  ];

  // Calculate skill bonuses
  const displaySkills = skillList.reduce((acc, skill) => {
    const abilityScore = abilities[skill.ability];
    const bonus = getSkillBonus(skill.name, abilityScore);
    return { ...acc, [skill.name]: bonus };
  }, {});

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
                {character.background}
              </p>
            </div>
            <Badge variant="outline">Level {character.level}</Badge>
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
                <span>{hitPoints.current}/{hitPoints.max}</span>
              </div>
              <Progress value={hitPoints.max > 0 ? (hitPoints.current / hitPoints.max) * 100 : 0} />
              {hitPoints.temporary > 0 && (
                <div className="text-xs text-blue-600">
                  +{hitPoints.temporary} temporary HP
                </div>
              )}
            </div>
            
            <div className="grid grid-cols-2 gap-4 text-center">
              <div className="p-3 border rounded">
                <div className="text-2xl font-bold">{armorClass}</div>
                <div className="text-sm text-muted-foreground">Armor Class</div>
              </div>
              <div className="p-3 border rounded">
                <div className="text-2xl font-bold">{initiative >= 0 ? '+' : ''}{initiative}</div>
                <div className="text-sm text-muted-foreground">Initiative</div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4 text-center">
              <div className="p-3 border rounded">
                <div className="text-2xl font-bold">{character.speed} ft</div>
                <div className="text-sm text-muted-foreground">Speed</div>
              </div>
              <div className="p-3 border rounded">
                <div className="text-2xl font-bold">+{proficiencyBonus}</div>
                <div className="text-sm text-muted-foreground">Proficiency</div>
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
              {Object.entries(displayAbilities).map(([ability, stats]) => (
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
              {Object.entries(displaySkills).map(([skill, bonus]) => (
                <div key={skill} className="flex justify-between items-center">
                  <span className="text-sm">{skill}</span>
                  <Badge variant="secondary">{bonus >= 0 ? '+' : ''}{bonus}</Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Character Details */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Character Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {character.backstory && (
              <>
                <div>
                  <h4 className="font-medium">Backstory</h4>
                  <p className="text-sm text-muted-foreground">{character.backstory}</p>
                </div>
                <Separator />
              </>
            )}
            {character.personality && (
              <>
                <div>
                  <h4 className="font-medium">Personality</h4>
                  <p className="text-sm text-muted-foreground">{character.personality}</p>
                </div>
                <Separator />
              </>
            )}
            {character.ideals && (
              <>
                <div>
                  <h4 className="font-medium">Ideals</h4>
                  <p className="text-sm text-muted-foreground">{character.ideals}</p>
                </div>
                <Separator />
              </>
            )}
            {character.bonds && (
              <>
                <div>
                  <h4 className="font-medium">Bonds</h4>
                  <p className="text-sm text-muted-foreground">{character.bonds}</p>
                </div>
                <Separator />
              </>
            )}
            {character.flaws && (
              <div>
                <h4 className="font-medium">Flaws</h4>
                <p className="text-sm text-muted-foreground">{character.flaws}</p>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Equipment & Inventory</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {character.equipment && Object.keys(character.equipment).length > 0 ? (
              <div>
                <h4 className="font-medium">Equipped Items</h4>
                <div className="text-sm text-muted-foreground">
                  {/* Display equipment would need to be properly formatted */}
                  Equipment system connected
                </div>
              </div>
            ) : (
              <div className="text-sm text-muted-foreground">No equipment data available</div>
            )}
            <Separator />
            {character.inventory && Array.isArray(character.inventory) && character.inventory.length > 0 ? (
              <div>
                <h4 className="font-medium">Inventory</h4>
                <div className="text-sm text-muted-foreground">
                  {character.inventory.length} items
                </div>
              </div>
            ) : (
              <div className="text-sm text-muted-foreground">No inventory data available</div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
