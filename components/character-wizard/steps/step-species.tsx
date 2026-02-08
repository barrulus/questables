import { useState } from 'react';
import { useWizard } from '../wizard-context';
import { useSrdData } from '../use-srd-data';
import { fetchSpecies } from '../../../utils/api/srd';
import type { SrdSpecies } from '../../../utils/srd/types';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../ui/card';
import { ScrollArea } from '../../ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../ui/select';
import { Label } from '../../ui/label';
import { MarkdownText } from '../markdown-text';

export function StepSpecies() {
  const { state, dispatch } = useWizard();
  const { data: speciesList, loading } = useSrdData(
    (opts) => fetchSpecies(state.sourceKey, opts),
    [state.sourceKey],
  );
  const [selectedSpecies, setSelectedSpecies] = useState<SrdSpecies | null>(null);

  // Restore selection when data loads
  if (speciesList && state.speciesKey && !selectedSpecies) {
    const found = speciesList.find((s: SrdSpecies) => s.key === state.speciesKey);
    if (found) setSelectedSpecies(found);
  }

  const handleSelectSpecies = (s: SrdSpecies) => {
    setSelectedSpecies(s);
    dispatch({
      type: 'SET_SPECIES',
      speciesKey: s.key,
      subraceKey: s.subspecies && s.subspecies.length > 0 ? null : undefined,
    });
  };

  const handleSelectSubspecies = (subraceKey: string) => {
    dispatch({ type: 'SET_SUBRACE', subraceKey });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  const species = speciesList ?? [];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold mb-2">Choose Your Species</h2>
        <p className="text-muted-foreground">
          Select the species for your character. Each species provides unique traits and abilities.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {species
          .filter((s: SrdSpecies) => !s.is_subspecies)
          .map((s: SrdSpecies) => (
          <Card
            key={s.key}
            className={`cursor-pointer transition-all hover:shadow-lg ${
              selectedSpecies?.key === s.key ? 'ring-2 ring-primary' : ''
            }`}
            onClick={() => handleSelectSpecies(s)}
          >
            <CardHeader>
              <CardTitle>{s.name}</CardTitle>
              {s.source_key && (
                <CardDescription>{s.source_key}</CardDescription>
              )}
            </CardHeader>
            <CardContent>
              {s.desc_text && (
                <MarkdownText text={s.desc_text} className="text-sm text-muted-foreground line-clamp-3" />
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      {selectedSpecies && (
        <Card>
          <CardHeader>
            <CardTitle>{selectedSpecies.name} Traits</CardTitle>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-64">
              <div className="space-y-4 pr-4">
                {selectedSpecies.desc_text && (
                  <MarkdownText text={selectedSpecies.desc_text} className="text-sm text-muted-foreground" />
                )}

                {selectedSpecies.traits.length > 0 && (
                  <div>
                    <h4 className="font-semibold mb-2">Racial Traits</h4>
                    {selectedSpecies.traits.map((trait, idx) => (
                      <div key={idx} className="mb-3">
                        <h5 className="font-medium text-sm">{trait.name}</h5>
                        <MarkdownText text={trait.desc} className="text-sm text-muted-foreground" />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
      )}

      {selectedSpecies?.subspecies && selectedSpecies.subspecies.length > 0 && (
        <div className="space-y-2">
          <Label htmlFor="subspecies-select">Choose a Subrace</Label>
          <Select
            value={state.subraceKey || ''}
            onValueChange={handleSelectSubspecies}
          >
            <SelectTrigger id="subspecies-select">
              <SelectValue placeholder="Select a subrace..." />
            </SelectTrigger>
            <SelectContent>
              {selectedSpecies.subspecies.map((sub: SrdSpecies) => (
                <SelectItem key={sub.key} value={sub.key}>
                  {sub.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {state.subraceKey && (
            <Card className="mt-4">
              <CardHeader>
                <CardTitle>
                  {selectedSpecies.subspecies.find((s: SrdSpecies) => s.key === state.subraceKey)?.name}
                </CardTitle>
              </CardHeader>
              <CardContent>
                {(() => {
                  const desc = selectedSpecies.subspecies.find((s: SrdSpecies) => s.key === state.subraceKey)?.desc_text;
                  return desc ? <MarkdownText text={desc} className="text-sm text-muted-foreground" /> : null;
                })()}
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
