import { Button } from "./ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";
import { Loader2 } from "lucide-react";

interface SessionCreateFormProps {
  title: string;
  onTitleChange: (value: string) => void;
  summary: string;
  onSummaryChange: (value: string) => void;
  notes: string;
  onNotesChange: (value: string) => void;
  scheduled: string;
  onScheduledChange: (value: string) => void;
  busy: boolean;
  onCreate: () => void;
  onCancel: () => void;
}

export function SessionCreateForm({
  title, onTitleChange,
  summary, onSummaryChange,
  notes, onNotesChange,
  scheduled, onScheduledChange,
  busy, onCreate, onCancel,
}: SessionCreateFormProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Create New Session</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <Input
          placeholder="Session title"
          value={title}
          onChange={(e) => onTitleChange(e.target.value)}
        />
        <Textarea
          placeholder="Session summary/plan"
          value={summary}
          onChange={(e) => onSummaryChange(e.target.value)}
          disabled={busy}
        />
        <Textarea
          placeholder="DM notes (private)"
          value={notes}
          onChange={(e) => onNotesChange(e.target.value)}
          disabled={busy}
        />
        <div>
          <label className="text-sm font-medium">Scheduled Time (optional)</label>
          <Input
            type="datetime-local"
            value={scheduled}
            onChange={(e) => onScheduledChange(e.target.value)}
          />
        </div>
        <div className="flex gap-2">
          <Button onClick={onCreate} disabled={busy}>
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Create Session
          </Button>
          <Button variant="outline" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
