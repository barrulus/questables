import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '../ui/dialog';
import { ScrollArea } from '../ui/scroll-area';
import { Badge } from '../ui/badge';
import { MarkdownText } from './markdown-text';
import { SOURCE_DISPLAY_NAMES } from '../../utils/srd/field-mappings';
import type {
  SrdSpecies, SrdClass, SrdBackground, SrdSpell, SrdItem,
} from '../../utils/srd/types';

type EntityType = 'species' | 'class' | 'background' | 'spell' | 'item';
type EntityData = SrdSpecies | SrdClass | SrdBackground | SrdSpell | SrdItem;

interface SrdDetailModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entityType: EntityType;
  entity: EntityData | null;
}

export function SrdDetailModal({ open, onOpenChange, entityType, entity }: SrdDetailModalProps) {
  if (!entity) return null;

  const sourceName = SOURCE_DISPLAY_NAMES[entity.document_source] ?? entity.document_source;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh]">
        <DialogHeader>
          <DialogTitle>{entity.name}</DialogTitle>
          <DialogDescription>
            {sourceName}
          </DialogDescription>
        </DialogHeader>
        <ScrollArea className="max-h-[65vh] pr-4">
          {entityType === 'species' && <SpeciesDetail entity={entity as SrdSpecies} />}
          {entityType === 'class' && <ClassDetail entity={entity as SrdClass} />}
          {entityType === 'background' && <BackgroundDetail entity={entity as SrdBackground} />}
          {entityType === 'spell' && <SpellDetail entity={entity as SrdSpell} />}
          {entityType === 'item' && <ItemDetail entity={entity as SrdItem} />}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}

