import { useState, useEffect } from 'react';
import { useWizard } from '../wizard-context';
import { fetchSpells } from '../../../utils/api/srd';
import type { SrdSpell } from '../../../utils/srd/types';
import { Card, CardContent, CardHeader, CardTitle } from '../../ui/card';
import { ScrollArea } from '../../ui/scroll-area';
import { Checkbox } from '../../ui/checkbox';
import { Label } from '../../ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../ui/tabs';

export function StepEquipmentSpells() {
  const { state, dispatch } = useWizard();
  const [spells, setSpells] = useState<SrdSpell[]>([]);
  const [loading, setLoading] = useState(false);
  const [isSpellcaster, setIsSpellcaster] = useState(false);
  const [cantripsKnown, setCantripsKnown] = useState(0);
  const [spellsKnown, setSpellsKnown] = useState(0);

  useEffect(() => {
    if (!state.classKey) return;

    const spellcastingClasses = ['wizard', 'cleric', 'druid', 'bard', 'sorcerer', 'warlock', 'paladin', 'ranger'];
    const caster = spellcastingClasses.some((c) => state.classKey?.toLowerCase().includes(c));
    setIsSpellcaster(caster);

    if (!caster) return;

    const controller = new AbortController();
    setLoading(true);

    fetchSpells({ source: state.sourceKey, class: state.classKey }, { signal: controller.signal })
      .then((data) => {
        if (!controller.signal.aborted) {
          setSpells(data);

          const key = state.classKey?.toLowerCase() ?? '';
          if (key.includes('wizard')) {
            setCantripsKnown(3); setSpellsKnown(6);
          } else if (key.includes('cleric') || key.includes('druid')) {
            setCantripsKnown(3); setSpellsKnown(999);
          } else if (key.includes('bard') || key.includes('sorcerer')) {
            setCantripsKnown(4); setSpellsKnown(2);
          } else if (key.includes('warlock')) {
            setCantripsKnown(2); setSpellsKnown(2);
          } else {
            setCantripsKnown(2); setSpellsKnown(2);
          }
        }
      })
      .catch((err) => {
        if (err instanceof Error && err.name === 'AbortError') return;
        console.error('Failed to load spells:', err);
      })
      .finally(() => setLoading(false));

    return () => controller.abort();
  }, [state.sourceKey, state.classKey]);

  const cantrips = spells.filter((s) => s.level === 0);
  const level1Spells = spells.filter((s) => s.level === 1);

  const handleCantripToggle = (spellKey: string, checked: boolean) => {
    const newCantrips = checked
      ? [...state.chosenCantrips, spellKey]
      : state.chosenCantrips.filter((s) => s !== spellKey);
    dispatch({ type: 'SET_CANTRIPS', cantrips: newCantrips });
  };

  const handleSpellToggle = (spellKey: string, checked: boolean) => {
    const newSpells = checked
      ? [...state.chosenSpells, spellKey]
      : state.chosenSpells.filter((s) => s !== spellKey);
    dispatch({ type: 'SET_SPELLS', spells: newSpells });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold mb-2">Equipment & Spells</h2>
        <p className="text-muted-foreground">
          Select your starting equipment and spells (if applicable).
        </p>
      </div>

      <Tabs defaultValue={isSpellcaster ? 'spells' : 'equipment'}>
        <TabsList>
          <TabsTrigger value="equipment">Equipment</TabsTrigger>
          {isSpellcaster && <TabsTrigger value="spells">Spells</TabsTrigger>}
        </TabsList>

        <TabsContent value="equipment">
          <Card>
            <CardHeader>
              <CardTitle>Starting Equipment</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  Your class provides you with starting equipment. Consult your class description
                  for the specific items you begin with, or work with your DM to purchase equipment
                  using your starting gold.
                </p>

                {state.classKey && (
                  <div className="p-4 bg-muted rounded-lg">
                    <h4 className="font-semibold mb-2">Class Equipment</h4>
                    <p className="text-sm text-muted-foreground">
                      Your {state.classKey} starting equipment will be provided according to the
                      class description.
                    </p>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {isSpellcaster && (
          <TabsContent value="spells">
            <Card>
              <CardHeader>
                <CardTitle>Choose Your Spells</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-6">
                  <div>
                    <h4 className="font-semibold mb-2">
                      Cantrips (Choose {cantripsKnown})
                    </h4>
                    <p className="text-xs text-muted-foreground mb-3">
                      Selected: {state.chosenCantrips.length} / {cantripsKnown}
                    </p>
                    <ScrollArea className="h-64">
                      <div className="space-y-2 pr-4">
                        {cantrips.map((spell) => (
                          <div key={spell.key} className="flex items-start space-x-2 p-2 hover:bg-muted rounded">
                            <Checkbox
                              id={`cantrip-${spell.key}`}
                              checked={state.chosenCantrips.includes(spell.key)}
                              onCheckedChange={(checked) =>
                                handleCantripToggle(spell.key, checked as boolean)
                              }
                              disabled={
                                !state.chosenCantrips.includes(spell.key) &&
                                state.chosenCantrips.length >= cantripsKnown
                              }
                            />
                            <div className="flex-1">
                              <Label htmlFor={`cantrip-${spell.key}`} className="text-sm font-medium cursor-pointer">
                                {spell.name}
                              </Label>
                              {spell.school_key && (
                                <p className="text-xs text-muted-foreground">{spell.school_key}</p>
                              )}
                              {spell.desc_text && (
                                <p className="text-xs text-muted-foreground mt-1">
                                  {spell.desc_text.substring(0, 100)}...
                                </p>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </ScrollArea>
                  </div>

                  {level1Spells.length > 0 && (
                    <div>
                      <h4 className="font-semibold mb-2">
                        1st Level Spells {spellsKnown < 999 && `(Choose ${spellsKnown})`}
                      </h4>
                      {spellsKnown < 999 && (
                        <p className="text-xs text-muted-foreground mb-3">
                          Selected: {state.chosenSpells.length} / {spellsKnown}
                        </p>
                      )}
                      <ScrollArea className="h-64">
                        <div className="space-y-2 pr-4">
                          {level1Spells.map((spell) => (
                            <div key={spell.key} className="flex items-start space-x-2 p-2 hover:bg-muted rounded">
                              <Checkbox
                                id={`spell-${spell.key}`}
                                checked={state.chosenSpells.includes(spell.key)}
                                onCheckedChange={(checked) =>
                                  handleSpellToggle(spell.key, checked as boolean)
                                }
                                disabled={
                                  !state.chosenSpells.includes(spell.key) &&
                                  state.chosenSpells.length >= spellsKnown &&
                                  spellsKnown < 999
                                }
                              />
                              <div className="flex-1">
                                <Label htmlFor={`spell-${spell.key}`} className="text-sm font-medium cursor-pointer">
                                  {spell.name}
                                </Label>
                                {spell.school_key && (
                                  <p className="text-xs text-muted-foreground">{spell.school_key}</p>
                                )}
                                {spell.desc_text && (
                                  <p className="text-xs text-muted-foreground mt-1">
                                    {spell.desc_text.substring(0, 100)}...
                                  </p>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      </ScrollArea>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
