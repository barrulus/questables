import { useState } from 'react';
import { useWizard } from '../wizard-context';
import { useSrdData } from '../use-srd-data';
import { fetchClasses } from '../../../utils/api/srd';
import type { SrdClass } from '../../../utils/srd/types';
import { SrdEntityCard } from '../srd-entity-card';
import { SrdDetailModal } from '../srd-detail-modal';

export function StepClass() {
  const { state, dispatch } = useWizard();
  const source = state.documentSource;
  const { data: classesList, loading } = useSrdData(
    (opts) => fetchClasses({ source }, opts),
    [source],
  );
  const [selectedClass, setSelectedClass] = useState<SrdClass | null>(null);
  const [detailEntity, setDetailEntity] = useState<SrdClass | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);

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

  const getSummary = (c: SrdClass) => {
    const parts: string[] = [];
    if (c.hit_dice) parts.push(c.hit_dice);
    if (c.caster_type && c.caster_type !== 'NONE') parts.push(`${c.caster_type} Caster`);
    return parts.join(' — ');
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold mb-2">Choose Your Class</h2>
        <p className="text-muted-foreground">
          Your class determines your abilities, skills, and role in the party.
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
        {baseClasses.map((c: SrdClass) => (
          <SrdEntityCard
            key={c.key}
            name={c.name}
            summary={getSummary(c)}
            documentSource={c.document_source}
            isSelected={selectedClass?.key === c.key}
            onSelect={() => handleSelectClass(c)}
            onInfoClick={() => { setDetailEntity(c); setDetailOpen(true); }}
          />
        ))}
      </div>

      <SrdDetailModal
        open={detailOpen}
        onOpenChange={setDetailOpen}
        entityType="class"
        entity={detailEntity}
      />
    </div>
  );
}
