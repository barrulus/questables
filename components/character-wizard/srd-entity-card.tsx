import { Info } from 'lucide-react';
import { Badge } from '../ui/badge';
import { SOURCE_DISPLAY_NAMES } from '../../utils/srd/field-mappings';

interface SrdEntityCardProps {
  name: string;
  summary: string;
  documentSource?: string;
  isSelected: boolean;
  onSelect: () => void;
  onInfoClick: () => void;
}

export function SrdEntityCard({
  name,
  summary,
  documentSource,
  isSelected,
  onSelect,
  onInfoClick,
}: SrdEntityCardProps) {
  return (
    <div
      className={`relative cursor-pointer rounded-lg border p-3 transition-all hover:shadow-md ${
        isSelected ? 'ring-2 ring-primary border-primary' : 'hover:border-muted-foreground/30'
      }`}
      onClick={onSelect}
    >
      <button
        type="button"
        className="absolute top-2 right-2 p-1 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
        onClick={(e) => {
          e.stopPropagation();
          onInfoClick();
        }}
        aria-label={`Details for ${name}`}
      >
        <Info className="h-4 w-4" />
      </button>

      <h3 className="font-semibold text-sm pr-7 leading-tight">{name}</h3>

      {summary && (
        <p className="text-xs text-muted-foreground mt-1 line-clamp-1">{summary}</p>
      )}

      {documentSource && (
        <Badge variant="outline" className="mt-2 text-[10px] px-1.5 py-0">
          {SOURCE_DISPLAY_NAMES[documentSource] ?? documentSource}
        </Badge>
      )}
    </div>
  );
}
