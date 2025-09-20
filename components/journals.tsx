import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { ScrollArea } from './ui/scroll-area';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from './ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { toast } from 'sonner';
import { fetchJson } from "../utils/api-client";
import { Alert, AlertDescription, AlertTitle } from './ui/alert';
import { 
  ScrollText,
  Search,
  Calendar,
  MapPin,
  Star,
  Clock,
  FileText,
  Loader2,
  Users,
  Coins,
  AlertCircle
} from 'lucide-react';

interface JournalEntry {
  id: string;
  session_id: string;
  session_number: number;
  session_title: string;
  summary?: string;
  date: string;
  duration?: number;
  experience_awarded?: number;
  participants: string[];
  locations_visited: string[];
  npcs_encountered: string[];
  treasure_found: Array<{ name: string; description?: string }>;
  personal_notes?: string;
  favorite_moments?: string;
  character_thoughts?: string;
}

interface JournalsProps {
  campaignId?: string;
}

interface ApiSession {
  id: string;
  session_number: number;
  title: string;
  summary?: string;
  status: string;
  ended_at?: string;
  started_at?: string;
  created_at: string;
  duration?: number;
  experience_awarded?: number;
  treasure_awarded?: Array<{ name: string; description?: string }>;
}

export default function Journals({ campaignId }: JournalsProps) {
  const [journalEntries, setJournalEntries] = useState<JournalEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterCategory, setFilterCategory] = useState<string>('all');

  // Load journal entries from completed sessions
  const loadJournalEntries = async () => {
    try {
      if (!campaignId) {
        setJournalEntries([]);
        return;
      }
      // Load completed sessions as journal entries
      const sessions = await fetchJson<ApiSession[]>(
        `/api/campaigns/${campaignId}/sessions`,
        undefined,
        'Failed to load sessions',
      );

      if (sessions) {
        const completedSessions = sessions
          .filter((session) => session.status === 'completed')
          .map((session) => ({
            id: session.id,
            session_id: session.id,
            session_number: session.session_number,
            session_title: session.title,
            summary: session.summary,
            date: session.ended_at || session.started_at || session.created_at,
            duration: session.duration,
            experience_awarded: session.experience_awarded,
            participants: [], // Would need to join with session_participants
            locations_visited: [], // Would need session-location tracking
            npcs_encountered: [], // Would need session-npc tracking
            treasure_found: session.treasure_awarded || [],
            personal_notes: '',
            favorite_moments: '',
            character_thoughts: ''
          }));

        setJournalEntries(completedSessions);
      } else {
        setJournalEntries([]);
      }
    } catch (error) {
      console.error('Failed to load journal entries:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to load journal entries');
    } finally {
      setLoading(false);
    }
  };

  // Filter entries based on search and category
  const filteredEntries = journalEntries.filter(entry => {
    const matchesSearch = entry.session_title.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         entry.summary?.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         entry.personal_notes?.toLowerCase().includes(searchTerm.toLowerCase());
    
    const matchesCategory = filterCategory === 'all' || 
                           (filterCategory === 'with_notes' && (entry.personal_notes || entry.favorite_moments || entry.character_thoughts)) ||
                           (filterCategory === 'without_notes' && !entry.personal_notes && !entry.favorite_moments && !entry.character_thoughts);
    
    return matchesSearch && matchesCategory;
  });

  // Format date for display
  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  // Format duration
  const formatDuration = (minutes: number) => {
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    if (hours > 0) {
      return `${hours}h ${remainingMinutes}m`;
    }
    return `${remainingMinutes}m`;
  };

  useEffect(() => {
    if (!campaignId) {
      setLoading(false);
      return;
    }

    setLoading(true);
    loadJournalEntries();
  }, [campaignId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-48">
        <Loader2 className="w-6 h-6 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex justify-between items-center">
            <CardTitle className="flex items-center gap-2">
              <ScrollText className="w-5 h-5" />
              Campaign Journal
            </CardTitle>
            <div className="flex items-center gap-2">
              <Badge variant="outline">
                {filteredEntries.length} entries
              </Badge>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {/* Search and Filter */}
          <div className="flex gap-4 mb-6">
            <div className="flex-1">
              <div className="relative">
                <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search journal entries..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-9"
                />
              </div>
            </div>
            <Select value={filterCategory} onValueChange={setFilterCategory}>
              <SelectTrigger className="w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Entries</SelectItem>
                <SelectItem value="with_notes">With Personal Notes</SelectItem>
                <SelectItem value="without_notes">Without Personal Notes</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Journal Entries */}
          <ScrollArea className="h-96">
            <div className="space-y-3">
              {filteredEntries.length === 0 ? (
                <div className="text-center py-12">
                  <ScrollText className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
                  <p className="text-muted-foreground">
                    {journalEntries.length === 0 
                      ? 'No completed sessions yet. Complete some sessions to see journal entries here.'
                      : 'No entries match your search criteria.'}
                  </p>
                </div>
              ) : (
                filteredEntries.map((entry) => (
                  <Card key={entry.id} className="cursor-pointer hover:shadow-md transition-shadow">
                    <CardContent className="p-4">
                      <div className="flex justify-between items-start mb-2">
                        <div className="space-y-1">
                          <h3 className="font-medium">
                            Session {entry.session_number}: {entry.session_title}
                          </h3>
                          <div className="flex items-center gap-4 text-sm text-muted-foreground">
                            <div className="flex items-center gap-1">
                              <Calendar className="w-4 h-4" />
                              {formatDate(entry.date)}
                            </div>
                            {entry.duration && (
                              <div className="flex items-center gap-1">
                                <Clock className="w-4 h-4" />
                                {formatDuration(entry.duration)}
                              </div>
                            )}
                            {entry.experience_awarded && (
                              <div className="flex items-center gap-1">
                                <Star className="w-4 h-4" />
                                {entry.experience_awarded} XP
                              </div>
                            )}
                          </div>
                        </div>
                        <div className="flex gap-2">
                          {(entry.personal_notes || entry.favorite_moments || entry.character_thoughts) && (
                            <Badge variant="secondary" className="text-xs">
                              <FileText className="w-3 h-3 mr-1" />
                              Personal Notes
                            </Badge>
                          )}
                          <Dialog>
                            <DialogTrigger asChild>
                              <Button variant="ghost" size="sm">
                                View Details
                              </Button>
                            </DialogTrigger>
                            <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
                              <DialogHeader>
                                <DialogTitle>
                                  Session {entry.session_number}: {entry.session_title}
                                </DialogTitle>
                              </DialogHeader>
                              
                              <div className="space-y-6">
                                {/* Session Summary */}
                                <div>
                                  <h4 className="font-medium mb-2 flex items-center gap-2">
                                    <ScrollText className="w-4 h-4" />
                                    Session Summary
                                  </h4>
                                  <div className="bg-muted p-3 rounded-lg">
                                    <p className="text-sm">
                                      {entry.summary || 'No session summary available.'}
                                    </p>
                                  </div>
                                  
                                  <div className="grid grid-cols-3 gap-4 mt-4 text-sm">
                                    <div>
                                      <strong>Date:</strong>
                                      <p className="text-muted-foreground">{formatDate(entry.date)}</p>
                                    </div>
                                    {entry.duration && (
                                      <div>
                                        <strong>Duration:</strong>
                                        <p className="text-muted-foreground">{formatDuration(entry.duration)}</p>
                                      </div>
                                    )}
                                    {entry.experience_awarded && (
                                      <div>
                                        <strong>Experience Awarded:</strong>
                                        <p className="text-muted-foreground">{entry.experience_awarded} XP</p>
                                      </div>
                                    )}
                                  </div>
                                </div>

                                {/* Session Data */}
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                  {entry.locations_visited.length > 0 && (
                                    <div>
                                      <h4 className="font-medium mb-2 flex items-center gap-2">
                                        <MapPin className="w-4 h-4" />
                                        Locations
                                      </h4>
                                      <ul className="space-y-1 text-sm">
                                        {entry.locations_visited.map((location, index) => (
                                          <li key={index} className="text-muted-foreground">
                                            • {location}
                                          </li>
                                        ))}
                                      </ul>
                                    </div>
                                  )}

                                  {entry.npcs_encountered.length > 0 && (
                                    <div>
                                      <h4 className="font-medium mb-2 flex items-center gap-2">
                                        <Users className="w-4 h-4" />
                                        NPCs Met
                                      </h4>
                                      <ul className="space-y-1 text-sm">
                                        {entry.npcs_encountered.map((npc, index) => (
                                          <li key={index} className="text-muted-foreground">
                                            • {npc}
                                          </li>
                                        ))}
                                      </ul>
                                    </div>
                                  )}

                                  {entry.treasure_found.length > 0 && (
                                    <div>
                                      <h4 className="font-medium mb-2 flex items-center gap-2">
                                        <Coins className="w-4 h-4" />
                                        Treasure
                                      </h4>
                                      <ul className="space-y-1 text-sm">
                                        {entry.treasure_found.map((item, index) => (
                                          <li key={index} className="text-muted-foreground">
                                            • {item.name} - {item.description}
                                          </li>
                                        ))}
                                      </ul>
                                    </div>
                                  )}
                                </div>

                                {/* Personal Notes Section */}
                                <div>
                                  <h4 className="font-medium mb-2 flex items-center gap-2">
                                    <FileText className="w-4 h-4" />
                                    Personal Notes
                                  </h4>
                                  <Alert className="mb-4">
                                    <AlertCircle className="w-4 h-4" />
                                    <AlertTitle>Personal journaling pending backend support</AlertTitle>
                                    <AlertDescription>
                                      Editing and persisting personal notes is blocked until the journaling API
                                      is delivered. Existing entries are read-only snapshots from completed
                                      sessions.
                                    </AlertDescription>
                                  </Alert>

                                  <div className="space-y-4">
                                    <div>
                                      <Label className="text-sm font-medium">Personal Reflections</Label>
                                      <div className="bg-muted p-3 rounded-lg">
                                        <p className="text-sm text-muted-foreground whitespace-pre-line">
                                          {entry.personal_notes || 'No personal reflections recorded.'}
                                        </p>
                                      </div>
                                    </div>

                                    <div>
                                      <Label className="text-sm font-medium">Favorite Moments</Label>
                                      <div className="bg-muted p-3 rounded-lg">
                                        <p className="text-sm text-muted-foreground whitespace-pre-line">
                                          {entry.favorite_moments || 'No favorite moments recorded.'}
                                        </p>
                                      </div>
                                    </div>

                                    <div>
                                      <Label className="text-sm font-medium">Character Thoughts</Label>
                                      <div className="bg-muted p-3 rounded-lg">
                                        <p className="text-sm text-muted-foreground whitespace-pre-line">
                                          {entry.character_thoughts || 'No character thoughts recorded.'}
                                        </p>
                                      </div>
                                    </div>
                                  </div>
                                </div>
                              </div>
                            </DialogContent>
                          </Dialog>
                        </div>
                      </div>
                      
                      <p className="text-sm text-muted-foreground line-clamp-2 mt-2">
                        {entry.summary || 'No session summary available.'}
                      </p>
                      
                      {(entry.personal_notes || entry.favorite_moments || entry.character_thoughts) && (
                        <div className="mt-3 p-2 bg-muted rounded text-xs">
                          <div className="flex items-center gap-1 text-muted-foreground">
                            <FileText className="w-3 h-3" />
                            <span>Personal notes added</span>
                          </div>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                ))
              )}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  );
}
