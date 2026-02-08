import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { Input } from './ui/input';
import { ScrollArea } from './ui/scroll-area';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog';
import { toast } from 'sonner';
import { fetchJson } from "../utils/api-client";
import {
  ScrollText,
  Search,
  Calendar,
  Star,
  Clock,
  Loader2,
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
  treasure_found: Array<{ name: string; description?: string }>;
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
  const [detailEntry, setDetailEntry] = useState<JournalEntry | null>(null);

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
            treasure_found: session.treasure_awarded || [],
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

  // Filter entries based on search
  const filteredEntries = journalEntries.filter(entry => {
    return entry.session_title.toLowerCase().includes(searchTerm.toLowerCase()) ||
           entry.summary?.toLowerCase().includes(searchTerm.toLowerCase());
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
          {/* Search */}
          <div className="mb-6">
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
                        <Button variant="ghost" size="sm" onClick={() => setDetailEntry(entry)}>
                          View Details
                        </Button>
                      </div>
                      
                      <p className="text-sm text-muted-foreground line-clamp-2 mt-2">
                        {entry.summary || 'No session summary available.'}
                      </p>
                    </CardContent>
                  </Card>
                ))
              )}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>

      {/* Journal Detail Dialog */}
      <Dialog open={Boolean(detailEntry)} onOpenChange={(open) => { if (!open) setDetailEntry(null); }}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          {detailEntry && (
            <>
              <DialogHeader>
                <DialogTitle>
                  Session {detailEntry.session_number}: {detailEntry.session_title}
                </DialogTitle>
              </DialogHeader>

              <div className="space-y-6">
                <div>
                  <h4 className="font-medium mb-2 flex items-center gap-2">
                    <ScrollText className="w-4 h-4" />
                    Session Summary
                  </h4>
                  <div className="bg-muted p-3 rounded-lg">
                    <p className="text-sm">{detailEntry.summary || 'No session summary available.'}</p>
                  </div>
                  <div className="grid grid-cols-3 gap-4 mt-4 text-sm">
                    <div>
                      <strong>Date:</strong>
                      <p className="text-muted-foreground">{formatDate(detailEntry.date)}</p>
                    </div>
                    {detailEntry.duration && (
                      <div>
                        <strong>Duration:</strong>
                        <p className="text-muted-foreground">{formatDuration(detailEntry.duration)}</p>
                      </div>
                    )}
                    {detailEntry.experience_awarded && (
                      <div>
                        <strong>Experience Awarded:</strong>
                        <p className="text-muted-foreground">{detailEntry.experience_awarded} XP</p>
                      </div>
                    )}
                  </div>
                </div>

                {detailEntry.treasure_found.length > 0 && (
                  <div>
                    <h4 className="font-medium mb-2 flex items-center gap-2">
                      <Coins className="w-4 h-4" />
                      Treasure Found
                    </h4>
                    <ul className="space-y-1 text-sm">
                      {detailEntry.treasure_found.map((item, index) => (
                        <li key={index} className="text-muted-foreground">
                          &bull; {item.name}{item.description ? ` - ${item.description}` : ''}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
