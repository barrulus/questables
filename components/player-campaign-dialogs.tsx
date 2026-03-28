import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "./ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { Loader2 } from "lucide-react";

interface CharacterOption {
  id: string;
  name: string;
  level: number;
  class: string;
}

interface JoinCampaignDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  campaignName: string;
  characters: CharacterOption[];
  selectedCharacterId: string | null;
  onCharacterSelect: (id: string) => void;
  submitting: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function JoinCampaignDialog({
  open, onOpenChange, campaignName,
  characters, selectedCharacterId, onCharacterSelect,
  submitting, onConfirm, onCancel,
}: JoinCampaignDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Select a character</DialogTitle>
          <DialogDescription>
            Choose which character you want to bring into {campaignName}.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <p className="text-sm text-muted-foreground mb-2">Character</p>
            <Select value={selectedCharacterId ?? ""} onValueChange={onCharacterSelect}>
              <SelectTrigger className="w-full"><SelectValue placeholder="Select a character" /></SelectTrigger>
              <SelectContent>
                {characters.map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.name} — Level {c.level} {c.class}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={submitting}>Cancel</Button>
          <Button onClick={onConfirm} disabled={!selectedCharacterId || submitting}>
            {submitting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}Confirm Join
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface SwitchCharacterDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  campaignName: string;
  characters: CharacterOption[];
  currentCharacterId: string | null;
  selectedCharacterId: string | null;
  onCharacterSelect: (id: string) => void;
  submitting: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function SwitchCharacterDialog({
  open, onOpenChange, campaignName,
  characters, currentCharacterId, selectedCharacterId, onCharacterSelect,
  submitting, onConfirm, onCancel,
}: SwitchCharacterDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Switch Character</DialogTitle>
          <DialogDescription>
            Choose a different character for {campaignName}.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <p className="text-sm text-muted-foreground mb-2">Character</p>
            <Select value={selectedCharacterId ?? ""} onValueChange={onCharacterSelect}>
              <SelectTrigger className="w-full"><SelectValue placeholder="Select a character" /></SelectTrigger>
              <SelectContent>
                {characters.filter((c) => c.id !== currentCharacterId).map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.name} — Level {c.level} {c.class}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={submitting}>Cancel</Button>
          <Button onClick={onConfirm} disabled={!selectedCharacterId || submitting}>
            {submitting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}Switch Character
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
