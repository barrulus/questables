import { useState } from 'react';
import { useWizard } from '../wizard-context';
import { useSrdData } from '../use-srd-data';
import { fetchBackgrounds } from '../../../utils/api/srd';
import type { SrdBackground } from '../../../utils/srd/types';
import { SrdEntityCard } from '../srd-entity-card';
import { SrdDetailModal } from '../srd-detail-modal';

export function StepBackground() {
  const { state, dispatch } = useWizard();
  const source = state.documentSource;
  const { data: backgroundsList, loading } = useSrdData(
    (opts) => fetchBackgrounds({ source }, opts),
    [source],
  );
  const [selectedBackground, setSelectedBackground] = useState<SrdBackground | null>(null);
  const [detailEntity, setDetailEntity] = useState<SrdBackground | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);

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

  const getSummary = (bg: SrdBackground) => {
    if (!bg.benefits || bg.benefits.length === 0) return '';
    return bg.benefits.slice(0, 2).map(b => b.name).join(', ');
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold mb-2">Choose Your Background</h2>
        <p className="text-muted-foreground">
          Your background represents your character's past and provides additional skills and features.
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
        {backgrounds.map((bg: SrdBackground) => (
          <SrdEntityCard
            key={bg.key}
            name={bg.name}
            summary={getSummary(bg)}
            documentSource={bg.document_source}
            isSelected={selectedBackground?.key === bg.key}
            onSelect={() => handleSelectBackground(bg)}
            onInfoClick={() => { setDetailEntity(bg); setDetailOpen(true); }}
          />
        ))}
      </div>

      <SrdDetailModal
        open={detailOpen}
        onOpenChange={setDetailOpen}
        entityType="background"
        entity={detailEntity}
      />
    </div>
  );
}
