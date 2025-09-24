import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";
import { Badge } from "./ui/badge";
import { Label } from "./ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from "./ui/command";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { cn } from "./ui/utils";
import { useUser } from "../contexts/UserContext";
import { apiFetch, readErrorMessage, readJsonBody } from "../utils/api-client";
import { handleAsyncError } from "../utils/error-handling";
import { toast } from "sonner";
import {
  Play,
  Square,
  Clock,
  Users,
  Calendar,
  Trophy,
  Loader2,
  Plus,
  UserPlus,
  Trash2,
  ChevronsUpDown,
  Check,
  RefreshCw,
} from "lucide-react";

interface Session {
  id: string;
  campaign_id: string;
  session_number: number;
  title: string;
  summary?: string;
  dm_notes?: string;
  scheduled_at?: string;
  started_at?: string;
  ended_at?: string;
  duration?: number;
  status: 'scheduled' | 'active' | 'completed' | 'cancelled';
  participant_count: number;
  experience_awarded?: number;
}

interface SessionParticipant {
  id: string;
  session_id: string;
  user_id: string;
  character_id: string;
  character_name: string;
  username: string;
  character_level_start: number;
  character_level_end: number;
  attendance_status: 'present' | 'absent' | 'late' | 'left_early';
}

interface CampaignMember {
  id: string;
  campaign_player_id: string | null;
  user_id: string;
  username: string;
  character_id: string | null;
  character_name: string | null;
  character_level: number | null;
  role: 'player' | 'co-dm';
}

const ATTENDANCE_OPTIONS: readonly SessionParticipant['attendance_status'][] = [
  'present',
  'absent',
  'late',
  'left_early',
];

const formatAttendanceLabel = (value: SessionParticipant['attendance_status']): string =>
  value
    .split('_')
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(' ');

const clampLevel = (value: number): number => {
  if (!Number.isFinite(value)) {
    return 1;
  }
  const rounded = Math.round(value);
  return Math.min(20, Math.max(1, rounded));
};

