import { useLiveState } from "../../contexts/LiveStateContext";
import { Badge } from "../ui/badge";
import { Heart, Shield, Sparkles, CircleDot } from "lucide-react";

function hpColor(current: number, max: number): string {
  if (max === 0) return "bg-muted";
  const ratio = current / max;
  if (ratio > 0.5) return "bg-green-500";
  if (ratio > 0.25) return "bg-yellow-500";
  return "bg-red-500";
}

export function LiveStateBar() {
  const { myLiveState } = useLiveState();

  if (!myLiveState) return null;

  const hpPercent =
    myLiveState.hp_max > 0
      ? Math.round((myLiveState.hp_current / myLiveState.hp_max) * 100)
      : 0;

  return (
    <div className="flex items-center gap-3 px-4 py-1.5 border-b bg-card/50 text-sm">
      {/* HP bar */}
      <div className="flex items-center gap-1.5">
        <Heart className="h-3.5 w-3.5 text-red-500" />
        <div className="relative h-3 w-24 rounded-full bg-muted overflow-hidden">
          <div
            className={`absolute inset-y-0 left-0 rounded-full transition-all ${hpColor(
              myLiveState.hp_current,
              myLiveState.hp_max,
            )}`}
            style={{ width: `${hpPercent}%` }}
          />
        </div>
        <span className="text-xs tabular-nums">
          {myLiveState.hp_current}/{myLiveState.hp_max}
        </span>
        {myLiveState.hp_temporary > 0 && (
          <span className="text-xs text-blue-500 tabular-nums">
            +{myLiveState.hp_temporary}
          </span>
        )}
      </div>

      {/* Temp HP shield */}
      {myLiveState.hp_temporary > 0 && (
        <div className="flex items-center gap-1">
          <Shield className="h-3 w-3 text-blue-500" />
          <span className="text-xs text-blue-500">{myLiveState.hp_temporary}</span>
        </div>
      )}

      {/* Inspiration */}
      {myLiveState.inspiration && (
        <div className="flex items-center gap-1">
          <Sparkles className="h-3 w-3 text-yellow-500" />
          <span className="text-xs text-yellow-500">Inspired</span>
        </div>
      )}

      {/* Concentration */}
      {myLiveState.concentration && (
        <div className="flex items-center gap-1">
          <CircleDot className="h-3 w-3 text-purple-500" />
          <span className="text-xs text-purple-500">
            {myLiveState.concentration.spellName}
          </span>
        </div>
      )}

      {/* Conditions */}
      {myLiveState.conditions.length > 0 && (
        <div className="flex items-center gap-1">
          {myLiveState.conditions.map((cond) => (
            <Badge key={cond} variant="outline" className="text-[10px] px-1.5 py-0 h-4">
              {cond}
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}
