import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Check, Clock, Loader2, X } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { Button } from "../ui/button";
import { Badge } from "../ui/badge";
import { apiFetch, readErrorMessage, readJsonBody } from "../../utils/api-client";

interface PendingPlayer {
  id: string;
  userId: string;
  username: string | null;
  characterId: string | null;
  characterName: string | null;
  joinedAt: string | null;
}

interface PendingApprovalsPanelProps {
  campaignId: string;
  maxPlayers: number;
  currentPlayers: number;
  onChanged?: () => Promise<void> | void;
}

interface RawPendingPlayer {
  id?: string;
  user_id?: string;
  userId?: string;
  username?: string | null;
  character_id?: string | null;
  characterId?: string | null;
  character_name?: string | null;
  characterName?: string | null;
  joined_at?: string | null;
  joinedAt?: string | null;
}

const mapPending = (raw: RawPendingPlayer): PendingPlayer | null => {
  const userId = raw.user_id ?? raw.userId;
  if (!userId || !raw.id) return null;
  return {
    id: raw.id,
    userId,
    username: raw.username ?? null,
    characterId: raw.character_id ?? raw.characterId ?? null,
    characterName: raw.character_name ?? raw.characterName ?? null,
    joinedAt: raw.joined_at ?? raw.joinedAt ?? null,
  };
};

const formatDate = (value: string | null): string => {
  if (!value) return "Unknown";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return date.toLocaleString();
};

export function PendingApprovalsPanel({
  campaignId,
  maxPlayers,
  currentPlayers,
  onChanged,
}: PendingApprovalsPanelProps) {
  const [pending, setPending] = useState<PendingPlayer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actingUserId, setActingUserId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await apiFetch(
        `/api/campaigns/${campaignId}/players/pending`,
      );
      if (!response.ok) {
        throw new Error(
          await readErrorMessage(response, "Failed to load pending requests"),
        );
      }
      const body = await readJsonBody<{ pendingPlayers?: RawPendingPlayer[] }>(
        response,
      );
      const list = (body.pendingPlayers ?? [])
        .map(mapPending)
        .filter((entry): entry is PendingPlayer => entry !== null);
      setPending(list);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to load pending requests";
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [campaignId]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleApprove = useCallback(
    async (player: PendingPlayer) => {
      if (actingUserId) return;
      if (currentPlayers >= maxPlayers) {
        toast.error("Campaign is full. Increase max players before approving.");
        return;
      }
      try {
        setActingUserId(player.userId);
        const response = await apiFetch(
          `/api/campaigns/${campaignId}/players/${player.userId}/approve`,
          { method: "PATCH" },
        );
        if (!response.ok) {
          throw new Error(
            await readErrorMessage(response, "Failed to approve player"),
          );
        }
        toast.success(
          player.username
            ? `Approved ${player.username}.`
            : "Approved join request.",
        );
        await load();
        await onChanged?.();
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "Failed to approve player",
        );
      } finally {
        setActingUserId(null);
      }
    },
    [actingUserId, campaignId, currentPlayers, maxPlayers, load, onChanged],
  );

  const handleReject = useCallback(
    async (player: PendingPlayer) => {
      if (actingUserId) return;
      try {
        setActingUserId(player.userId);
        const response = await apiFetch(
          `/api/campaigns/${campaignId}/players/${player.userId}/reject`,
          { method: "PATCH" },
        );
        if (!response.ok) {
          throw new Error(
            await readErrorMessage(response, "Failed to reject player"),
          );
        }
        toast.success(
          player.username
            ? `Rejected ${player.username}.`
            : "Rejected join request.",
        );
        await load();
        await onChanged?.();
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "Failed to reject player",
        );
      } finally {
        setActingUserId(null);
      }
    },
    [actingUserId, campaignId, load, onChanged],
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Clock className="w-5 h-5" />
          Pending Join Requests
          {pending.length > 0 && (
            <Badge variant="secondary">{pending.length}</Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin" />
            Loading pending requests…
          </div>
        ) : error ? (
          <p className="text-sm text-destructive">{error}</p>
        ) : pending.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No pending join requests.
          </p>
        ) : (
          pending.map((player) => {
            const isBusy = actingUserId === player.userId;
            return (
              <div
                key={player.id}
                className="flex items-start justify-between gap-3 rounded-md border p-3"
              >
                <div className="flex-1">
                  <p className="font-medium">
                    {player.username ?? "Unknown player"}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {player.characterName
                      ? `Character: ${player.characterName}`
                      : "No character selected"}
                    {" • Requested "}
                    {formatDate(player.joinedAt)}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    onClick={() => void handleApprove(player)}
                    disabled={isBusy}
                  >
                    {isBusy ? (
                      <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                    ) : (
                      <Check className="w-4 h-4 mr-1" />
                    )}
                    Approve
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void handleReject(player)}
                    disabled={isBusy}
                  >
                    <X className="w-4 h-4 mr-1" />
                    Reject
                  </Button>
                </div>
              </div>
            );
          })
        )}
      </CardContent>
    </Card>
  );
}
