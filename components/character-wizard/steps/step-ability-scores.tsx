import { useState } from 'react';
import { useWizard } from '../wizard-context';
import {
  STANDARD_ARRAY,
  POINT_BUY_COSTS,
  POINT_BUY_TOTAL,
  ABILITY_NAMES,
  ABILITY_ABBREVIATIONS,
  ABILITY_SCORE_METHODS,
} from '../../../utils/srd/constants';
import type { AbilityName } from '../../../utils/srd/types';
import type { AbilityScoreMethod } from '../../../utils/srd/constants';
import { Card, CardContent, CardHeader, CardTitle } from '../../ui/card';
import { Button } from '../../ui/button';
import { Label } from '../../ui/label';
import { RadioGroup, RadioGroupItem } from '../../ui/radio-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../ui/select';

function calculateModifier(score: number): number {
  return Math.floor((score - 10) / 2);
}

function formatModifier(score: number): string {
  const mod = calculateModifier(score);
  return mod >= 0 ? `+${mod}` : `${mod}`;
}

function rollAbilityScore(): number {
  const rolls = Array.from({ length: 4 }, () => Math.floor(Math.random() * 6) + 1);
  rolls.sort((a, b) => a - b);
  return rolls[1] + rolls[2] + rolls[3];
}

export function StepAbilityScores() {
  const { state, dispatch } = useWizard();
  const [method, setMethod] = useState<AbilityScoreMethod>(
    state.abilityScoreMethod ?? 'standard-array',
  );

  // Standard Array: track which value is assigned to which ability
  const [standardAssignments, setStandardAssignments] = useState<Record<AbilityName, number | null>>(() => {
    if (state.abilityScoreMethod === 'standard-array') {
      const assignments: Record<AbilityName, number | null> = {
        strength: null, dexterity: null, constitution: null,
        intelligence: null, wisdom: null, charisma: null,
      };
      for (const name of ABILITY_NAMES) {
        const val = state.baseAbilities[name];
        if (val !== 10 && STANDARD_ARRAY.includes(val as typeof STANDARD_ARRAY[number])) {
          assignments[name] = val;
        }
      }
      return assignments;
    }
    return { strength: null, dexterity: null, constitution: null, intelligence: null, wisdom: null, charisma: null };
  });

  // Point Buy state
  const [pointBuyScores, setPointBuyScores] = useState<Record<AbilityName, number>>(() => {
    if (state.abilityScoreMethod === 'point-buy') {
      return { ...state.baseAbilities };
    }
    return { strength: 8, dexterity: 8, constitution: 8, intelligence: 8, wisdom: 8, charisma: 8 };
  });

  // Roll state — restore from wizard context if method was 4d6
  const [rolledScores, setRolledScores] = useState<number[]>(() => {
    if (state.abilityScoreMethod === '4d6-drop-lowest') {
      // Reconstruct rolled scores from the assigned abilities
      const scores = ABILITY_NAMES.map((name) => state.baseAbilities[name]);
      const allDefault = scores.every((s) => s === 10);
      return allDefault ? [] : scores;
    }
    return [];
  });
  const [rollAssignments, setRollAssignments] = useState<Record<AbilityName, number | null>>(() => {
    if (state.abilityScoreMethod === '4d6-drop-lowest') {
      const allDefault = ABILITY_NAMES.every((name) => state.baseAbilities[name] === 10);
      if (!allDefault) {
        const assignments: Record<AbilityName, number | null> = {
          strength: null, dexterity: null, constitution: null,
          intelligence: null, wisdom: null, charisma: null,
        };
        for (const name of ABILITY_NAMES) {
          assignments[name] = state.baseAbilities[name];
        }
        return assignments;
      }
    }
    return { strength: null, dexterity: null, constitution: null, intelligence: null, wisdom: null, charisma: null };
  });

  const handleMethodChange = (newMethod: string) => {
    const m = newMethod as AbilityScoreMethod;
    setMethod(m);
    dispatch({ type: 'SET_ABILITY_METHOD', method: m });
  };

  // Dispatch ability scores to wizard
  const dispatchAbilities = (abilities: Record<AbilityName, number>) => {
    dispatch({ type: 'SET_ABILITIES', abilities });
  };

  // Standard Array
  const getAvailableStandardValues = (excludeAbility: AbilityName): number[] => {
    const pool = [...STANDARD_ARRAY] as number[];
    for (const [ability, val] of Object.entries(standardAssignments)) {
      if (ability !== excludeAbility && val !== null) {
        const idx = pool.indexOf(val);
        if (idx !== -1) pool.splice(idx, 1);
      }
    }
    pool.sort((a, b) => b - a);
    return pool;
  };

  const handleStandardAssignment = (ability: AbilityName, value: string) => {
    const numValue = value ? parseInt(value) : null;
    const newAssignments = { ...standardAssignments, [ability]: numValue };
    setStandardAssignments(newAssignments);

    const abilities: Record<AbilityName, number> = { ...state.baseAbilities };
    for (const name of ABILITY_NAMES) {
      abilities[name] = newAssignments[name] ?? state.baseAbilities[name];
    }
    dispatchAbilities(abilities);
  };

  // Point Buy
  const calculatePointsSpent = () => {
    return ABILITY_NAMES.reduce((total, ability) => {
      const score = pointBuyScores[ability];
      return total + (POINT_BUY_COSTS[score] ?? 0);
    }, 0);
  };

  const handlePointBuyChange = (ability: AbilityName, delta: number) => {
    const currentScore = pointBuyScores[ability];
    const newScore = currentScore + delta;
    if (newScore < 8 || newScore > 15) return;

    const currentCost = POINT_BUY_COSTS[currentScore] ?? 0;
    const newCost = POINT_BUY_COSTS[newScore] ?? 0;
    if (calculatePointsSpent() + (newCost - currentCost) > POINT_BUY_TOTAL) return;

    const newScores = { ...pointBuyScores, [ability]: newScore } as Record<AbilityName, number>;
    setPointBuyScores(newScores);
    dispatchAbilities(newScores);
  };

  // Roll
  const handleRollAll = () => {
    const rolls = Array.from({ length: 6 }, () => rollAbilityScore());
    setRolledScores(rolls);

    // Auto-assign rolled values to abilities in order
    const assignments: Record<AbilityName, number | null> = {
      strength: null, dexterity: null, constitution: null,
      intelligence: null, wisdom: null, charisma: null,
    };
    const abilities: Record<AbilityName, number> = { ...state.baseAbilities };
    ABILITY_NAMES.forEach((name, i) => {
      assignments[name] = rolls[i];
      abilities[name] = rolls[i];
    });
    setRollAssignments(assignments);
    dispatchAbilities(abilities);
  };

  const getAvailableRolledValues = (excludeAbility: AbilityName): number[] => {
    const pool = [...rolledScores];
    for (const [ability, val] of Object.entries(rollAssignments)) {
      if (ability !== excludeAbility && val !== null) {
        const idx = pool.indexOf(val);
        if (idx !== -1) pool.splice(idx, 1);
      }
    }
    pool.sort((a, b) => b - a);
    return pool;
  };

  const handleRollAssignment = (ability: AbilityName, value: string) => {
    const numValue = value ? parseInt(value) : null;
    const newAssignments = { ...rollAssignments, [ability]: numValue };
    setRollAssignments(newAssignments);

    const abilities: Record<AbilityName, number> = { ...state.baseAbilities };
    for (const name of ABILITY_NAMES) {
      abilities[name] = newAssignments[name] ?? state.baseAbilities[name];
    }
    dispatchAbilities(abilities);
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold mb-2">Determine Ability Scores</h2>
        <p className="text-muted-foreground">
          Choose how to generate your character's ability scores.
        </p>
      </div>

      <RadioGroup value={method} onValueChange={handleMethodChange}>
        {ABILITY_SCORE_METHODS.map((m) => (
          <div key={m.key} className="flex items-center space-x-2">
            <RadioGroupItem value={m.key} id={m.key} />
            <Label htmlFor={m.key}>
              {m.label}
              <span className="text-muted-foreground ml-2 text-xs">{m.description}</span>
            </Label>
          </div>
        ))}
      </RadioGroup>

      {method === 'standard-array' && (
        <Card>
          <CardHeader>
            <CardTitle>Assign Standard Array Values</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {ABILITY_NAMES.map((ability) => {
                const available = getAvailableStandardValues(ability);
                const currentValue = standardAssignments[ability];

                return (
                  <div key={ability} className="flex items-center justify-between">
                    <Label className="w-20">{ABILITY_ABBREVIATIONS[ability]}</Label>
                    <Select
                      value={currentValue?.toString() ?? ''}
                      onValueChange={(val) => handleStandardAssignment(ability, val)}
                    >
                      <SelectTrigger className="w-32">
                        <SelectValue placeholder="Select..." />
                      </SelectTrigger>
                      <SelectContent>
                        {available.map((val, idx) => (
                          <SelectItem key={`${val}-${idx}`} value={val.toString()}>
                            {val}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <div className="w-24 text-right text-sm text-muted-foreground">
                      {currentValue !== null && `Modifier: ${formatModifier(currentValue)}`}
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {method === 'point-buy' && (
        <Card>
          <CardHeader>
            <CardTitle>
              Point Buy
              <span className="ml-4 text-sm font-normal">
                Points Remaining: {POINT_BUY_TOTAL - calculatePointsSpent()}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {ABILITY_NAMES.map((ability) => {
                const score = pointBuyScores[ability];
                return (
                  <div key={ability} className="flex items-center justify-between">
                    <Label className="w-20">{ABILITY_ABBREVIATIONS[ability]}</Label>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handlePointBuyChange(ability, -1)}
                        disabled={score <= 8}
                      >
                        -
                      </Button>
                      <div className="w-12 text-center font-medium">{score}</div>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handlePointBuyChange(ability, 1)}
                        disabled={score >= 15 || calculatePointsSpent() >= POINT_BUY_TOTAL}
                      >
                        +
                      </Button>
                    </div>
                    <div className="w-24 text-right text-sm text-muted-foreground">
                      Modifier: {formatModifier(score)}
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {method === '4d6-drop-lowest' && (
        <Card>
          <CardHeader>
            <CardTitle>Roll for Ability Scores</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <Button onClick={handleRollAll}>
                {rolledScores.length > 0 ? 'Re-roll All' : 'Roll All'}
              </Button>

              {rolledScores.length > 0 && (
                <>
                  <div className="flex gap-2 flex-wrap items-center">
                    <span className="text-sm font-medium">Rolled values:</span>
                    <span className="text-sm font-bold">{rolledScores.join(', ')}</span>
                  </div>

                  <div className="space-y-4 mt-4">
                    {ABILITY_NAMES.map((ability) => {
                      const available = getAvailableRolledValues(ability);
                      const currentValue = rollAssignments[ability];

                      return (
                        <div key={ability} className="flex items-center justify-between">
                          <Label className="w-20">{ABILITY_ABBREVIATIONS[ability]}</Label>
                          <Select
                            value={currentValue?.toString() ?? ''}
                            onValueChange={(val) => handleRollAssignment(ability, val)}
                          >
                            <SelectTrigger className="w-32">
                              <SelectValue placeholder="Select..." />
                            </SelectTrigger>
                            <SelectContent>
                              {available.map((val, idx) => (
                                <SelectItem key={`${val}-${idx}`} value={val.toString()}>
                                  {val}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <div className="w-24 text-right text-sm text-muted-foreground">
                            {currentValue !== null && `Modifier: ${formatModifier(currentValue)}`}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
