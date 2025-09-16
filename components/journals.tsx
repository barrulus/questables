import { useState, useEffect, useContext } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Textarea } from './ui/textarea';
import { ScrollArea } from './ui/scroll-area';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from './ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from './ui/alert-dialog';
import { toast } from 'sonner';
import { useUser } from "../contexts/UserContext";
import { 
  ScrollText,
  Plus,
  Edit,
  Trash2,
  Search,
  Calendar,
  Tag,
  User,
  MapPin,
  Star,
  Clock,
  FileText,
  Download,
  Filter,
  Loader2,
  Users,
  Coins
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
  treasure_found: any[];
  personal_notes?: string;
  favorite_moments?: string;
  character_thoughts?: string;
}

interface PersonalJournalData {
  personal_notes?: string;
  favorite_moments?: string;
  character_thoughts?: string;
}

interface JournalsProps {
  campaignId?: string;
}

export default function Journals({ campaignId }: JournalsProps) {
  const { user } = useUser();
  const [journalEntries, setJournalEntries] = useState<JournalEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedEntry, setSelectedEntry] = useState<JournalEntry | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterCategory, setFilterCategory] = useState<string>('all');
  const [editingPersonalNotes, setEditingPersonalNotes] = useState<PersonalJournalData>({});

  // Load journal entries from completed sessions
  const loadJournalEntries = async () => {
    try {
      if (!campaignId) {
        setJournalEntries([]);
        return;
      }
      // Load completed sessions as journal entries
      const response = await fetch(`/api/campaigns/${campaignId}/sessions`);
      if (response.ok) {
        const sessions = await response.json();
        
        const completedSessions = sessions
          .filter((s: any) => s.status === 'completed')
          .map((s: any) => ({
            id: s.id,
            session_id: s.id,
            session_number: s.session_number,
            session_title: s.title,
            summary: s.summary,
            date: s.ended_at || s.started_at || s.created_at,
            duration: s.duration,
            experience_awarded: s.experience_awarded,
            participants: [], // Would need to join with session_participants
            locations_visited: [], // Would need session-location tracking
            npcs_encountered: [], // Would need session-npc tracking
            treasure_found: s.treasure_awarded || [],
            personal_notes: '',
            favorite_moments: '',
            character_thoughts: ''
          }));

        setJournalEntries(completedSessions);
      }
    } catch (error) {
      console.error('Failed to load journal entries:', error);
      toast.error('Failed to load journal entries');
    } finally {
      setLoading(false);
    }
  };

  // Create or update personal journal entry
  const updatePersonalJournal = async (sessionId: string, journalData: PersonalJournalData) => {
    try {
      // In a full implementation, this would call a personal journal API endpoint
      // For now, we'll update the local state
      setJournalEntries(prev => prev.map(entry =>
        entry.session_id === sessionId
          ? { ...entry, ...journalData }
          : entry
      ));
      
      toast.success('Personal notes updated');
      setEditingPersonalNotes({});
    } catch (error) {
      console.error('Failed to update personal journal:', error);
      toast.error('Failed to update personal notes');
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
                                  
                                  <div className="space-y-4">
                                    <div>
                                      <Label className="text-sm font-medium">Personal Reflections</Label>
                                      {editingPersonalNotes.personal_notes !== undefined ? (
                                        <div className="space-y-2">
                                          <Textarea
                                            value={editingPersonalNotes.personal_notes}
                                            onChange={(e) => setEditingPersonalNotes(prev => ({
                                              ...prev,
                                              personal_notes: e.target.value
                                            }))}
                                            placeholder="Write your personal thoughts about this session..."
                                            rows={3}
                                          />
                                          <div className="flex gap-2">
                                            <Button
                                              size="sm"
                                              onClick={() => updatePersonalJournal(entry.session_id, editingPersonalNotes)}
                                            >
                                              Save
                                            </Button>
                                            <Button
                                              size="sm"
                                              variant="outline"
                                              onClick={() => setEditingPersonalNotes({})}
                                            >
                                              Cancel
                                            </Button>
                                          </div>
                                        </div>
                                      ) : (
                                        <div className="bg-muted p-3 rounded-lg">
                                          <p className="text-sm text-muted-foreground">
                                            {entry.personal_notes || 'No personal notes yet.'}
                                          </p>
                                          <Button
                                            size="sm"
                                            variant="ghost"
                                            className="mt-2"
                                            onClick={() => setEditingPersonalNotes({ personal_notes: entry.personal_notes || '' })}
                                          >
                                            <Edit className="w-4 h-4 mr-1" />
                                            Edit
                                          </Button>
                                        </div>
                                      )}
                                    </div>

                                    <div>
                                      <Label className="text-sm font-medium">Favorite Moments</Label>
                                      {editingPersonalNotes.favorite_moments !== undefined ? (
                                        <div className="space-y-2">
                                          <Textarea
                                            value={editingPersonalNotes.favorite_moments}
                                            onChange={(e) => setEditingPersonalNotes(prev => ({
                                              ...prev,
                                              favorite_moments: e.target.value
                                            }))}
                                            placeholder="What were your favorite moments from this session?"
                                            rows={3}
                                          />
                                          <div className="flex gap-2">
                                            <Button
                                              size="sm"
                                              onClick={() => updatePersonalJournal(entry.session_id, editingPersonalNotes)}
                                            >
                                              Save
                                            </Button>
                                            <Button
                                              size="sm"
                                              variant="outline"
                                              onClick={() => setEditingPersonalNotes({})}
                                            >
                                              Cancel
                                            </Button>
                                          </div>
                                        </div>
                                      ) : (
                                        <div className="bg-muted p-3 rounded-lg">
                                          <p className="text-sm text-muted-foreground">
                                            {entry.favorite_moments || 'No favorite moments recorded.'}
                                          </p>
                                          <Button
                                            size="sm"
                                            variant="ghost"
                                            className="mt-2"
                                            onClick={() => setEditingPersonalNotes({ favorite_moments: entry.favorite_moments || '' })}
                                          >
                                            <Edit className="w-4 h-4 mr-1" />
                                            Edit
                                          </Button>
                                        </div>
                                      )}
                                    </div>

                                    <div>
                                      <Label className="text-sm font-medium">Character Thoughts</Label>
                                      {editingPersonalNotes.character_thoughts !== undefined ? (
                                        <div className="space-y-2">
                                          <Textarea
                                            value={editingPersonalNotes.character_thoughts}
                                            onChange={(e) => setEditingPersonalNotes(prev => ({
                                              ...prev,
                                              character_thoughts: e.target.value
                                            }))}
                                            placeholder="How did your character feel about the events?"
                                            rows={3}
                                          />
                                          <div className="flex gap-2">
                                            <Button
                                              size="sm"
                                              onClick={() => updatePersonalJournal(entry.session_id, editingPersonalNotes)}
                                            >
                                              Save
                                            </Button>
                                            <Button
                                              size="sm"
                                              variant="outline"
                                              onClick={() => setEditingPersonalNotes({})}
                                            >
                                              Cancel
                                            </Button>
                                          </div>
                                        </div>
                                      ) : (
                                        <div className="bg-muted p-3 rounded-lg">
                                          <p className="text-sm text-muted-foreground">
                                            {entry.character_thoughts || 'No character thoughts recorded.'}
                                          </p>
                                          <Button
                                            size="sm"
                                            variant="ghost"
                                            className="mt-2"
                                            onClick={() => setEditingPersonalNotes({ character_thoughts: entry.character_thoughts || '' })}
                                          >
                                            <Edit className="w-4 h-4 mr-1" />
                                            Edit
                                          </Button>
                                        </div>
                                      )}
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
