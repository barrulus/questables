import { useWizard } from '../wizard-context';
import { ABILITY_ABBREVIATIONS } from '../../../utils/srd/constants';
import type { AbilityName } from '../../../utils/srd/types';
import { Card, CardContent, CardHeader, CardTitle } from '../../ui/card';
import { Badge } from '../../ui/badge';
import { ScrollArea } from '../../ui/scroll-area';
import { AlertCircle, CheckCircle2 } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '../../ui/alert';

export function StepReview() {
  const { state } = useWizard();

  const validations = {
    hasSpecies: !!state.speciesKey,
    hasClass: !!state.classKey,
    hasAbilityScores: Object.values(state.baseAbilities).every((v) => v !== null),
    hasBackground: !!state.backgroundKey,
    hasName: !!state.name,
  };

  const allValid = Object.values(validations).every((v) => v);
  const warnings: string[] = [];

  if (!validations.hasSpecies) warnings.push('Species not selected');
  if (!validations.hasClass) warnings.push('Class not selected');
  if (!validations.hasAbilityScores) warnings.push('Ability scores not fully assigned');
  if (!validations.hasBackground) warnings.push('Background not selected');
  if (!validations.hasName) warnings.push('Character name is required');

  const calcMod = (score: number) => {
    const mod = Math.floor((score - 10) / 2);
    return mod >= 0 ? `+${mod}` : `${mod}`;
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold mb-2">Review Your Character</h2>
        <p className="text-muted-foreground">
          Review all your choices before finalizing your character.
        </p>
      </div>

      {allValid ? (
        <Alert>
          <CheckCircle2 className="h-4 w-4" />
          <AlertTitle>Everything looks good!</AlertTitle>
          <AlertDescription>
            Your character is complete and ready to save.
          </AlertDescription>
        </Alert>
      ) : (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Incomplete Character</AlertTitle>
          <AlertDescription>
            Please complete the following steps:
            <ul className="list-disc list-inside mt-2">
              {warnings.map((warning, idx) => (
                <li key={idx}>{warning}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      <ScrollArea className="h-[600px]">
        <div className="space-y-6 pr-4">
          <Card>
            <CardHeader>
              <CardTitle>Basic Information</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                <div>
                  <span className="font-medium">Name:</span>{' '}
                  <span className="text-muted-foreground">
                    {state.name || 'Not set'}
                  </span>
                </div>
                <div>
                  <span className="font-medium">Species:</span>{' '}
                  <span className="text-muted-foreground">
                    {state.speciesKey || 'Not selected'}
                    {state.subraceKey && ` (${state.subraceKey})`}
                  </span>
                </div>
                <div>
                  <span className="font-medium">Class:</span>{' '}
                  <span className="text-muted-foreground">
                    {state.classKey || 'Not selected'}
                  </span>
                </div>
                <div>
                  <span className="font-medium">Background:</span>{' '}
                  <span className="text-muted-foreground">
                    {state.backgroundKey || 'Not selected'}
                  </span>
                </div>
                <div>
                  <span className="font-medium">Alignment:</span>{' '}
                  <span className="text-muted-foreground">
                    {state.alignment || 'Not set'}
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Ability Scores</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                {(Object.entries(state.baseAbilities) as [AbilityName, number][]).map(([ability, score]) => (
                  <div key={ability} className="text-center p-3 bg-muted rounded-lg">
                    <div className="text-xs font-medium text-muted-foreground">
                      {ABILITY_ABBREVIATIONS[ability]}
                    </div>
                    <div className="text-2xl font-bold">{score}</div>
                    <div className="text-sm text-muted-foreground">{calcMod(score)}</div>
                  </div>
                ))}
              </div>
              {state.abilityScoreMethod && (
                <p className="text-xs text-muted-foreground mt-3">
                  Method: {state.abilityScoreMethod === 'standard-array' ? 'Standard Array' :
                           state.abilityScoreMethod === 'point-buy' ? 'Point Buy' :
                           '4d6 Drop Lowest'}
                </p>
              )}
            </CardContent>
          </Card>

          {state.chosenSkills.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Skills</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-2">
                  {state.chosenSkills.map((skill) => (
                    <Badge key={skill} variant="secondary">{skill}</Badge>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {state.chosenLanguages.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Languages</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-2">
                  {state.chosenLanguages.map((language) => (
                    <Badge key={language} variant="secondary">{language}</Badge>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {(state.chosenCantrips.length > 0 || state.chosenSpells.length > 0) && (
            <Card>
              <CardHeader>
                <CardTitle>Spells</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {state.chosenCantrips.length > 0 && (
                    <div>
                      <h4 className="text-sm font-semibold mb-2">Cantrips</h4>
                      <div className="flex flex-wrap gap-2">
                        {state.chosenCantrips.map((cantrip) => (
                          <Badge key={cantrip} variant="outline">{cantrip}</Badge>
                        ))}
                      </div>
                    </div>
                  )}
                  {state.chosenSpells.length > 0 && (
                    <div>
                      <h4 className="text-sm font-semibold mb-2">1st Level Spells</h4>
                      <div className="flex flex-wrap gap-2">
                        {state.chosenSpells.map((spell) => (
                          <Badge key={spell} variant="outline">{spell}</Badge>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          )}

          {(state.personality || state.ideals || state.bonds || state.flaws || state.backstory) && (
            <Card>
              <CardHeader>
                <CardTitle>Personality & Backstory</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {state.personality && (
                    <div>
                      <h4 className="text-sm font-semibold mb-1">Personality Traits</h4>
                      <p className="text-sm text-muted-foreground">{state.personality}</p>
                    </div>
                  )}
                  {state.ideals && (
                    <div>
                      <h4 className="text-sm font-semibold mb-1">Ideals</h4>
                      <p className="text-sm text-muted-foreground">{state.ideals}</p>
                    </div>
                  )}
                  {state.bonds && (
                    <div>
                      <h4 className="text-sm font-semibold mb-1">Bonds</h4>
                      <p className="text-sm text-muted-foreground">{state.bonds}</p>
                    </div>
                  )}
                  {state.flaws && (
                    <div>
                      <h4 className="text-sm font-semibold mb-1">Flaws</h4>
                      <p className="text-sm text-muted-foreground">{state.flaws}</p>
                    </div>
                  )}
                  {state.backstory && (
                    <div>
                      <h4 className="text-sm font-semibold mb-1">Backstory</h4>
                      <p className="text-sm text-muted-foreground">{state.backstory}</p>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          )}

          {state.computedStats && (
            <Card>
              <CardHeader>
                <CardTitle>Computed Statistics</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  <div>
                    <span className="font-medium">Proficiency Bonus:</span>{' '}
                    <span className="text-muted-foreground">
                      +{state.computedStats.proficiencyBonus}
                    </span>
                  </div>
                  <div>
                    <span className="font-medium">Armor Class:</span>{' '}
                    <span className="text-muted-foreground">
                      {state.computedStats.armorClass}
                    </span>
                  </div>
                  <div>
                    <span className="font-medium">Initiative:</span>{' '}
                    <span className="text-muted-foreground">
                      {state.computedStats.initiative >= 0 ? '+' : ''}{state.computedStats.initiative}
                    </span>
                  </div>
                  <div>
                    <span className="font-medium">Speed:</span>{' '}
                    <span className="text-muted-foreground">
                      {state.computedStats.speed} ft
                    </span>
                  </div>
                  <div>
                    <span className="font-medium">Hit Points:</span>{' '}
                    <span className="text-muted-foreground">
                      {state.computedStats.hitPoints.max}
                    </span>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
