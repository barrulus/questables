import { Badge } from "../ui/badge";
import type { SrdItem } from "../../utils/srd/types";

interface ItemDetailCardProps {
  item: SrdItem;
}

export function ItemDetailCard({ item }: ItemDetailCardProps) {
  return (
    <div className="space-y-3 p-3 bg-muted/50 rounded-md text-sm">
      <div className="flex items-center gap-2 flex-wrap">
        {item.category_key && (
          <Badge variant="secondary">{item.category_key.replace(/-/g, " ")}</Badge>
        )}
        {item.rarity_key && item.rarity_key !== "common" && (
          <Badge variant="outline" className="capitalize">{item.rarity_key}</Badge>
        )}
        {item.requires_attunement && (
          <Badge variant="destructive">Attunement</Badge>
        )}
      </div>

      <div className="flex gap-4 text-muted-foreground">
        {item.cost && <span>{item.cost} GP</span>}
        {item.weight != null && <span>{item.weight} {item.weight_unit ?? "lb"}</span>}
      </div>

      {item.desc_text && (
        <p className="whitespace-pre-wrap text-muted-foreground leading-relaxed">
          {item.desc_text}
        </p>
      )}
    </div>
  );
}
