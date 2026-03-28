import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { Textarea } from "./ui/textarea";
import { Alert, AlertDescription, AlertTitle } from "./ui/alert";
import { Loader2, Users } from "lucide-react";
import type { NpcSentiment } from "../utils/api-client";

const SENTIMENT_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "auto", label: "Auto (compute from delta)" },
  { value: "hostile", label: "Hostile" },
  { value: "unfriendly", label: "Unfriendly" },
  { value: "indifferent", label: "Indifferent" },
  { value: "friendly", label: "Friendly" },
  { value: "helpful", label: "Helpful" },
];

interface SelectOption {
  value: string;
  label: string;
}

interface NpcSentimentPanelProps {
  noneValue: string;
  npcId: string;
  onNpcIdChange: (value: string) => void;
  npcOptions: SelectOption[];
  npcsLoading: boolean;
  npcsError: string | null;
  delta: string;
  onDeltaChange: (value: string) => void;
  choice: "auto" | NpcSentiment;
  onChoiceChange: (value: "auto" | NpcSentiment) => void;
  sessionId: string;
  onSessionIdChange: (value: string, touched: boolean) => void;
  sessionOptions: SelectOption[];
  summary: string;
  onSummaryChange: (value: string) => void;
  tags: string;
  onTagsChange: (value: string) => void;
  pending: boolean;
  feedback: { id: string; trust_delta: number; sentiment: string } | null;
  error: string | null;
  onSubmit: () => void;
}

export function NpcSentimentPanel({
  noneValue, npcId, onNpcIdChange, npcOptions, npcsLoading, npcsError,
  delta, onDeltaChange, choice, onChoiceChange,
  sessionId, onSessionIdChange, sessionOptions,
  summary, onSummaryChange, tags, onTagsChange,
  pending, feedback, error, onSubmit,
}: NpcSentimentPanelProps) {
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="dm-sidebar-sentiment-npc">NPC</Label>
        <Select value={npcId} onValueChange={onNpcIdChange}>
          <SelectTrigger id="dm-sidebar-sentiment-npc">
            <SelectValue placeholder={npcsLoading ? "Loading NPCs\u2026" : "Select an NPC"} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={noneValue}>Select an NPC</SelectItem>
            {npcOptions.map((option) => (
              <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {npcsError && <p className="text-xs text-destructive">{npcsError}</p>}
      </div>

      <div className="grid gap-4 grid-cols-1 sm:grid-cols-3">
        <div className="space-y-2">
          <Label htmlFor="dm-sidebar-sentiment-delta">Trust delta</Label>
          <Input id="dm-sidebar-sentiment-delta" type="number" min={-10} max={10} value={delta} onChange={(e) => onDeltaChange(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="dm-sidebar-sentiment-choice">Sentiment</Label>
          <Select value={choice} onValueChange={(v) => onChoiceChange(v as "auto" | NpcSentiment)}>
            <SelectTrigger id="dm-sidebar-sentiment-choice"><SelectValue /></SelectTrigger>
            <SelectContent>
              {SENTIMENT_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="dm-sidebar-sentiment-session">Session link</Label>
          <Select value={sessionId} onValueChange={(v) => onSessionIdChange(v, true)}>
            <SelectTrigger id="dm-sidebar-sentiment-session"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={noneValue}>No session link</SelectItem>
              {sessionOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="dm-sidebar-sentiment-summary">Summary</Label>
        <Textarea id="dm-sidebar-sentiment-summary" rows={3} value={summary} onChange={(e) => onSummaryChange(e.target.value)} placeholder="The guardian now trusts the party after they safeguarded the village." />
      </div>

      <div className="space-y-2">
        <Label htmlFor="dm-sidebar-sentiment-tags">Tags (comma separated)</Label>
        <Input id="dm-sidebar-sentiment-tags" value={tags} onChange={(e) => onTagsChange(e.target.value)} placeholder="reassurance, trust" />
      </div>

      <div className="flex flex-wrap gap-2">
        <Button onClick={onSubmit} disabled={pending}>
          {pending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Users className="mr-2 h-4 w-4" />}Log sentiment
        </Button>
      </div>

      {feedback && (
        <Alert>
          <AlertTitle>Sentiment recorded</AlertTitle>
          <AlertDescription>
            Memory {feedback.id} stored with delta {feedback.trust_delta} ({feedback.sentiment}).
          </AlertDescription>
        </Alert>
      )}
      {error && (
        <Alert variant="destructive">
          <AlertTitle>Sentiment logging failed</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
    </div>
  );
}
