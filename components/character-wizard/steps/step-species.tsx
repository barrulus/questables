import { useState } from 'react';
import { useWizard } from '../wizard-context';
import { useSrdData } from '../use-srd-data';
import { fetchSpecies } from '../../../utils/api/srd';
import type { SrdSpecies } from '../../../utils/srd/types';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../ui/select';
import { Label } from '../../ui/label';
import { Info } from 'lucide-react';
import { SrdEntityCard } from '../srd-entity-card';
import { SrdDetailModal } from '../srd-detail-modal';

export function StepSpecies() {
  const { state, dispatch } = useWizard();
  const source = state.documentSource;
  const { data: speciesList, loading } = useSrdData(
    (opts) => fetchSpecies({ source }, opts),
    [source],
  );
  const [selectedSpecies, setSelectedSpecies] = useState<SrdSpecies | null>(null);
  const [detailEntity, setDetailEntity] = useState<SrdSpecies | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);

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

  const getSummary = (s: SrdSpecies) => {
    // Prefer desc_text (a prose blurb) when available
    if (s.desc_text) {
      // Take just the first sentence for the compact card
      const first = s.desc_text.split(/\.(?:\s|$)/)[0];
      return first ? first.trim() + '.' : s.desc_text.trim();
    }
    // Fallback: list prominent trait names
    if (s.traits && s.traits.length > 0) {
      return s.traits.slice(0, 3).map(t => t.name).join(', ');
    }
    return '';
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold mb-2">Choose Your Species</h2>
        <p className="text-muted-foreground">
          Select the species for your character. Each species provides unique traits and abilities.
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
        {species
          .filter((s: SrdSpecies) => !s.is_subspecies)
          .map((s: SrdSpecies) => (
          <SrdEntityCard
            key={s.key}
            name={s.name}
            summary={getSummary(s)}
            documentSource={s.document_source}
            isSelected={selectedSpecies?.key === s.key}
            onSelect={() => handleSelectSpecies(s)}
            onInfoClick={() => { setDetailEntity(s); setDetailOpen(true); }}
          />
        ))}
      </div>

      {selectedSpecies?.subspecies && selectedSpecies.subspecies.length > 0 && (
        <div className="space-y-2">
          <Label htmlFor="subspecies-select">Choose a Subrace</Label>
          <div className="flex items-center gap-2">
            <Select
              value={state.subraceKey || ''}
              onValueChange={handleSelectSubspecies}
            >
              <SelectTrigger id="subspecies-select" className="flex-1">
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
            {state.subraceKey && (() => {
              const sub = selectedSpecies.subspecies!.find((s: SrdSpecies) => s.key === state.subraceKey);
              return sub ? (
                <button
                  type="button"
                  className="p-2 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                  onClick={() => { setDetailEntity(sub); setDetailOpen(true); }}
                  aria-label={`Details for ${sub.name}`}
                >
                  <Info className="h-4 w-4" />
                </button>
              ) : null;
            })()}
          </div>
        </div>
      )}

      <SrdDetailModal
        open={detailOpen}
        onOpenChange={setDetailOpen}
        entityType="species"
        entity={detailEntity}
      />
    </div>
  );
}
