import { useWizard } from '../wizard-context';
import { ABILITY_ABBREVIATIONS, ABILITY_NAMES } from '../../../utils/srd/constants';
import type { AbilityName } from '../../../utils/srd/types';
import { Badge } from '../../ui/badge';
import { Separator } from '../../ui/separator';

function deslugify(slug: string): string {
  return slug
    .split('-')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

export function CharacterPreview() {
  const { state } = useWizard();
  const { computedStats } = state;

  const calcMod = (score: number) => {
    const mod = Math.floor((score - 10) / 2);
    return mod >= 0 ? `+${mod}` : `${mod}`;
  };

  const speciesDisplay = state.speciesKey ? deslugify(state.speciesKey) : null;
  const classDisplay = state.classKey ? deslugify(state.classKey) : null;
  const subraceDisplay = state.subraceKey ? deslugify(state.subraceKey) : null;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div>
        <h4 className="font-bold text-lg">
          {state.name || 'Unnamed Character'}
        </h4>
        <p className="text-sm text-muted-foreground">
          {[speciesDisplay, classDisplay].filter(Boolean).join(' ') || 'No selections yet'}
          {subraceDisplay && ` (${subraceDisplay})`}
        </p>
        {state.alignment && (
          <p className="text-xs text-muted-foreground">{state.alignment}</p>
        )}
      </div>

      <Separator />

      {/* Ability Scores */}
      <div>
        <h5 className="text-xs font-semibold text-muted-foreground mb-2">ABILITY SCORES</h5>
        <div className="grid grid-cols-3 gap-2">
          {ABILITY_NAMES.map((ability: AbilityName) => {
            const score = computedStats?.abilities[ability] ?? state.baseAbilities[ability];
            return (
              <div key={ability} className="text-center p-2 bg-muted rounded">
                <div className="text-[10px] font-medium text-muted-foreground">
                  {ABILITY_ABBREVIATIONS[ability]}
                </div>
                <div className="text-lg font-bold">{score}</div>
                <div className="text-xs text-muted-foreground">{calcMod(score)}</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Combat Stats */}
      {computedStats && (
        <>
          <Separator />
          <div>
            <h5 className="text-xs font-semibold text-muted-foreground mb-2">COMBAT</h5>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">HP</span>
                <span className="font-medium">{computedStats.hitPoints.max}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">AC</span>
                <span className="font-medium">{computedStats.armorClass}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Initiative</span>
                <span className="font-medium">
                  {computedStats.initiative >= 0 ? '+' : ''}{computedStats.initiative}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Speed</span>
                <span className="font-medium">{computedStats.speed} ft</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Prof. Bonus</span>
                <span className="font-medium">+{computedStats.proficiencyBonus}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Perception</span>
                <span className="font-medium">{computedStats.passivePerception}</span>
              </div>
            </div>
          </div>
        </>
      )}

      {/* Saving Throws */}
      {computedStats && (
        <>
          <Separator />
          <div>
            <h5 className="text-xs font-semibold text-muted-foreground mb-2">SAVING THROWS</h5>
            <div className="space-y-1">
              {ABILITY_NAMES.map((ability: AbilityName) => {
                const save = computedStats.savingThrows[ability];
                if (!save) return null;
                return (
                  <div key={ability} className="flex justify-between text-sm">
                    <span className={save.proficient ? 'font-medium' : 'text-muted-foreground'}>
                      {save.proficient && '* '}{ABILITY_ABBREVIATIONS[ability]}
                    </span>
                    <span className={save.proficient ? 'font-medium' : 'text-muted-foreground'}>
                      {save.modifier >= 0 ? '+' : ''}{save.modifier}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}

      {/* Skills (proficient only) */}
      {computedStats && Object.entries(computedStats.skills).some(([, s]) => s.proficient) && (
        <>
          <Separator />
          <div>
            <h5 className="text-xs font-semibold text-muted-foreground mb-2">PROFICIENT SKILLS</h5>
            <div className="space-y-1">
              {Object.entries(computedStats.skills)
                .filter(([, s]) => s.proficient)
                .map(([name, skill]) => (
                  <div key={name} className="flex justify-between text-sm">
                    <span className="font-medium capitalize">{name}</span>
                    <span className="font-medium">
                      {skill.modifier >= 0 ? '+' : ''}{skill.modifier}
                    </span>
                  </div>
                ))}
            </div>
          </div>
        </>
      )}

      {/* Languages */}
      {state.chosenLanguages.length > 0 && (
        <>
          <Separator />
          <div>
            <h5 className="text-xs font-semibold text-muted-foreground mb-2">LANGUAGES</h5>
            <div className="flex flex-wrap gap-1">
              {state.chosenLanguages.map((lang) => (
                <Badge key={lang} variant="outline" className="text-xs">
                  {lang}
                </Badge>
              ))}
            </div>
          </div>
        </>
      )}

      {/* Spellcasting */}
      {computedStats?.spellcasting && (
        <>
          <Separator />
          <div>
            <h5 className="text-xs font-semibold text-muted-foreground mb-2">SPELLCASTING</h5>
            <div className="space-y-1 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Ability</span>
                <span className="font-medium capitalize">{computedStats.spellcasting.ability}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Save DC</span>
                <span className="font-medium">{computedStats.spellcasting.spellSaveDC}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Attack</span>
                <span className="font-medium">
                  +{computedStats.spellcasting.spellAttackBonus}
                </span>
              </div>
            </div>
          </div>
        </>
      )}

      {/* Chosen Spells Summary */}
      {(state.chosenCantrips.length > 0 || state.chosenSpells.length > 0) && (
        <>
          <Separator />
          <div>
            <h5 className="text-xs font-semibold text-muted-foreground mb-2">SPELLS</h5>
            {state.chosenCantrips.length > 0 && (
              <div className="mb-2">
                <div className="text-xs text-muted-foreground mb-1">Cantrips</div>
                <div className="flex flex-wrap gap-1">
                  {state.chosenCantrips.map((s) => (
                    <Badge key={s} variant="outline" className="text-xs">{deslugify(s)}</Badge>
                  ))}
                </div>
              </div>
            )}
            {state.chosenSpells.length > 0 && (
              <div>
                <div className="text-xs text-muted-foreground mb-1">1st Level</div>
                <div className="flex flex-wrap gap-1">
                  {state.chosenSpells.map((s) => (
                    <Badge key={s} variant="outline" className="text-xs">{deslugify(s)}</Badge>
                  ))}
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
