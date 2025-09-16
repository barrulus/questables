import { useState, useEffect, useContext } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Textarea } from './ui/textarea';
import { Badge } from './ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs';
import { useUser } from "../contexts/UserContext";
import {
  Play,
  Square,
  Clock,
  Users,
  Calendar,
  Trophy,
  Loader2,
  Plus,
  Edit3
} from 'lucide-react';

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

export default function SessionManager({ campaignId, isDM }: { campaignId: string; isDM: boolean }) {
  const { user } = useUser();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [selectedSession, setSelectedSession] = useState<Session | null>(null);
  const [participants, setParticipants] = useState<SessionParticipant[]>([]);
  const [loading, setLoading] = useState(true);
  
  // Create session form
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newSessionTitle, setNewSessionTitle] = useState('');
  const [newSessionSummary, setNewSessionSummary] = useState('');
  const [newSessionNotes, setNewSessionNotes] = useState('');
  const [newSessionScheduled, setNewSessionScheduled] = useState('');
  
  // End session form
  const [showEndForm, setShowEndForm] = useState(false);
  const [sessionSummary, setSessionSummary] = useState('');
  const [experienceAwarded, setExperienceAwarded] = useState<number>(0);

  const loadSessions = async () => {
    try {
      setLoading(true);
      const response = await fetch(`/api/campaigns/${campaignId}/sessions`);
      const data = await response.json();
      setSessions(data);
    } catch (error) {
      console.error('Failed to load sessions:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadParticipants = async (sessionId: string) => {
    try {
      const response = await fetch(`/api/sessions/${sessionId}/participants`);
      const data = await response.json();
      setParticipants(data);
    } catch (error) {
      console.error('Failed to load participants:', error);
    }
  };

  const createSession = async () => {
    if (!newSessionTitle.trim()) return;

    try {
      const response = await fetch(`/api/campaigns/${campaignId}/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: newSessionTitle,
          summary: newSessionSummary || null,
          dm_notes: newSessionNotes || null,
          scheduled_at: newSessionScheduled || null
        })
      });

      if (response.ok) {
        await loadSessions();
        // Reset form
        setNewSessionTitle('');
        setNewSessionSummary('');
        setNewSessionNotes('');
        setNewSessionScheduled('');
        setShowCreateForm(false);
      }
    } catch (error) {
      console.error('Failed to create session:', error);
    }
  };

  const startSession = async (sessionId: string) => {
    try {
      const response = await fetch(`/api/sessions/${sessionId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: 'active',
          started_at: new Date().toISOString()
        })
      });

      if (response.ok) {
        await loadSessions();
      }
    } catch (error) {
      console.error('Failed to start session:', error);
    }
  };

  const endSession = async (sessionId: string) => {
    try {
      const session = sessions.find(s => s.id === sessionId);
      if (!session?.started_at) return;

      const endTime = new Date().toISOString();
      const duration = Math.floor((new Date(endTime).getTime() - new Date(session.started_at).getTime()) / 1000 / 60);

      const response = await fetch(`/api/sessions/${sessionId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: 'completed',
          ended_at: endTime,
          duration,
          experience_awarded: experienceAwarded,
          summary: sessionSummary
        })
      });

      if (response.ok) {
        await loadSessions();
        setShowEndForm(false);
        setSessionSummary('');
        setExperienceAwarded(0);
      }
    } catch (error) {
      console.error('Failed to end session:', error);
    }
  };

  const formatDuration = (minutes: number) => {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
  };

  const formatDateTime = (dateString: string) => {
    return new Date(dateString).toLocaleString();
  };

  useEffect(() => {
    loadSessions();
  }, [campaignId]);

  useEffect(() => {
    if (selectedSession) {
      loadParticipants(selectedSession.id);
    }
  }, [selectedSession]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin" />
        <span className="ml-2">Loading sessions...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold">Session Management</h2>
        {isDM && (
          <Button onClick={() => setShowCreateForm(true)}>
            <Plus className="w-4 h-4 mr-2" />
            New Session
          </Button>
        )}
      </div>

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
            />
            <Textarea
              placeholder="DM notes (private)"
              value={newSessionNotes}
              onChange={(e) => setNewSessionNotes(e.target.value)}
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
              <Button onClick={createSession}>Create Session</Button>
              <Button variant="outline" onClick={() => setShowCreateForm(false)}>
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
                    onClick={() => setSelectedSession(session)}
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
                              setSelectedSession(session);
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
                    <p className="text-sm text-muted-foreground mt-1">
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
                    <h5 className="font-medium text-sm mb-1">DM Notes:</h5>
                    <p className="text-sm text-muted-foreground bg-muted p-2 rounded">
                      {selectedSession.dm_notes}
                    </p>
                  </div>
                )}

                {/* Participants */}
                {participants.length > 0 && (
                  <div>
                    <h5 className="font-medium text-sm mb-2">Participants:</h5>
                    <div className="space-y-2">
                      {participants.map((participant) => (
                        <div key={participant.id} className="flex justify-between items-center text-sm">
                          <div>
                            <span className="font-medium">{participant.username}</span>
                            {participant.character_name && (
                              <span className="text-muted-foreground ml-1">
                                ({participant.character_name})
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-2">
                            <Badge variant="outline" className="text-xs">
                              Level {participant.character_level_start}
                              {participant.character_level_end !== participant.character_level_start && 
                                ` → ${participant.character_level_end}`
                              }
                            </Badge>
                            <Badge 
                              variant={participant.attendance_status === 'present' ? 'default' : 'secondary'}
                              className="text-xs"
                            >
                              {participant.attendance_status}
                            </Badge>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
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
                />
              </div>
              <div>
                <label className="text-sm font-medium">Experience Awarded</label>
                <Input
                  type="number"
                  placeholder="0"
                  value={experienceAwarded || ''}
                  onChange={(e) => setExperienceAwarded(parseInt(e.target.value) || 0)}
                />
              </div>
              <div className="flex gap-2">
                <Button onClick={() => endSession(selectedSession.id)}>
                  End Session
                </Button>
                <Button variant="outline" onClick={() => setShowEndForm(false)}>
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
