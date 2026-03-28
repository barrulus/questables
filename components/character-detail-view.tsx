import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Label } from "./ui/label";
import { ScrollArea } from "./ui/scroll-area";
import { Badge } from "./ui/badge";
import { Users } from "lucide-react";
import type {
  Character,
  InventoryItem,
  Equipment,
  SpellcastingInfo,
} from "../utils/database/data-structures";

const abilityKeys = [
  "strength", "dexterity", "constitution", "intelligence", "wisdom", "charisma",
] as const;

const abilityAbbreviations: Record<typeof abilityKeys[number], string> = {
  strength: "STR", dexterity: "DEX", constitution: "CON",
  intelligence: "INT", wisdom: "WIS", charisma: "CHA",
};

type NumericLike = number | string | null | undefined;
type RawHitPoints = {
  current?: NumericLike; max?: NumericLike; maximum?: NumericLike;
  temp?: NumericLike; temporary?: NumericLike;
};

const toNumber = (value: NumericLike, fallback = 0) => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") { const p = Number(value); return Number.isFinite(p) ? p : fallback; }
  return fallback;
};

const getHitPoints = (character: Character) => {
  const raw = (character.hit_points as RawHitPoints | undefined) ?? (character.hitPoints as RawHitPoints | undefined) ?? {};
  return {
    current: toNumber(raw.current, 0),
    max: toNumber(raw.max ?? raw.maximum, 0),
    temporary: toNumber(raw.temporary ?? raw.temp, 0),
  };
};

const getAbilities = (character: Character) => {
  const abilities = character.abilities as Record<string, number> | undefined;
  if (!abilities) return Object.fromEntries(abilityKeys.map((k) => [k, 10])) as Record<typeof abilityKeys[number], number>;
  return abilityKeys.reduce((acc, ability) => {
    const value = abilities[ability];
    acc[ability] = typeof value === "number" ? value : Number(value) || 10;
    return acc;
  }, {} as Record<typeof abilityKeys[number], number>);
};

const getArmorClass = (character: Character) => {
  const value = (character.armor_class as number | undefined) ?? (character.armorClass as number | undefined);
  return typeof value === "number" ? value : 10;
};

const getProficiencyBonus = (character: Character) => {
  const value = (character.proficiency_bonus as number | undefined) ?? (character.proficiencyBonus as number | undefined);
  return typeof value === "number" ? value : 2;
};

const getSpeed = (character: Character) => (typeof character.speed === "number" ? character.speed : 30);

const getAbilityModifier = (score: number) => Math.floor((score - 10) / 2);

const createEmptyEquipment = (): Equipment => ({ weapons: {}, accessories: {} });

const formatDate = (value?: string | Date | null) => {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString();
};

interface CharacterDetailViewProps {
  character: Character | null;
}

