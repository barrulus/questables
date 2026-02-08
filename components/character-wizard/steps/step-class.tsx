import { useState } from 'react';
import { useWizard } from '../wizard-context';
import { useSrdData } from '../use-srd-data';
import { fetchClasses } from '../../../utils/api/srd';
import type { SrdClass } from '../../../utils/srd/types';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../ui/card';
import { Badge } from '../../ui/badge';
import { ScrollArea } from '../../ui/scroll-area';

export function StepClass() {
  const { state, dispatch } = useWizard();
  const { data: classesList, loading } = useSrdData(
    (opts) => fetchClasses(state.sourceKey, opts),
    [state.sourceKey],
  );
  const [selectedClass, setSelectedClass] = useState<SrdClass | null>(null);

  const baseClasses = (classesList ?? []).filter((c: SrdClass) => !c.subclass_of_key);

  // Restore selection when data loads
  if (baseClasses.length > 0 && state.classKey && !selectedClass) {
    const found = baseClasses.find((c: SrdClass) => c.key === state.classKey);
    if (found) setSelectedClass(found);
  }

  const handleSelectClass = (c: SrdClass) => {
    setSelectedClass(c);
    dispatch({ type: 'SET_CLASS', classKey: c.key });
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
        <h2 className="text-2xl font-bold mb-2">Choose Your Class</h2>
        <p className="text-muted-foreground">
          Your class determines your abilities, skills, and role in the party.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {baseClasses.map((c: SrdClass) => (
          <Card
            key={c.key}
            className={`cursor-pointer transition-all hover:shadow-lg ${
              selectedClass?.key === c.key ? 'ring-2 ring-primary' : ''
            }`}
            onClick={() => handleSelectClass(c)}
          >
            <CardHeader>
              <CardTitle>{c.name}</CardTitle>
              <CardDescription>
                {c.hit_dice && `Hit Die: ${c.hit_dice}`}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {c.caster_type && c.caster_type !== 'NONE' && (
                  <Badge variant="secondary">{c.caster_type} Caster</Badge>
                )}
                {c.saving_throws_list && c.saving_throws_list.length > 0 && (
                  <div>
                    <div className="text-sm font-medium mb-1">Saving Throws:</div>
                    <div className="flex flex-wrap gap-1">
                      {c.saving_throws_list.map((save) => (
                        <Badge key={save.ability_key} variant="outline">
                          {save.ability_key}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {selectedClass && (
        <Card>
          <CardHeader>
            <CardTitle>{selectedClass.name} Details</CardTitle>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-96">
              <div className="space-y-4 pr-4">
                {selectedClass.desc_text && (
                  <p className="text-sm text-muted-foreground">{selectedClass.desc_text}</p>
                )}

                {selectedClass.hit_dice && (
                  <div>
                    <h4 className="font-semibold mb-1">Hit Points</h4>
                    <p className="text-sm text-muted-foreground">
                      Hit Die: 1{selectedClass.hit_dice} per level
                    </p>
                  </div>
                )}

                {selectedClass.features.length > 0 && (
                  <div>
                    <h4 className="font-semibold mb-2">Class Features</h4>
                    {selectedClass.features
                      .filter((f) => f.gained_at?.some((g) => g.level === 1))
                      .map((feature, idx) => (
                        <div key={idx} className="mb-3">
                          <h5 className="font-medium text-sm">{feature.name}</h5>
                          <p className="text-sm text-muted-foreground">{feature.desc}</p>
                        </div>
                      ))}
                  </div>
                )}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
