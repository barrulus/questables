import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "./ui/dialog";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";
import { Loader2 } from "lucide-react";

interface SessionEndDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  summary: string;
  onSummaryChange: (value: string) => void;
  experienceAwarded: number;
  onExperienceChange: (value: number) => void;
  busy: boolean;
  onEnd: () => void;
  onCancel: () => void;
}

export function SessionEndDialog({
  open, onOpenChange,
  summary, onSummaryChange,
  experienceAwarded, onExperienceChange,
  busy, onEnd, onCancel,
}: SessionEndDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>End Session</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <label className="text-sm font-medium">Session Summary</label>
            <Textarea
              placeholder="What happened in this session?"
              value={summary}
              onChange={(e) => onSummaryChange(e.target.value)}
              disabled={busy}
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
                onExperienceChange(Number.isNaN(value) ? 0 : value);
              }}
              disabled={busy}
            />
          </div>
          <div className="flex gap-2">
            <Button onClick={onEnd} disabled={busy}>
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              End Session
            </Button>
            <Button variant="outline" onClick={onCancel} disabled={busy}>
              Cancel
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
