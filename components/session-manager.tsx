import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { SessionCreateForm } from "./session-create-form";
import { SessionEndDialog } from "./session-end-dialog";
import { SessionParticipantsPanel, type SessionParticipant, type CampaignMember } from "./session-participants-panel";
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

// SessionParticipant and CampaignMember types imported from session-participants-panel

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

      {showCreateForm && isDM && (
        <SessionCreateForm
          title={newSessionTitle} onTitleChange={setNewSessionTitle}
          summary={newSessionSummary} onSummaryChange={setNewSessionSummary}
          notes={newSessionNotes} onNotesChange={setNewSessionNotes}
          scheduled={newSessionScheduled} onScheduledChange={setNewSessionScheduled}
          busy={createBusy} onCreate={createSession} onCancel={resetCreateForm}
        />
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

                <SessionParticipantsPanel
                  participants={participants}
                  participantsLoading={participantsLoading}
                  participantsError={participantsError}
                  participantDrafts={participantDrafts}
                  canMutate={canMutate}
                  updatingParticipantId={updatingParticipantId}
                  removingParticipantId={removingParticipantId}
                  onAttendanceChange={handleParticipantAttendanceChange}
                  onLevelChange={handleParticipantLevelChange}
                  onSaveParticipant={handleSaveParticipant}
                  onRemoveParticipant={handleRemoveParticipant}
                  unusedMembers={unusedMembers}
                  selectedMember={selectedMember}
                  selectedMemberId={selectedMemberId}
                  onMemberSelect={setSelectedMemberId}
                  memberPickerOpen={memberPickerOpen}
                  onMemberPickerOpenChange={setMemberPickerOpen}
                  membersLoading={membersLoading}
                  membersError={membersError}
                  onRefreshRoster={() => loadCampaignMembers()}
                  selectedAttendance={selectedAttendance}
                  onSelectedAttendanceChange={setSelectedAttendance}
                  selectedLevel={selectedLevel}
                  onSelectedLevelChange={(v) => setSelectedLevel(clampLevel(v))}
                  selectedCharacterId={selectedCharacterId}
                  participantBusy={participantBusy}
                  hasSelectedSession={!!selectedSession}
                  onAddParticipant={handleAddParticipant}
                />
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

      <SessionEndDialog
        open={showEndForm && !!selectedSession && isDM}
        onOpenChange={(open) => { if (!open) setShowEndForm(false); }}
        summary={sessionSummary}
        onSummaryChange={setSessionSummary}
        experienceAwarded={experienceAwarded}
        onExperienceChange={setExperienceAwarded}
        busy={endBusy}
        onEnd={() => selectedSession && endSession(selectedSession.id)}
        onCancel={() => setShowEndForm(false)}
      />
    </div>
  );
}