export default function SessionManager({ campaignId, isDM }: { campaignId: string; isDM: boolean }) {
  const { user } = useUser();

  const [sessions, setSessions] = useState<Session[]>([]);
  const [sessionsError, setSessionsError] = useState<string | null>(null);
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const [sessionsRefreshing, setSessionsRefreshing] = useState(false);

  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);

  const [participants, setParticipants] = useState<SessionParticipant[]>([]);
  const [participantsLoading, setParticipantsLoading] = useState(false);
  const [participantsError, setParticipantsError] = useState<string | null>(null);

  const [availableMembers, setAvailableMembers] = useState<CampaignMember[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const [membersError, setMembersError] = useState<string | null>(null);
  const [memberPickerOpen, setMemberPickerOpen] = useState(false);
  const [selectedMemberId, setSelectedMemberId] = useState<string>('');
  const [selectedCharacterId, setSelectedCharacterId] = useState<string>('');
  const [selectedLevel, setSelectedLevel] = useState<number>(1);
  const [selectedAttendance, setSelectedAttendance] = useState<SessionParticipant['attendance_status']>('present');
  const [participantBusy, setParticipantBusy] = useState(false);
  const [participantDrafts, setParticipantDrafts] = useState<Record<string, { attendance: SessionParticipant['attendance_status']; level: number }>>({});
  const [updatingParticipantId, setUpdatingParticipantId] = useState<string | null>(null);
  const [removingParticipantId, setRemovingParticipantId] = useState<string | null>(null);

  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newSessionTitle, setNewSessionTitle] = useState("");
  const [newSessionSummary, setNewSessionSummary] = useState("");
  const [newSessionNotes, setNewSessionNotes] = useState("");
  const [newSessionScheduled, setNewSessionScheduled] = useState("");
  const [createBusy, setCreateBusy] = useState(false);

  const [showEndForm, setShowEndForm] = useState(false);
  const [sessionSummary, setSessionSummary] = useState("");
  const [experienceAwarded, setExperienceAwarded] = useState<number>(0);
  const [endBusy, setEndBusy] = useState(false);

  const isMountedRef = useRef(true);

  const selectedSession = useMemo(() => sessions.find((session) => session.id === selectedSessionId) ?? null, [sessions, selectedSessionId]);

  const formatDuration = useCallback((minutes: number) => {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
  }, []);

  const formatDateTime = useCallback((dateString: string) => new Date(dateString).toLocaleString(), []);

  const canMutate = Boolean(user && isDM);

  const selectedMember = useMemo(
    () => availableMembers.find((member) => member.id === selectedMemberId) ?? null,
    [availableMembers, selectedMemberId]
  );

  const unusedMembers = useMemo(() => {
    if (!availableMembers.length) {
      return [] as CampaignMember[];
    }
    const participantUserIds = new Set(participants.map((participant) => participant.user_id));
    return availableMembers.filter((member) => !participantUserIds.has(member.user_id));
  }, [availableMembers, participants]);

  useEffect(() => {
    setParticipantDrafts((previous) => {
      const next: Record<string, { attendance: SessionParticipant['attendance_status']; level: number }> = {};
      participants.forEach((participant) => {
        const prior = previous[participant.id];
        next[participant.id] = {
          attendance: prior?.attendance ?? participant.attendance_status,
          level: prior?.level ?? clampLevel(participant.character_level_start),
        };
      });
      return next;
    });
  }, [participants]);

  const loadSessions = useCallback(
    async ({ signal, showSpinner }: { signal?: AbortSignal; showSpinner: boolean }) => {
      if (!campaignId) {
        return;
      }

      try {
        if (showSpinner) {
          setSessionsLoading(true);
        } else {
          setSessionsRefreshing(true);
        }
        setSessionsError(null);

        const response = await apiFetch(`/api/campaigns/${campaignId}/sessions`, { signal });
        if (!response.ok) {
          throw new Error(await readErrorMessage(response, "Failed to load sessions"));
        }

        const payload = await readJsonBody<Session[]>(response);
        setSessions(payload ?? []);

        if (!selectedSessionId || !(payload ?? []).some((session) => session.id === selectedSessionId)) {
          const nextSession = payload?.[0] ?? null;
          setSelectedSessionId(nextSession?.id ?? null);
        }
      } catch (loadError) {
        if (loadError instanceof DOMException && loadError.name === "AbortError") {
          return;
        }
        const message = handleAsyncError(loadError);
        setSessionsError(message);
        console.error("Failed to load sessions:", loadError);
      } finally {
        if (isMountedRef.current) {
          setSessionsLoading(false);
          setSessionsRefreshing(false);
        }
      }
    },
    [campaignId, selectedSessionId]
  );

  const loadParticipants = useCallback(
    async (sessionId: string, signal?: AbortSignal) => {
      if (!sessionId) {
        return;
      }

      try {
        setParticipantsLoading(true);
        setParticipantsError(null);

        const response = await apiFetch(`/api/sessions/${sessionId}/participants`, { signal });
        if (!response.ok) {
          throw new Error(await readErrorMessage(response, "Failed to load participants"));
        }

        const payload = await readJsonBody<SessionParticipant[]>(response);
        setParticipants(payload ?? []);
      } catch (loadError) {
        if (loadError instanceof DOMException && loadError.name === "AbortError") {
          return;
        }
        const message = handleAsyncError(loadError);
        setParticipantsError(message);
        console.error("Failed to load participants:", loadError);
      } finally {
        if (isMountedRef.current) {
          setParticipantsLoading(false);
        }
      }
    },
    []
  );

  const loadCampaignMembers = useCallback(
    async (signal?: AbortSignal) => {
      if (!campaignId) {
        setAvailableMembers([]);
        setMembersError(null);
        return;
      }

      try {
        setMembersLoading(true);
        setMembersError(null);

        const response = await apiFetch(`/api/campaigns/${campaignId}/players`, { signal });
        if (!response.ok) {
          throw new Error(await readErrorMessage(response, 'Failed to load campaign players'));
        }

        const payload = await readJsonBody<Array<Record<string, unknown>>>(response);
        if (!Array.isArray(payload)) {
          setAvailableMembers([]);
          return;
        }

        const normalized = payload
          .map((row) => {
            if (!row || typeof row !== 'object') {
              return null;
            }

            const member = row as Record<string, unknown>;
            const membershipId = typeof member.campaign_player_id === 'string' ? member.campaign_player_id : null;
            const userId = typeof member.campaign_user_id === 'string'
              ? member.campaign_user_id
              : typeof member.user_id === 'string'
                ? member.user_id
                : null;
            const usernameRaw = typeof member.username === 'string' ? member.username.trim() : '';
            if (!userId || !usernameRaw) {
              return null;
            }

            const characterId = typeof member.character_id === 'string' ? member.character_id : null;
            const characterNameRaw = typeof member.name === 'string' && member.name.trim()
              ? member.name.trim()
              : typeof member.character_name === 'string' && member.character_name.trim()
                ? (member.character_name as string).trim()
                : null;
            const levelCandidate = Number(member.level ?? member.character_level_start ?? member.character_level);
            const characterLevel = Number.isFinite(levelCandidate)
              ? Math.min(20, Math.max(1, Number(levelCandidate)))
              : null;
            const role = member.role === 'co-dm' ? 'co-dm' : 'player';
            const idSource = membershipId ?? (characterId ?? userId);

            return {
              id: String(idSource),
              campaign_player_id: membershipId,
              user_id: String(userId),
              username: usernameRaw,
              character_id: characterId,
              character_name: characterNameRaw,
              character_level: characterLevel,
              role,
            } satisfies CampaignMember;
          })
          .filter((entry): entry is CampaignMember => Boolean(entry));

        setAvailableMembers(normalized);
      } catch (loadError) {
        if (loadError instanceof DOMException && loadError.name === 'AbortError') {
          return;
        }
        const message = handleAsyncError(loadError);
        setMembersError(message);
        console.error('Failed to load campaign players:', loadError);
      } finally {
        if (isMountedRef.current) {
          setMembersLoading(false);
        }
      }
    },
    [campaignId]
  );

  const refreshSessions = useCallback(() => loadSessions({ showSpinner: false }), [loadSessions]);

  const handleParticipantAttendanceChange = useCallback((participantId: string, value: SessionParticipant['attendance_status']) => {
    setParticipantDrafts((previous) => {
      const existing = previous[participantId] ?? {
        attendance: value,
        level: 1,
      };
      return {
        ...previous,
        [participantId]: {
          attendance: value,
          level: existing.level,
        },
      };
    });
  }, []);

  const handleParticipantLevelChange = useCallback((participantId: string, value: number) => {
    setParticipantDrafts((previous) => {
      const existing = previous[participantId] ?? {
        attendance: 'present' as SessionParticipant['attendance_status'],
        level: 1,
      };
      return {
        ...previous,
        [participantId]: {
          attendance: existing.attendance,
          level: clampLevel(value),
        },
      };
    });
  }, []);

  const handleAddParticipant = useCallback(async () => {
    if (!canMutate || !selectedSession) {
      toast.error('Select a session before adding participants.');
      return;
    }

    if (!selectedMemberId) {
      toast.error('Select a campaign member to add.');
      return;
    }

    const member = availableMembers.find((candidate) => candidate.id === selectedMemberId);
    if (!member) {
      toast.error('Selected member is no longer available.');
      return;
    }

    if (!member.character_id) {
      toast.error('Assign an active character to this player before adding them to the session.');
      return;
    }

    const payload = {
      user_id: member.user_id,
      character_id: member.character_id,
      character_level_start: clampLevel(selectedLevel),
      attendance_status: selectedAttendance,
    };

    try {
      setParticipantBusy(true);
      const response = await apiFetch(`/api/sessions/${selectedSession.id}/participants`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        throw new Error(await readErrorMessage(response, 'Failed to add participant'));
      }

      toast.success('Participant added to session.');
      setSelectedAttendance('present');
      setSelectedMemberId('');
      await loadParticipants(selectedSession.id);
      await refreshSessions();
    } catch (error) {
      const message = handleAsyncError(error);
      toast.error(message);
      console.error('Failed to add session participant:', error);
    } finally {
      setParticipantBusy(false);
    }
  }, [availableMembers, canMutate, loadParticipants, refreshSessions, selectedAttendance, selectedLevel, selectedMemberId, selectedSession]);

  const handleSaveParticipant = useCallback(
    async (participantId: string) => {
      const participant = participants.find((entry) => entry.id === participantId);
      if (!participant || !canMutate) {
        return;
      }

      const draft = participantDrafts[participantId] ?? {
        attendance: participant.attendance_status,
        level: participant.character_level_start,
      };

      try {
        setUpdatingParticipantId(participantId);
        const response = await apiFetch(`/api/sessions/${participant.session_id}/participants`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            user_id: participant.user_id,
            character_id: participant.character_id,
            character_level_start: clampLevel(draft.level),
            attendance_status: draft.attendance,
          }),
        });

        if (!response.ok) {
          throw new Error(await readErrorMessage(response, 'Failed to update participant'));
        }

        toast.success('Participant updated.');
        await loadParticipants(participant.session_id);
        await refreshSessions();
      } catch (error) {
        const message = handleAsyncError(error);
        toast.error(message);
        console.error('Failed to update session participant:', error);
      } finally {
        setUpdatingParticipantId(null);
      }
    },
    [canMutate, loadParticipants, participantDrafts, participants, refreshSessions]
  );

  const handleRemoveParticipant = useCallback(
    async (participantId: string) => {
      const participant = participants.find((entry) => entry.id === participantId);
      if (!participant || !canMutate) {
        return;
      }

      try {
        setRemovingParticipantId(participantId);
        const response = await apiFetch(`/api/sessions/${participant.session_id}/participants/${participant.user_id}`, {
          method: 'DELETE',
        });

        if (!response.ok) {
          throw new Error(await readErrorMessage(response, 'Failed to remove participant'));
        }

        toast.success('Participant removed from session.');
        await loadParticipants(participant.session_id);
        await refreshSessions();
      } catch (error) {
        const message = handleAsyncError(error);
        toast.error(message);
        console.error('Failed to remove session participant:', error);
      } finally {
        setRemovingParticipantId(null);
      }
    },
    [canMutate, loadParticipants, participants, refreshSessions]
  );

  useEffect(() => {
    isMountedRef.current = true;
    const controller = new AbortController();
    loadSessions({ signal: controller.signal, showSpinner: true });
    return () => {
      isMountedRef.current = false;
      controller.abort();
    };
  }, [loadSessions, campaignId]);

  useEffect(() => {
    if (!canMutate || !campaignId) {
      return;
    }
    const controller = new AbortController();
    loadCampaignMembers(controller.signal);
    return () => controller.abort();
  }, [canMutate, campaignId, loadCampaignMembers]);

  useEffect(() => {
    if (!selectedSession) {
      setParticipants([]);
      setParticipantsError(null);
      return;
    }

    const controller = new AbortController();
    loadParticipants(selectedSession.id, controller.signal);
    return () => controller.abort();
  }, [loadParticipants, selectedSession]);

  useEffect(() => {
    if (!canMutate) {
      return;
    }

    if (unusedMembers.length === 0) {
      setSelectedMemberId('');
      setSelectedCharacterId('');
      return;
    }

    if (!selectedMemberId || !unusedMembers.some((member) => member.id === selectedMemberId)) {
      const nextMember = unusedMembers[0];
      setSelectedMemberId(nextMember.id);
      setSelectedCharacterId(nextMember.character_id ?? '');
      setSelectedLevel(clampLevel(nextMember.character_level ?? 1));
      setSelectedAttendance('present');
    }
  }, [canMutate, unusedMembers, selectedMemberId]);

  useEffect(() => {
    if (!selectedMember) {
      setSelectedCharacterId('');
      return;
    }
    setSelectedCharacterId(selectedMember.character_id ?? '');
    setSelectedLevel(clampLevel(selectedMember.character_level ?? 1));
    setSelectedAttendance('present');
  }, [selectedMember]);

  const resetCreateForm = useCallback(() => {
    setNewSessionTitle("");
    setNewSessionSummary("");
    setNewSessionNotes("");
    setNewSessionScheduled("");
    setShowCreateForm(false);
  }, []);

  const createSession = useCallback(async () => {
    if (!canMutate) {
      toast.error("Only the DM can create sessions.");
      return;
    }

    const trimmedTitle = newSessionTitle.trim();
    if (!trimmedTitle) {
      toast.error("Provide a session title.");
      return;
    }

    try {
      setCreateBusy(true);
      const response = await apiFetch(`/api/campaigns/${campaignId}/sessions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: trimmedTitle,
          summary: newSessionSummary.trim() || null,
          dm_notes: newSessionNotes.trim() || null,
          scheduled_at: newSessionScheduled ? new Date(newSessionScheduled).toISOString() : null,
        }),
      });

      if (!response.ok) {
        throw new Error(await readErrorMessage(response, "Failed to create session"));
      }

      toast.success("Session created");
      resetCreateForm();
      await refreshSessions();
    } catch (createError) {
      const message = handleAsyncError(createError);
      toast.error(message);
      console.error("Failed to create session:", createError);
    } finally {
      setCreateBusy(false);
    }
  }, [canMutate, campaignId, newSessionNotes, newSessionScheduled, newSessionSummary, newSessionTitle, refreshSessions, resetCreateForm]);

  const startSession = useCallback(
    async (sessionId: string) => {
      if (!canMutate) {
        toast.error("Only the DM can start sessions.");
        return;
      }

      try {
        const response = await apiFetch(`/api/sessions/${sessionId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "active", started_at: new Date().toISOString() }),
        });

        if (!response.ok) {
          throw new Error(await readErrorMessage(response, "Failed to start session"));
        }

        toast.success("Session started");
        await refreshSessions();
      } catch (startError) {
        const message = handleAsyncError(startError);
        toast.error(message);
        console.error("Failed to start session:", startError);
      }
    },
    [canMutate, refreshSessions]
  );

  const endSession = useCallback(
    async (sessionId: string) => {
      if (!canMutate) {
        toast.error("Only the DM can end sessions.");
        return;
      }

      const session = sessions.find((entry) => entry.id === sessionId);
      if (!session) {
        toast.error("Session not found");
        return;
      }
      if (!session.started_at) {
        toast.error("Session has not been started");
        return;
      }

      try {
        setEndBusy(true);
        const endedAt = new Date().toISOString();
        const durationMinutes = Math.max(
          1,
          Math.floor((new Date(endedAt).getTime() - new Date(session.started_at).getTime()) / (1000 * 60)),
        );

        const response = await apiFetch(`/api/sessions/${sessionId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            status: "completed",
            ended_at: endedAt,
            duration: durationMinutes,
            experience_awarded: Number.isFinite(experienceAwarded) ? experienceAwarded : 0,
            summary: sessionSummary.trim() || null,
          }),
        });

        if (!response.ok) {
          throw new Error(await readErrorMessage(response, "Failed to end session"));
        }

        toast.success("Session ended");
        setShowEndForm(false);
        setSessionSummary("");
        setExperienceAwarded(0);
        await refreshSessions();
      } catch (endError) {
        const message = handleAsyncError(endError);
        toast.error(message);
        console.error("Failed to end session:", endError);
      } finally {
        setEndBusy(false);
      }
    },
    [canMutate, experienceAwarded, refreshSessions, sessionSummary, sessions]
  );

  if (!campaignId) {
    return (
      <div className="flex h-64 items-center justify-center text-muted-foreground">
        <span>Campaign context missing for session manager.</span>
      </div>
    );
  }

  if (sessionsLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin" />
        <span className="ml-2">Loading sessions…</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">Session Management</h2>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={refreshSessions} disabled={sessionsRefreshing}>
            {sessionsRefreshing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Refresh
          </Button>
          {isDM && (
            <Button onClick={() => setShowCreateForm(true)}>
              <Plus className="mr-2 h-4 w-4" />
              New Session
            </Button>
          )}
        </div>
      </div>

      {sessionsError && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base text-red-500">Failed to load sessions</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-red-500">{sessionsError}</p>
          </CardContent>
        </Card>
      )}

      {/* Create Session Form */}
      {showCreateForm && isDM && (
        <Card>
          <CardHeader>
            <CardTitle>Create New Session</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Input
              placeholder="Session title"
              value={newSessionTitle}
              onChange={(e) => setNewSessionTitle(e.target.value)}
            />
            <Textarea
              placeholder="Session summary/plan"
              value={newSessionSummary}
              onChange={(e) => setNewSessionSummary(e.target.value)}
              disabled={createBusy}
            />
            <Textarea
              placeholder="DM notes (private)"
              value={newSessionNotes}
              onChange={(e) => setNewSessionNotes(e.target.value)}
              disabled={createBusy}
            />
            <div>
              <label className="text-sm font-medium">Scheduled Time (optional)</label>
              <Input
                type="datetime-local"
                value={newSessionScheduled}
                onChange={(e) => setNewSessionScheduled(e.target.value)}
              />
            </div>
            <div className="flex gap-2">
              <Button onClick={createSession} disabled={createBusy}>
                {createBusy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Create Session
              </Button>
              <Button variant="outline" onClick={resetCreateForm} disabled={createBusy}>
                Cancel
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Sessions List */}
        <div className="lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Sessions</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {sessions.map((session) => (
                  <div
                    key={session.id}
                    className={`p-4 border rounded-lg cursor-pointer transition-colors hover:bg-muted/50 ${
                      selectedSession?.id === session.id ? 'bg-muted border-primary' : ''
                    }`}
                    onClick={() => setSelectedSessionId(session.id)}
                  >
                    <div className="flex justify-between items-start mb-2">
                      <div>
                        <h3 className="font-semibold">
                          Session {session.session_number}: {session.title}
                        </h3>
                        <div className="flex items-center gap-4 mt-2 text-sm text-muted-foreground">
                          <div className="flex items-center gap-1">
                            <Users className="w-4 h-4" />
                            {session.participant_count}
                          </div>
                          {session.duration && (
                            <div className="flex items-center gap-1">
                              <Clock className="w-4 h-4" />
                              {formatDuration(session.duration)}
                            </div>
                          )}
                          {session.experience_awarded && (
                            <div className="flex items-center gap-1">
                              <Trophy className="w-4 h-4" />
                              {session.experience_awarded} XP
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge
                          variant={
                            session.status === 'active' ? 'default' :
                            session.status === 'completed' ? 'secondary' :
                            session.status === 'cancelled' ? 'destructive' : 'outline'
                          }
                        >
                          {session.status}
                        </Badge>
                        {isDM && session.status === 'scheduled' && (
                          <Button size="sm" onClick={(e) => { e.stopPropagation(); startSession(session.id); }}>
                            <Play className="w-4 h-4 mr-1" />
                            Start
                          </Button>
                        )}
                        {isDM && session.status === 'active' && (
                          <Button 
                            size="sm" 
                            variant="outline"
                            onClick={(e) => { 
                              e.stopPropagation(); 
                              setSelectedSessionId(session.id);
                              setShowEndForm(true); 
                            }}
                          >
                            <Square className="w-4 h-4 mr-1" />
                            End
                          </Button>
                        )}
                      </div>
                    </div>
                    {session.summary && (
                      <p className="text-sm text-muted-foreground mt-2">{session.summary}</p>
                    )}
                    <div className="flex gap-4 mt-3 text-xs text-muted-foreground">
                      {session.scheduled_at && (
                        <div className="flex items-center gap-1">
                          <Calendar className="w-3 h-3" />
                          Scheduled: {formatDateTime(session.scheduled_at)}
                        </div>
                      )}
                      {session.started_at && (
                        <div>Started: {formatDateTime(session.started_at)}</div>
                      )}
                      {session.ended_at && (
                        <div>Ended: {formatDateTime(session.ended_at)}</div>
                      )}
                    </div>
                  </div>
                ))}
                
                {sessions.length === 0 && (
                  <div className="text-center py-8 text-muted-foreground">
                    No sessions yet. {isDM && "Create your first session to get started!"}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Session Details */}
        <div>
          {selectedSession ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">
                  Session {selectedSession.session_number} Details
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <h4 className="font-medium">{selectedSession.title}</h4>
                  {selectedSession.summary && (
                    <p className="mt-1 text-sm text-muted-foreground">
                      {selectedSession.summary}
                    </p>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <span className="font-medium">Status:</span>
                    <Badge className="ml-2" variant={
                      selectedSession.status === 'active' ? 'default' :
                      selectedSession.status === 'completed' ? 'secondary' :
                      selectedSession.status === 'cancelled' ? 'destructive' : 'outline'
                    }>
                      {selectedSession.status}
                    </Badge>
                  </div>
                  <div>
                    <span className="font-medium">Participants:</span>
                    <span className="ml-2">{selectedSession.participant_count}</span>
                  </div>
                  {selectedSession.duration && (
                    <div>
                      <span className="font-medium">Duration:</span>
                      <span className="ml-2">{formatDuration(selectedSession.duration)}</span>
                    </div>
                  )}
                  {selectedSession.experience_awarded && (
                    <div>
                      <span className="font-medium">XP Awarded:</span>
                      <span className="ml-2">{selectedSession.experience_awarded}</span>
                    </div>
                  )}
                </div>

                {isDM && selectedSession.dm_notes && (
                  <div>
                    <h5 className="mb-1 text-sm font-medium">DM Notes</h5>
                    <p className="rounded bg-muted p-2 text-sm text-muted-foreground">
                      {selectedSession.dm_notes}
                    </p>
                  </div>
                )}

                <div>
                  <h5 className="mb-2 text-sm font-medium">Participants</h5>
                  {participantsError && <p className="mb-2 text-sm text-red-500">{participantsError}</p>}
                  {participantsLoading ? (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Loading participants…
                    </div>
                  ) : participants.length > 0 ? (
                    <div className="space-y-3">
                      {participants.map((participant) => {
                        const draft = participantDrafts[participant.id] ?? {
                          attendance: participant.attendance_status,
                          level: participant.character_level_start,
                        };
                        const isUpdating = updatingParticipantId === participant.id;
                        const isRemoving = removingParticipantId === participant.id;

                        return (
                          <div key={participant.id} className="space-y-2 rounded border p-3 text-sm">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div>
                                <span className="font-medium">{participant.username}</span>
                                {participant.character_name && (
                                  <span className="ml-1 text-muted-foreground">({participant.character_name})</span>
                                )}
                              </div>
                              {!canMutate && (
                                <div className="flex items-center gap-2">
                                  <Badge variant="outline" className="text-xs">
                                    Level {participant.character_level_start}
                                    {participant.character_level_end !== participant.character_level_start ? ` → ${participant.character_level_end}` : ""}
                                  </Badge>
                                  <Badge
                                    variant={participant.attendance_status === 'present' ? 'default' : 'secondary'}
                                    className="text-xs"
                                  >
                                    {formatAttendanceLabel(participant.attendance_status)}
                                  </Badge>
                                </div>
                              )}
                            </div>
                            {canMutate ? (
                              <>
                                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                                  <Badge variant="outline" className="text-xs">
                                    Recorded level {participant.character_level_start}
                                    {participant.character_level_end !== participant.character_level_start ? ` → ${participant.character_level_end}` : ''}
                                  </Badge>
                                  <Badge
                                    variant={participant.attendance_status === 'present' ? 'default' : 'secondary'}
                                    className="text-xs"
                                  >
                                    {formatAttendanceLabel(participant.attendance_status)}
                                  </Badge>
                                </div>
                                <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                                  <div className="flex flex-wrap items-end gap-3">
                                    <div className="space-y-1">
                                      <Label className="text-xs font-medium" htmlFor={`participant-attendance-${participant.id}`}>
                                        Attendance
                                      </Label>
                                      <Select
                                        value={draft.attendance}
                                        onValueChange={(value) =>
                                          handleParticipantAttendanceChange(
                                            participant.id,
                                            value as SessionParticipant['attendance_status'],
                                          )
                                        }
                                      >
                                        <SelectTrigger id={`participant-attendance-${participant.id}`} className="w-44">
                                          <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                          {ATTENDANCE_OPTIONS.map((option) => (
                                            <SelectItem key={option} value={option}>
                                              {formatAttendanceLabel(option)}
                                            </SelectItem>
                                          ))}
                                        </SelectContent>
                                      </Select>
                                    </div>
                                    <div className="space-y-1">
                                      <Label className="text-xs font-medium" htmlFor={`participant-level-${participant.id}`}>
                                        Level
                                      </Label>
                                      <Input
                                        id={`participant-level-${participant.id}`}
                                        type="number"
                                        inputMode="numeric"
                                        min={1}
                                        max={20}
                                        value={draft.level}
                                        className="w-24"
                                        onChange={(event) => {
                                          const parsed = Number.parseInt(event.target.value, 10);
                                          handleParticipantLevelChange(
                                            participant.id,
                                            Number.isNaN(parsed) ? draft.level : parsed,
                                          );
                                        }}
                                      />
                                    </div>
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      onClick={() => handleSaveParticipant(participant.id)}
                                      disabled={isUpdating || isRemoving}
                                    >
                                      {isUpdating ? (
                                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                      ) : null}
                                      Save
                                    </Button>
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      onClick={() => handleRemoveParticipant(participant.id)}
                                      disabled={isRemoving || isUpdating}
                                    >
                                      {isRemoving ? (
                                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                      ) : (
                                        <Trash2 className="mr-2 h-4 w-4" />
                                      )}
                                      Remove
                                    </Button>
                                  </div>
                                </div>
                              </>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">No participants recorded for this session yet.</p>
                  )}
                  {canMutate ? (
                    <div className="mt-4 space-y-4 rounded-md border bg-muted/40 p-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <h6 className="text-sm font-medium">Add participant</h6>
                          <p className="text-xs text-muted-foreground">
                            Assign a campaign member and capture their attendance for this session.
                          </p>
                        </div>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => loadCampaignMembers()}
                          disabled={membersLoading}
                        >
                          {membersLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
                          Refresh roster
                        </Button>
                      </div>
                      {membersError ? (
                        <p className="text-xs text-red-500">{membersError}</p>
                      ) : null}
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div className="sm:col-span-2 space-y-1">
                          <Label className="text-xs font-medium">Campaign member</Label>
                          <Popover open={memberPickerOpen} onOpenChange={setMemberPickerOpen}>
                            <PopoverTrigger asChild>
                              <Button
                                type="button"
                                variant="outline"
                                role="combobox"
                                className="w-full justify-between"
                                disabled={membersLoading || unusedMembers.length === 0}
                              >
                                {selectedMember && unusedMembers.some((member) => member.id === selectedMember.id)
                                  ? `${selectedMember.username}${selectedMember.character_name ? ` • ${selectedMember.character_name}` : ''}`
                                  : 'Select campaign member'}
                                <ChevronsUpDown className="ml-2 h-4 w-4 opacity-50" />
                              </Button>
                            </PopoverTrigger>
                            <PopoverContent className="w-[min(320px,90vw)] p-0" align="start">
                              <Command>
                                <CommandInput placeholder="Search campaign members..." />
                                <CommandEmpty>No matching campaign members.</CommandEmpty>
                                <CommandList>
                                  {unusedMembers.map((member) => (
                                    <CommandItem
                                      key={member.id}
                                      value={`${member.username} ${member.character_name ?? ''}`.toLowerCase()}
                                      onSelect={() => {
                                        setSelectedMemberId(member.id);
                                        setMemberPickerOpen(false);
                                      }}
                                    >
                                      <Check
                                        className={cn(
                                          'mr-2 h-4 w-4',
                                          selectedMemberId === member.id ? 'opacity-100' : 'opacity-0',
                                        )}
                                      />
                                      <div className="flex flex-col">
                                        <span>{member.username}</span>
                                        {member.character_name ? (
                                          <span className="text-xs text-muted-foreground">
                                            {member.character_name}
                                            {member.character_level ? ` • Level ${member.character_level}` : ''}
                                          </span>
                                        ) : (
                                          <span className="text-xs text-muted-foreground">No character assigned</span>
                                        )}
                                      </div>
                                    </CommandItem>
                                  ))}
                                </CommandList>
                              </Command>
                            </PopoverContent>
                          </Popover>
                          {!membersLoading && unusedMembers.length === 0 ? (
                            <p className="text-xs text-muted-foreground">
                              Every campaign member is already attached to this session.
                            </p>
                          ) : null}
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs font-medium">Attendance</Label>
                          <Select
                            value={selectedAttendance}
                            onValueChange={(value) => setSelectedAttendance(value as SessionParticipant['attendance_status'])}
                          >
                            <SelectTrigger className="w-full">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {ATTENDANCE_OPTIONS.map((option) => (
                                <SelectItem key={option} value={option}>
                                  {formatAttendanceLabel(option)}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs font-medium" htmlFor="new-participant-level">
                            Starting level
                          </Label>
                          <Input
                            id="new-participant-level"
                            type="number"
                            inputMode="numeric"
                            min={1}
                            max={20}
                            value={selectedLevel}
                            onChange={(event) => {
                              const parsed = Number.parseInt(event.target.value, 10);
                              setSelectedLevel(Number.isNaN(parsed) ? selectedLevel : clampLevel(parsed));
                            }}
                          />
                        </div>
                      </div>
                      {selectedMember && !selectedMember.character_id ? (
                        <p className="text-xs text-red-500">
                          Assign a character to {selectedMember.username} before adding them to the session.
                        </p>
                      ) : null}
                      <div className="flex items-center justify-end gap-2">
                        <Button
                          size="sm"
                          onClick={handleAddParticipant}
                          disabled={
                            participantBusy ||
                            !selectedSession ||
                            unusedMembers.length === 0 ||
                            !selectedMember ||
                            !selectedCharacterId
                          }
                        >
                          {participantBusy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <UserPlus className="mr-2 h-4 w-4" />}
                          Add Participant
                        </Button>
                      </div>
                    </div>
                  ) : null}
                </div>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="p-8 text-center text-muted-foreground">
                Select a session to view details
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {/* End Session Modal */}
      {showEndForm && selectedSession && isDM && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <Card className="w-full max-w-md">
            <CardHeader>
              <CardTitle>End Session</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <label className="text-sm font-medium">Session Summary</label>
                <Textarea
                  placeholder="What happened in this session?"
                  value={sessionSummary}
                  onChange={(e) => setSessionSummary(e.target.value)}
                  disabled={endBusy}
                />
              </div>
              <div>
                <label className="text-sm font-medium">Experience Awarded</label>
                <Input
                  type="number"
                  placeholder="0"
                  value={Number.isFinite(experienceAwarded) ? experienceAwarded : ""}
                  onChange={(e) => {
                    const value = Number.parseInt(e.target.value, 10);
                    setExperienceAwarded(Number.isNaN(value) ? 0 : value);
                  }}
                  disabled={endBusy}
                />
              </div>
              <div className="flex gap-2">
                <Button onClick={() => endSession(selectedSession.id)} disabled={endBusy}>
                  {endBusy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  End Session
                </Button>
                <Button variant="outline" onClick={() => setShowEndForm(false)} disabled={endBusy}>
                  Cancel
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
