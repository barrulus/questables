import { useState } from 'react';
import { useWizard } from '../wizard-context';
import { useSrdData } from '../use-srd-data';
import { fetchBackgrounds } from '../../../utils/api/srd';
import type { SrdBackground } from '../../../utils/srd/types';
import { Card, CardContent, CardHeader, CardTitle } from '../../ui/card';
import { ScrollArea } from '../../ui/scroll-area';

export function StepBackground() {
  const { state, dispatch } = useWizard();
  const { data: backgroundsList, loading } = useSrdData(
    (opts) => fetchBackgrounds(state.sourceKey, opts),
    [state.sourceKey],
  );
  const [selectedBackground, setSelectedBackground] = useState<SrdBackground | null>(null);

  const backgrounds = backgroundsList ?? [];

  // Restore selection when data loads
  if (backgrounds.length > 0 && state.backgroundKey && !selectedBackground) {
    const found = backgrounds.find((b: SrdBackground) => b.key === state.backgroundKey);
    if (found) setSelectedBackground(found);
  }

  const handleSelectBackground = (bg: SrdBackground) => {
    setSelectedBackground(bg);
    dispatch({ type: 'SET_BACKGROUND', backgroundKey: bg.key });
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
        <h2 className="text-2xl font-bold mb-2">Choose Your Background</h2>
        <p className="text-muted-foreground">
          Your background represents your character's past and provides additional skills and features.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {backgrounds.map((bg: SrdBackground) => (
          <Card
            key={bg.key}
            className={`cursor-pointer transition-all hover:shadow-lg ${
              selectedBackground?.key === bg.key ? 'ring-2 ring-primary' : ''
            }`}
            onClick={() => handleSelectBackground(bg)}
          >
            <CardHeader>
              <CardTitle>{bg.name}</CardTitle>
            </CardHeader>
            <CardContent>
              {bg.desc_text && (
                <p className="text-sm text-muted-foreground line-clamp-3">
                  {bg.desc_text}
                </p>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      {selectedBackground && (
        <Card>
          <CardHeader>
            <CardTitle>{selectedBackground.name}</CardTitle>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-96">
              <div className="space-y-4 pr-4">
                {selectedBackground.desc_text && (
                  <p className="text-sm text-muted-foreground">{selectedBackground.desc_text}</p>
                )}

                {selectedBackground.benefits.length > 0 && (
                  <div>
                    <h4 className="font-semibold mb-2">Benefits</h4>
                    {selectedBackground.benefits.map((benefit, idx) => (
                      <div key={idx} className="mb-3">
                        <h5 className="font-medium text-sm">{benefit.name}</h5>
                        <p className="text-sm text-muted-foreground">{benefit.desc}</p>
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
