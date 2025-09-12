import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Textarea } from "./ui/textarea";
import { ScrollArea } from "./ui/scroll-area";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "./ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "./ui/alert-dialog";
import { toast } from "sonner@2.0.3";
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
  Filter
} from "lucide-react";

interface JournalEntry {
  id: string;
  title: string;
  content: string;
  date: Date;
  sessionNumber?: number;
  location?: string;
  characters: string[];
  tags: string[];
  category: "session" | "character" | "world" | "quest" | "notes";
  isImportant: boolean;
  author: string;
}

export function Journals() {
  const [entries, setEntries] = useState<JournalEntry[]>([
    {
      id: "1",
      title: "Session 12: The Council of Elrond",
      content: "Today we gathered in Rivendell for the famous Council of Elrond. The Fellowship was officially formed, despite some heated arguments between Boromir and the others about the Ring's fate. Gandalf revealed his captivity by Saruman and the treachery at Isengard. We've decided to take the Ring to Mordor - a perilous journey lies ahead. Frodo volunteered as Ring-bearer, showing incredible courage for such a small hobbit.",
      date: new Date("2024-01-15"),
      sessionNumber: 12,
      location: "Rivendell",
      characters: ["Frodo", "Gandalf", "Aragorn", "Boromir", "Legolas", "Gimli"],
      tags: ["fellowship", "council", "ring", "important"],
      category: "session",
      isImportant: true,
      author: "DM"
    },
    {
      id: "2",
      title: "Aragorn's Heritage Revealed",
      content: "In a quiet moment at Rivendell, Aragorn finally revealed his true heritage to the party. He is Isildur's heir and the rightful king of Gondor. This explains his knowledge of ancient paths and his reluctance to enter Minas Tirith. He's been reluctant to claim his throne, feeling unworthy after his ancestor's failure to destroy the Ring.",
      date: new Date("2024-01-10"),
      location: "Rivendell",
      characters: ["Aragorn"],
      tags: ["backstory", "royalty", "gondor", "isildur"],
      category: "character",
      isImportant: true,
      author: "Player"
    },
    {
      id: "3",
      title: "The Mines of Moria - Geography Notes",
      content: "Moria (also called Khazad-dûm) is the ancient underground kingdom of the Dwarves beneath the Misty Mountains. Once the greatest mansion of the Dwarves, it has fallen to darkness. The western entrance is hidden behind the Walls of Moria near the river Mitheithel. The Balrog awakened in the deep places has made this realm extremely dangerous.",
      date: new Date("2024-01-05"),
      location: "Moria",
      characters: ["Gimli"],
      tags: ["geography", "dwarves", "balrog", "danger"],
      category: "world",
      isImportant: false,
      author: "DM"
    },
    {
      id: "4",
      title: "Quest: Destroy the One Ring",
      content: "Primary quest: Take the One Ring to Mount Doom in Mordor and destroy it in the fires where it was forged. This is the only way to defeat Sauron permanently. The quest is extremely dangerous - Mordor is heavily guarded and the Ring's corrupting influence grows stronger as we approach Mount Doom. Side objectives include protecting Frodo and maintaining the Fellowship's unity.",
      date: new Date("2024-01-01"),
      characters: ["Frodo", "Fellowship"],
      tags: ["main-quest", "ring", "mordor", "mount-doom"],
      category: "quest",
      isImportant: true,
      author: "DM"
    },
    {
      id: "5",
      title: "Session 11: Weathertop Encounter",
      content: "We reached the ancient watchtower of Weathertop (Amon Sûl). Despite warnings, Frodo put on the Ring when the Nazgûl attacked, making himself visible to them in the wraith-world. Aragorn drove them off with fire, but not before one of the Ringwraiths wounded Frodo with a Morgul blade. The wound is not healing naturally and we need to reach Rivendell quickly.",
      date: new Date("2024-01-08"),
      sessionNumber: 11,
      location: "Weathertop",
      characters: ["Frodo", "Aragorn", "Sam", "Merry", "Pippin"],
      tags: ["nazgul", "morgul-blade", "weathertop", "combat"],
      category: "session",
      isImportant: true,
      author: "DM"
    },
    {
      id: "6",
      title: "Gandalf's Research Notes",
      content: "Found some interesting notes in my study about the origin of the Seeing Stones (Palantíri). There are seven stones total, crafted in Valinor and given to the Faithful. Saruman has clearly been using the Orthanc-stone to communicate with someone - likely Sauron himself through the Ithil-stone captured at Minas Ithil. This explains his corruption and knowledge of our movements.",
      date: new Date("2023-12-20"),
      location: "Isengard",
      characters: ["Gandalf", "Saruman"],
      tags: ["palantir", "saruman", "corruption", "research"],
      category: "notes",
      isImportant: false,
      author: "Player"
    }
  ]);

  const [selectedEntry, setSelectedEntry] = useState<JournalEntry | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [filterCategory, setFilterCategory] = useState<string>("all");
  const [sortBy, setSortBy] = useState<"date" | "title" | "importance">("date");

  const [newEntry, setNewEntry] = useState<Partial<JournalEntry>>({
    title: "",
    content: "",
    date: new Date(),
    location: "",
    characters: [],
    tags: [],
    category: "notes",
    isImportant: false,
    author: "Player"
  });

  const categories = ["all", "session", "character", "world", "quest", "notes"];
  const categoryLabels = {
    session: "Session Notes",
    character: "Character Development",
    world: "World Building",
    quest: "Quest Log",
    notes: "General Notes"
  };

  const filteredEntries = entries
    .filter(entry => {
      const matchesSearch = entry.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
                           entry.content.toLowerCase().includes(searchTerm.toLowerCase()) ||
                           entry.tags.some(tag => tag.toLowerCase().includes(searchTerm.toLowerCase()));
      const matchesCategory = filterCategory === "all" || entry.category === filterCategory;
      return matchesSearch && matchesCategory;
    })
    .sort((a, b) => {
      switch (sortBy) {
        case "title": return a.title.localeCompare(b.title);
        case "importance": return (b.isImportant ? 1 : 0) - (a.isImportant ? 1 : 0);
        case "date": 
        default: 
          return b.date.getTime() - a.date.getTime();
      }
    });

  const handleCreateEntry = () => {
    if (!newEntry.title?.trim() || !newEntry.content?.trim()) {
      toast.error("Please provide both title and content");
      return;
    }

    const entry: JournalEntry = {
      ...newEntry as JournalEntry,
      id: Date.now().toString(),
      date: newEntry.date || new Date(),
      characters: newEntry.characters || [],
      tags: newEntry.tags || []
    };

    setEntries(prev => [entry, ...prev]);
    setNewEntry({
      title: "",
      content: "",
      date: new Date(),
      location: "",
      characters: [],
      tags: [],
      category: "notes",
      isImportant: false,
      author: "Player"
    });
    setIsCreating(false);
    toast.success("Journal entry created");
  };

  const handleDeleteEntry = (id: string) => {
    setEntries(prev => prev.filter(entry => entry.id !== id));
    if (selectedEntry?.id === id) {
      setSelectedEntry(null);
    }
    toast.success("Journal entry deleted");
  };

  const handleToggleImportant = (id: string) => {
    setEntries(prev => prev.map(entry => 
      entry.id === id ? { ...entry, isImportant: !entry.isImportant } : entry
    ));
  };

  const exportEntry = (entry: JournalEntry) => {
    const content = `# ${entry.title}

**Date:** ${entry.date.toLocaleDateString()}
**Category:** ${categoryLabels[entry.category] || entry.category}
${entry.location ? `**Location:** ${entry.location}` : ''}
${entry.sessionNumber ? `**Session:** ${entry.sessionNumber}` : ''}
${entry.characters.length > 0 ? `**Characters:** ${entry.characters.join(', ')}` : ''}
${entry.tags.length > 0 ? `**Tags:** ${entry.tags.join(', ')}` : ''}

${entry.content}
`;

    const blob = new Blob([content], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${entry.title.replace(/[^a-zA-Z0-9]/g, '_')}.md`;
    link.click();
    URL.revokeObjectURL(url);
    toast.success("Entry exported");
  };

  const getCategoryIcon = (category: string) => {
    switch (category) {
      case "session": return <Calendar className="w-4 h-4" />;
      case "character": return <User className="w-4 h-4" />;
      case "world": return <MapPin className="w-4 h-4" />;
      case "quest": return <Star className="w-4 h-4" />;
      default: return <FileText className="w-4 h-4" />;
    }
  };

  return (
    <div className="h-full flex flex-col">
      <div className="p-4 border-b">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold">Campaign Journal</h2>
          <Dialog open={isCreating} onOpenChange={setIsCreating}>
            <DialogTrigger asChild>
              <Button size="sm">
                <Plus className="w-4 h-4 mr-1" />
                New Entry
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>New Journal Entry</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="title">Title *</Label>
                    <Input
                      id="title"
                      value={newEntry.title || ""}
                      onChange={(e) => setNewEntry(prev => ({ ...prev, title: e.target.value }))}
                      placeholder="Entry title"
                    />
                  </div>
                  <div>
                    <Label htmlFor="category">Category</Label>
                    <Select 
                      value={newEntry.category || "notes"} 
                      onValueChange={(value) => setNewEntry(prev => ({ ...prev, category: value as any }))}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {Object.entries(categoryLabels).map(([key, label]) => (
                          <SelectItem key={key} value={key}>{label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label htmlFor="date">Date</Label>
                    <Input
                      id="date"
                      type="date"
                      value={newEntry.date?.toISOString().split('T')[0] || ""}
                      onChange={(e) => setNewEntry(prev => ({ ...prev, date: new Date(e.target.value) }))}
                    />
                  </div>
                  <div>
                    <Label htmlFor="location">Location</Label>
                    <Input
                      id="location"
                      value={newEntry.location || ""}
                      onChange={(e) => setNewEntry(prev => ({ ...prev, location: e.target.value }))}
                      placeholder="Location or setting"
                    />
                  </div>
                  {newEntry.category === "session" && (
                    <div>
                      <Label htmlFor="sessionNumber">Session Number</Label>
                      <Input
                        id="sessionNumber"
                        type="number"
                        value={newEntry.sessionNumber || ""}
                        onChange={(e) => setNewEntry(prev => ({ ...prev, sessionNumber: parseInt(e.target.value) }))}
                        placeholder="Session #"
                      />
                    </div>
                  )}
                  <div>
                    <Label htmlFor="tags">Tags (comma separated)</Label>
                    <Input
                      id="tags"
                      value={newEntry.tags?.join(", ") || ""}
                      onChange={(e) => setNewEntry(prev => ({ 
                        ...prev, 
                        tags: e.target.value.split(",").map(tag => tag.trim()).filter(Boolean)
                      }))}
                      placeholder="tag1, tag2, tag3"
                    />
                  </div>
                </div>
                
                <div>
                  <Label htmlFor="content">Content *</Label>
                  <Textarea
                    id="content"
                    value={newEntry.content || ""}
                    onChange={(e) => setNewEntry(prev => ({ ...prev, content: e.target.value }))}
                    placeholder="Write your journal entry here..."
                    rows={8}
                  />
                </div>

                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="important"
                    checked={newEntry.isImportant || false}
                    onChange={(e) => setNewEntry(prev => ({ ...prev, isImportant: e.target.checked }))}
                  />
                  <Label htmlFor="important">Mark as important</Label>
                </div>
              </div>
              
              <div className="flex justify-end gap-2 pt-4">
                <Button variant="outline" onClick={() => setIsCreating(false)}>
                  Cancel
                </Button>
                <Button onClick={handleCreateEntry}>
                  Create Entry
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>

        {/* Search and Filter */}
        <div className="flex gap-2 mb-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search entries..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10"
            />
          </div>
          <Select value={filterCategory} onValueChange={setFilterCategory}>
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Categories</SelectItem>
              {Object.entries(categoryLabels).map(([key, label]) => (
                <SelectItem key={key} value={key}>{label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={sortBy} onValueChange={(value) => setSortBy(value as any)}>
            <SelectTrigger className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="date">Date</SelectItem>
              <SelectItem value="title">Title</SelectItem>
              <SelectItem value="importance">Importance</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Entry List */}
        <div className="w-80 border-r">
          <ScrollArea className="h-full">
            <div className="p-2 space-y-2">
              {filteredEntries.map((entry) => (
                <Card 
                  key={entry.id}
                  className={`cursor-pointer transition-colors ${
                    selectedEntry?.id === entry.id ? 'ring-2 ring-primary' : ''
                  }`}
                  onClick={() => setSelectedEntry(entry)}
                >
                  <CardContent className="p-3">
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex items-center gap-2">
                        {getCategoryIcon(entry.category)}
                        <Badge variant="outline" className="text-xs">
                          {categoryLabels[entry.category] || entry.category}
                        </Badge>
                        {entry.isImportant && <Star className="w-3 h-3 text-yellow-500 fill-current" />}
                      </div>
                      <span className="text-xs text-muted-foreground">
                        {entry.date.toLocaleDateString()}
                      </span>
                    </div>
                    
                    <h3 className="font-medium text-sm mb-2 line-clamp-2">{entry.title}</h3>
                    
                    <p className="text-xs text-muted-foreground line-clamp-3 mb-2">
                      {entry.content}
                    </p>

                    <div className="flex items-center justify-between">
                      <div className="flex flex-wrap gap-1">
                        {entry.tags.slice(0, 2).map((tag, index) => (
                          <Badge key={index} variant="secondary" className="text-xs">
                            {tag}
                          </Badge>
                        ))}
                        {entry.tags.length > 2 && (
                          <span className="text-xs text-muted-foreground">
                            +{entry.tags.length - 2}
                          </span>
                        )}
                      </div>
                      {entry.sessionNumber && (
                        <Badge variant="outline" className="text-xs">
                          S{entry.sessionNumber}
                        </Badge>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </ScrollArea>
        </div>

        {/* Entry Details */}
        <div className="flex-1">
          {selectedEntry ? (
            <div className="h-full flex flex-col">
              <div className="p-4 border-b">
                <div className="flex items-center justify-between mb-2">
                  <h2 className="text-xl font-semibold">{selectedEntry.title}</h2>
                  <div className="flex gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleToggleImportant(selectedEntry.id)}
                    >
                      <Star className={`w-4 h-4 ${selectedEntry.isImportant ? 'text-yellow-500 fill-current' : ''}`} />
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => exportEntry(selectedEntry)}
                    >
                      <Download className="w-4 h-4 mr-1" />
                      Export
                    </Button>
                    <Button variant="outline" size="sm">
                      <Edit className="w-4 h-4 mr-1" />
                      Edit
                    </Button>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button variant="outline" size="sm">
                          <Trash2 className="w-4 h-4 mr-1" />
                          Delete
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Delete Entry</AlertDialogTitle>
                          <AlertDialogDescription>
                            Are you sure you want to delete "{selectedEntry.title}"? This action cannot be undone.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction
                            onClick={() => handleDeleteEntry(selectedEntry.id)}
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                          >
                            Delete
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </div>
                
                <div className="flex items-center gap-4 text-sm text-muted-foreground">
                  <div className="flex items-center gap-1">
                    {getCategoryIcon(selectedEntry.category)}
                    <span>{categoryLabels[selectedEntry.category] || selectedEntry.category}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <Calendar className="w-4 h-4" />
                    <span>{selectedEntry.date.toLocaleDateString()}</span>
                  </div>
                  {selectedEntry.location && (
                    <div className="flex items-center gap-1">
                      <MapPin className="w-4 h-4" />
                      <span>{selectedEntry.location}</span>
                    </div>
                  )}
                  {selectedEntry.sessionNumber && (
                    <Badge variant="outline">Session {selectedEntry.sessionNumber}</Badge>
                  )}
                  <span>by {selectedEntry.author}</span>
                </div>
              </div>

              <ScrollArea className="flex-1">
                <div className="p-4 space-y-6">
                  <div className="prose prose-sm max-w-none">
                    <div className="whitespace-pre-wrap leading-relaxed">
                      {selectedEntry.content}
                    </div>
                  </div>

                  {selectedEntry.characters.length > 0 && (
                    <div>
                      <h3 className="font-medium mb-2">Characters Involved</h3>
                      <div className="flex flex-wrap gap-2">
                        {selectedEntry.characters.map((character, index) => (
                          <Badge key={index} variant="secondary">
                            <User className="w-3 h-3 mr-1" />
                            {character}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}

                  {selectedEntry.tags.length > 0 && (
                    <div>
                      <h3 className="font-medium mb-2">Tags</h3>
                      <div className="flex flex-wrap gap-2">
                        {selectedEntry.tags.map((tag, index) => (
                          <Badge key={index} variant="outline">
                            <Tag className="w-3 h-3 mr-1" />
                            {tag}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </ScrollArea>
            </div>
          ) : (
            <div className="flex-1 flex items-center justify-center text-muted-foreground">
              <div className="text-center">
                <ScrollText className="w-12 h-12 mx-auto mb-4 opacity-50" />
                <p>Select a journal entry to read</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}