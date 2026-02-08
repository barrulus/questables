import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Progress } from "./ui/progress";
import { Separator } from "./ui/separator";
import { getCharacter } from "../utils/api/characters";
import { Character } from "../utils/database/data-structures";

type AbilityKey = keyof Character["abilities"];

const ABILITY_KEYS: AbilityKey[] = [
  "strength",
  "dexterity",
  "constitution",
  "intelligence",
  "wisdom",
  "charisma",
];

const SKILL_DEFINITIONS = [
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
  { name: "Survival", ability: "wisdom" },
] as const satisfies ReadonlyArray<{ name: string; ability: AbilityKey }>;

type AbilitySummary = {
  ability: AbilityKey;
  score: number;
  modifier: number;
  savingThrow: number;
};

type SkillSummary = {
  name: string;
  bonus: number;
};

const sanitizeAbilities = (
  value: Character["abilities"] | null | undefined,
): Record<AbilityKey, number> | null => {
  if (!value) {
    return null;
  }

  const normalized = {} as Record<AbilityKey, number>;
  for (const key of ABILITY_KEYS) {
    const stat = value[key];
    if (typeof stat !== "number" || Number.isNaN(stat)) {
      return null;
    }
    normalized[key] = stat;
  }

  return normalized;
};

const normalizeHitPoints = (
  value: Character["hit_points"] | Character["hitPoints"] | null | undefined,
): { current: number; max: number; temporary: number } | null => {
  if (!value) {
    return null;
  }

  const { current, max, temporary } = value;

  if (!Number.isFinite(current) || !Number.isFinite(max)) {
    return null;
  }

  const safeTemporary = Number.isFinite(temporary ?? 0) ? Number(temporary ?? 0) : 0;

  return { current, max, temporary: safeTemporary };
};

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

  const loadCharacter = useCallback(async (id: string) => {
    try {
      setLoading(true);
      setError(null);
      const char = await getCharacter(id);
      if (char) {
        setCharacter(char);
        return;
      }

      setCharacter(null);
      setError("Character not found");
    } catch (error) {
      console.error("Failed to load character:", error);
      setError("Failed to load character");
      setCharacter(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!characterId) {
      setCharacter(null);
      setLoading(false);
      return;
    }

    void loadCharacter(characterId);
  }, [characterId, loadCharacter, refreshTrigger]);

  // Calculate ability modifier
  const getAbilityModifier = (score: number): number => {
    return Math.floor((score - 10) / 2);
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
            <div className="text-center text-muted-foreground space-y-3">
              <p>{error || 'No character selected'}</p>
              {error && characterId && (
                <Button variant="outline" size="sm" onClick={() => loadCharacter(characterId)}>
                  Retry
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const abilityScores = sanitizeAbilities(character.abilities);
  const hitPoints = normalizeHitPoints(character.hit_points ?? character.hitPoints ?? null);
  const armorClass = typeof character.armor_class === "number"
    ? character.armor_class
    : typeof character.armorClass === "number"
      ? character.armorClass
      : null;
  const rawProficiency = character.proficiency_bonus ?? character.proficiencyBonus ?? null;
  const savingThrows = character.saving_throws ?? character.savingThrows ?? {};
  const skillRanks = character.skills ?? {};

  if (!abilityScores || !hitPoints || armorClass === null || typeof rawProficiency !== "number" || Number.isNaN(rawProficiency)) {
    const dataIssues: string[] = [];
    if (!abilityScores) {
      dataIssues.push("Ability scores are missing or invalid.");
    }
    if (!hitPoints) {
      dataIssues.push("Hit point totals are missing or invalid.");
    }
    if (armorClass === null) {
      dataIssues.push("Armor class is missing or invalid.");
    }
    if (typeof rawProficiency !== "number" || Number.isNaN(rawProficiency)) {
      dataIssues.push("Proficiency bonus is missing or invalid.");
    }

    return (
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Character data incomplete</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-muted-foreground">
            <p>This character record is missing required fields from the live database:</p>
            <ul className="list-disc space-y-1 pl-5">
              {dataIssues.map((issue) => (
                <li key={issue}>{issue}</li>
              ))}
            </ul>
            <p>Refresh once the missing values are populated to render the full sheet.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const proficiencyBonus = rawProficiency;
  const initiative = getAbilityModifier(abilityScores.dexterity);

  const displayAbilities: AbilitySummary[] = ABILITY_KEYS.map((ability) => {
    const score = abilityScores[ability];
    const modifier = getAbilityModifier(score);
    const hasSaveProficiency = Object.prototype.hasOwnProperty.call(savingThrows, ability);
    const savingThrowBonus = hasSaveProficiency ? modifier + proficiencyBonus : modifier;

    return {
      ability,
      score,
      modifier,
      savingThrow: savingThrowBonus,
    };
  });

  const displaySkills: SkillSummary[] = SKILL_DEFINITIONS.map(({ name, ability }) => {
    const abilityScore = abilityScores[ability];
    const modifier = getAbilityModifier(abilityScore);
    const isSkillProficient = Object.prototype.hasOwnProperty.call(skillRanks, name);

    return {
      name,
      bonus: isSkillProficient ? modifier + proficiencyBonus : modifier,
    };
  });

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
              {displayAbilities.map(({ ability, modifier, score }) => (
                <div key={ability} className="text-center p-3 border rounded">
                  <div className="text-sm font-medium capitalize mb-1">{ability.slice(0, 3)}</div>
                  <div className="text-2xl font-bold">{modifier >= 0 ? '+' : ''}{modifier}</div>
                  <div className="text-xs text-muted-foreground">{score}</div>
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
              {displaySkills.map(({ name, bonus }) => (
                <div key={name} className="flex justify-between items-center">
                  <span className="text-sm">{name}</span>
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
              <div className="space-y-2">
                <h4 className="font-medium">Equipped Items</h4>
                <div className="space-y-1 text-sm">
                  {character.equipment.weapons?.mainHand && (
                    <div className="flex justify-between">
                      <span>Main Hand</span>
                      <span className="text-muted-foreground">{character.equipment.weapons.mainHand.name}</span>
                    </div>
                  )}
                  {character.equipment.weapons?.offHand && (
                    <div className="flex justify-between">
                      <span>Off Hand</span>
                      <span className="text-muted-foreground">{character.equipment.weapons.offHand.name}</span>
                    </div>
                  )}
                  {character.equipment.weapons?.ranged && (
                    <div className="flex justify-between">
                      <span>Ranged</span>
                      <span className="text-muted-foreground">{character.equipment.weapons.ranged.name}</span>
                    </div>
                  )}
                  {character.equipment.armor && (
                    <div className="flex justify-between">
                      <span>Armor</span>
                      <span className="text-muted-foreground">{character.equipment.armor.name}</span>
                    </div>
                  )}
                  {character.equipment.shield && (
                    <div className="flex justify-between">
                      <span>Shield</span>
                      <span className="text-muted-foreground">{character.equipment.shield.name}</span>
                    </div>
                  )}
                  {character.equipment.accessories?.ring1 && (
                    <div className="flex justify-between">
                      <span>Ring</span>
                      <span className="text-muted-foreground">{character.equipment.accessories.ring1.name}</span>
                    </div>
                  )}
                  {character.equipment.accessories?.ring2 && (
                    <div className="flex justify-between">
                      <span>Ring</span>
                      <span className="text-muted-foreground">{character.equipment.accessories.ring2.name}</span>
                    </div>
                  )}
                  {character.equipment.accessories?.necklace && (
                    <div className="flex justify-between">
                      <span>Necklace</span>
                      <span className="text-muted-foreground">{character.equipment.accessories.necklace.name}</span>
                    </div>
                  )}
                  {character.equipment.accessories?.cloak && (
                    <div className="flex justify-between">
                      <span>Cloak</span>
                      <span className="text-muted-foreground">{character.equipment.accessories.cloak.name}</span>
                    </div>
                  )}
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
