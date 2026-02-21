import { Badge } from "../ui/badge";
import type { SrdSpell } from "../../utils/srd/types";

interface SpellDetailCardProps {
  spell: SrdSpell;
}

function schoolLabel(key: string | null): string {
  if (!key) return "Unknown";
  return key.charAt(0).toUpperCase() + key.slice(1);
}

function levelLabel(level: number): string {
  if (level === 0) return "Cantrip";
  const suffix = level === 1 ? "st" : level === 2 ? "nd" : level === 3 ? "rd" : "th";
  return `${level}${suffix} level`;
}

function components(spell: SrdSpell): string {
  const parts: string[] = [];
  if (spell.verbal) parts.push("V");
  if (spell.somatic) parts.push("S");
  if (spell.material) parts.push("M");
  return parts.join(", ");
}

export function SpellDetailCard({ spell }: SpellDetailCardProps) {
  return (
    <div className="space-y-3 p-3 bg-muted/50 rounded-md text-sm">
      <div className="flex items-center gap-2 flex-wrap">
        <Badge variant="secondary">
          {levelLabel(spell.level)} {schoolLabel(spell.school_key)}
        </Badge>
        {spell.concentration && <Badge variant="outline">Concentration</Badge>}
        {spell.ritual && <Badge variant="outline">Ritual</Badge>}
      </div>

      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-muted-foreground">
        <div><span className="font-medium text-foreground">Casting Time:</span> {spell.casting_time ?? "—"}</div>
        <div><span className="font-medium text-foreground">Range:</span> {spell.range_text ?? "—"}</div>
        <div><span className="font-medium text-foreground">Components:</span> {components(spell)}</div>
        <div><span className="font-medium text-foreground">Duration:</span> {spell.duration ?? "—"}</div>
      </div>

      {spell.material_specified && (
        <p className="text-xs text-muted-foreground italic">
          Material: {spell.material_specified}
        </p>
      )}

      {spell.damage_roll && (
        <div className="flex items-center gap-2">
          <span className="font-medium">Damage:</span>
          <span>{spell.damage_roll}</span>
          {spell.damage_types?.length > 0 && (
            <Badge variant="destructive" className="text-xs">{spell.damage_types.join(", ")}</Badge>
          )}
        </div>
      )}

      {spell.saving_throw_ability && (
        <div>
          <span className="font-medium">Save:</span>{" "}
          <span className="uppercase">{spell.saving_throw_ability}</span>
        </div>
      )}

      {spell.desc_text && (
        <p className="whitespace-pre-wrap text-muted-foreground leading-relaxed">
          {spell.desc_text}
        </p>
      )}
    </div>
  );
}