function SpeciesDetail({ entity }: { entity: SrdSpecies }) {
  const isSrd2024 = entity.document_source === 'srd-2024';

  // Group traits by type for srd-2024, show in natural order otherwise
  const traitsByType = new Map<string, typeof entity.traits>();
  if (isSrd2024) {
    for (const trait of entity.traits) {
      const type = trait.type || 'Other';
      if (!traitsByType.has(type)) traitsByType.set(type, []);
      traitsByType.get(type)!.push(trait);
    }
    // Sort within groups by order field
    for (const traits of traitsByType.values()) {
      traits.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    }
  }

  return (
    <div className="space-y-4">
      {entity.desc_text && (
        <MarkdownText text={entity.desc_text} className="text-sm text-muted-foreground" />
      )}

      {entity.traits.length > 0 && (
        <div>
          <h4 className="font-semibold mb-3">Racial Traits</h4>
          {isSrd2024 ? (
            // Grouped by type
            Array.from(traitsByType.entries()).map(([type, traits]) => (
              <div key={type} className="mb-4">
                <h5 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">{type}</h5>
                {traits.map((trait, idx) => (
                  <div key={idx} className="mb-3">
                    <h6 className="font-medium text-sm">{trait.name}</h6>
                    <MarkdownText text={trait.desc} className="text-sm text-muted-foreground" />
                  </div>
                ))}
              </div>
            ))
          ) : (
            // Natural order
            entity.traits.map((trait, idx) => (
              <div key={idx} className="mb-3">
                <h5 className="font-medium text-sm">{trait.name}</h5>
                <MarkdownText text={trait.desc} className="text-sm text-muted-foreground" />
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function ClassDetail({ entity }: { entity: SrdClass }) {
  const isA5e = entity.document_source === 'a5e-ag';

  return (
    <div className="space-y-4">
      {entity.desc_text && (
        <MarkdownText text={entity.desc_text} className="text-sm text-muted-foreground" />
      )}

      {entity.hit_dice && (
        <div>
          <h4 className="font-semibold mb-1">Hit Points</h4>
          <p className="text-sm text-muted-foreground">
            Hit Die: 1{entity.hit_dice} per level
          </p>
        </div>
      )}

      {entity.caster_type && entity.caster_type !== 'NONE' && (
        <div>
          <Badge variant="secondary">{entity.caster_type} Caster</Badge>
        </div>
      )}

      {entity.features.length > 0 && (
        <div>
          <h4 className="font-semibold mb-2">Class Features</h4>
          {entity.features.map((feature, idx) => (
            <div key={idx} className="mb-3">
              <div className="flex items-center gap-2">
                <h5 className="font-medium text-sm">{feature.name}</h5>
                {isA5e && feature.feature_type && (
                  <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                    {feature.feature_type}
                  </Badge>
                )}
                {feature.gained_at && feature.gained_at.length > 0 && (
                  <span className="text-xs text-muted-foreground">
                    (Lv. {feature.gained_at.map(g => g.level).join(', ')})
                  </span>
                )}
              </div>
              <MarkdownText text={feature.desc} className="text-sm text-muted-foreground" />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function BackgroundDetail({ entity }: { entity: SrdBackground }) {
  const isSrd2024 = entity.document_source === 'srd-2024';

  // Group benefits by type for srd-2024
  const benefitsByType = new Map<string, typeof entity.benefits>();
  if (isSrd2024) {
    for (const benefit of entity.benefits) {
      const type = benefit.type || 'Other';
      if (!benefitsByType.has(type)) benefitsByType.set(type, []);
      benefitsByType.get(type)!.push(benefit);
    }
  }

  return (
    <div className="space-y-4">
      {entity.desc_text && (
        <MarkdownText text={entity.desc_text} className="text-sm text-muted-foreground" />
      )}

      {entity.benefits.length > 0 && (
        <div>
          <h4 className="font-semibold mb-2">Benefits</h4>
          {isSrd2024 ? (
            Array.from(benefitsByType.entries()).map(([type, benefits]) => (
              <div key={type} className="mb-4">
                <h5 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                  {type.replace(/_/g, ' ')}
                </h5>
                {benefits.map((benefit, idx) => (
                  <div key={idx} className="mb-3">
                    <h6 className="font-medium text-sm">{benefit.name}</h6>
                    <MarkdownText text={benefit.desc} className="text-sm text-muted-foreground" />
                  </div>
                ))}
              </div>
            ))
          ) : (
            entity.benefits.map((benefit, idx) => (
              <div key={idx} className="mb-3">
                <h5 className="font-medium text-sm">{benefit.name}</h5>
                <MarkdownText text={benefit.desc} className="text-sm text-muted-foreground" />
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function SpellDetail({ entity }: { entity: SrdSpell }) {
  const components: string[] = [];
  if (entity.verbal) components.push('V');
  if (entity.somatic) components.push('S');
  if (entity.material) components.push('M');

  const levelText = entity.level === 0
    ? 'Cantrip'
    : `Level ${entity.level}`;

  return (
    <div className="space-y-4">
      {/* Stat block */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm border rounded-lg p-3 bg-muted/30">
        <div>
          <span className="text-muted-foreground">Level:</span>{' '}
          <span className="font-medium">{levelText}</span>
        </div>
        {entity.school_key && (
          <div>
            <span className="text-muted-foreground">School:</span>{' '}
            <span className="font-medium capitalize">{entity.school_key}</span>
          </div>
        )}
        {entity.casting_time && (
          <div>
            <span className="text-muted-foreground">Casting Time:</span>{' '}
            <span className="font-medium">{entity.casting_time}</span>
          </div>
        )}
        {entity.range_text && (
          <div>
            <span className="text-muted-foreground">Range:</span>{' '}
            <span className="font-medium">{entity.range_text}</span>
          </div>
        )}
        {components.length > 0 && (
          <div>
            <span className="text-muted-foreground">Components:</span>{' '}
            <span className="font-medium">{components.join(', ')}</span>
          </div>
        )}
        {entity.duration && (
          <div>
            <span className="text-muted-foreground">Duration:</span>{' '}
            <span className="font-medium">
              {entity.concentration ? 'Concentration, ' : ''}{entity.duration}
            </span>
          </div>
        )}
      </div>

      {entity.material_specified && (
        <p className="text-xs text-muted-foreground italic">
          Material: {entity.material_specified}
        </p>
      )}

      <div className="flex flex-wrap gap-1">
        {entity.ritual && <Badge variant="secondary">Ritual</Badge>}
        {entity.concentration && <Badge variant="secondary">Concentration</Badge>}
        {entity.attack_roll && <Badge variant="outline">Attack Roll</Badge>}
        {entity.saving_throw_ability && (
          <Badge variant="outline">Save: {entity.saving_throw_ability}</Badge>
        )}
      </div>

      {entity.desc_text && (
        <MarkdownText text={entity.desc_text} className="text-sm" />
      )}
    </div>
  );
}

function ItemDetail({ entity }: { entity: SrdItem }) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm border rounded-lg p-3 bg-muted/30">
        {entity.category_key && (
          <div>
            <span className="text-muted-foreground">Category:</span>{' '}
            <span className="font-medium capitalize">{entity.category_key.replace(/-/g, ' ')}</span>
          </div>
        )}
        {entity.cost && (
          <div>
            <span className="text-muted-foreground">Cost:</span>{' '}
            <span className="font-medium">{entity.cost} GP</span>
          </div>
        )}
        {entity.weight != null && entity.weight > 0 && (
          <div>
            <span className="text-muted-foreground">Weight:</span>{' '}
            <span className="font-medium">{entity.weight} {entity.weight_unit || 'lb'}</span>
          </div>
        )}
        {entity.requires_attunement && (
          <div>
            <span className="font-medium text-amber-600">Requires Attunement</span>
          </div>
        )}
      </div>

      {entity.desc_text && (
        <MarkdownText text={entity.desc_text} className="text-sm" />
      )}
    </div>
  );
}