export function CharacterDetailView({ character }: CharacterDetailViewProps) {
  if (!character) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center text-muted-foreground">
        <Users className="h-10 w-10 opacity-40" />
        <p>Select a character to view details</p>
      </div>
    );
  }

  const hitPoints = getHitPoints(character);
  const abilities = getAbilities(character);
  const skills = (character.skills as Record<string, number> | undefined) ?? {};
  const inventory = Array.isArray(character.inventory) ? (character.inventory as InventoryItem[]) : [];
  const equipment = (character.equipment as Equipment | undefined) ?? createEmptyEquipment();
  const spellcasting = (character.spellcasting as SpellcastingInfo | undefined) ?? undefined;

  return (
    <div className="flex h-full flex-col">
      <div className="border-b px-5 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold">{character.name}</h3>
            <p className="text-sm text-muted-foreground">
              Level {character.level} {character.race} {character.class}
            </p>
          </div>
          <div className="text-right text-xs text-muted-foreground">
            <div>Created {formatDate((character.created_at as string | undefined) ?? (character.createdAt as string | undefined)) || "unknown"}</div>
            <div>Last updated {formatDate((character.updated_at as string | undefined) ?? (character.updatedAt as string | undefined)) || "unknown"}</div>
          </div>
        </div>
      </div>
      <ScrollArea className="flex-1">
        <div className="space-y-6 p-5">
          <Card>
            <CardHeader><CardTitle>Overview</CardTitle></CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-2">
              <div>
                <Label className="text-xs uppercase text-muted-foreground">Hit Points</Label>
                <div className="text-sm font-medium">
                  {hitPoints.current} / {hitPoints.max}
                  {hitPoints.temporary ? ` (+${hitPoints.temporary} temporary)` : ""}
                </div>
              </div>
              <div>
                <Label className="text-xs uppercase text-muted-foreground">Armor Class</Label>
                <div className="text-sm font-medium">{getArmorClass(character)}</div>
              </div>
              <div>
                <Label className="text-xs uppercase text-muted-foreground">Speed</Label>
                <div className="text-sm font-medium">{getSpeed(character)} ft.</div>
              </div>
              <div>
                <Label className="text-xs uppercase text-muted-foreground">Proficiency Bonus</Label>
                <div className="text-sm font-medium">+{getProficiencyBonus(character)}</div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Ability Scores</CardTitle></CardHeader>
            <CardContent>
              <div className="grid gap-3 md:grid-cols-3">
                {abilityKeys.map((ability) => (
                  <div key={ability} className="rounded border p-3 text-center">
                    <div className="text-xs font-semibold uppercase text-muted-foreground">
                      {abilityAbbreviations[ability]}
                    </div>
                    <div className="text-2xl font-bold">
                      {getAbilityModifier(abilities[ability]) >= 0 ? "+" : ""}
                      {getAbilityModifier(abilities[ability])}
                    </div>
                    <div className="text-xs text-muted-foreground">({abilities[ability]})</div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {character.backstory && (
            <Card>
              <CardHeader><CardTitle>Backstory</CardTitle></CardHeader>
              <CardContent>
                <p className="whitespace-pre-wrap text-sm leading-relaxed">{character.backstory}</p>
              </CardContent>
            </Card>
          )}

          {Object.keys(skills).length > 0 && (
            <Card>
              <CardHeader><CardTitle>Skill Proficiencies</CardTitle></CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-2">
                  {Object.keys(skills).map((skill) => (
                    <Badge key={skill} variant="secondary">{skill}</Badge>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {inventory.length > 0 && (
            <Card>
              <CardHeader><CardTitle>Inventory</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                {inventory.map((item) => (
                  <div key={item.id} className="rounded border p-3 text-sm">
                    <div className="flex items-center justify-between">
                      <span className="font-medium">{item.name}</span>
                      <span className="text-xs text-muted-foreground">Qty {item.quantity ?? 1}</span>
                    </div>
                    {item.description && (
                      <p className="mt-1 text-xs text-muted-foreground">{item.description}</p>
                    )}
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {equipment && Object.keys(equipment).length > 0 && (
            <Card>
              <CardHeader><CardTitle>Equipment</CardTitle></CardHeader>
              <CardContent className="space-y-3 text-sm">
                {equipment.armor && (
                  <div>
                    <div className="font-semibold">Armor</div>
                    <div className="text-muted-foreground">{equipment.armor.name}</div>
                  </div>
                )}
                {equipment.shield && (
                  <div>
                    <div className="font-semibold">Shield</div>
                    <div className="text-muted-foreground">{equipment.shield.name}</div>
                  </div>
                )}
                {equipment.weapons && Object.keys(equipment.weapons).length > 0 && (
                  <div>
                    <div className="font-semibold">Weapons</div>
                    <ul className="ml-4 list-disc space-y-1 text-muted-foreground">
                      {Object.values(equipment.weapons).filter(Boolean).map((weapon) =>
                        weapon ? <li key={weapon.id}>{weapon.name}</li> : null,
                      )}
                    </ul>
                  </div>
                )}
                {equipment.accessories && Object.keys(equipment.accessories).length > 0 && (
                  <div>
                    <div className="font-semibold">Accessories</div>
                    <ul className="ml-4 list-disc space-y-1 text-muted-foreground">
                      {Object.values(equipment.accessories).filter(Boolean).map((item) =>
                        item ? <li key={item.id}>{item.name}</li> : null,
                      )}
                    </ul>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {spellcasting && (
            <Card>
              <CardHeader><CardTitle>Spellcasting</CardTitle></CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div className="grid gap-3 md:grid-cols-3">
                  <div>
                    <div className="text-xs uppercase text-muted-foreground">Ability</div>
                    <div className="font-medium">{spellcasting.spellcastingAbility}</div>
                  </div>
                  <div>
                    <div className="text-xs uppercase text-muted-foreground">Spell Attack Bonus</div>
                    <div className="font-medium">+{spellcasting.spellAttackBonus}</div>
                  </div>
                  <div>
                    <div className="text-xs uppercase text-muted-foreground">Spell Save DC</div>
                    <div className="font-medium">{spellcasting.spellSaveDC}</div>
                  </div>
                </div>
                {spellcasting.cantripsKnown?.length ? (
                  <div>
                    <div className="font-semibold">Cantrips</div>
                    <div className="text-muted-foreground">{spellcasting.cantripsKnown.join(", ")}</div>
                  </div>
                ) : null}
                {spellcasting.spellsKnown?.length ? (
                  <div>
                    <div className="font-semibold">Spells Known</div>
                    <div className="text-muted-foreground">{spellcasting.spellsKnown.join(", ")}</div>
                  </div>
                ) : null}
              </CardContent>
            </Card>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
