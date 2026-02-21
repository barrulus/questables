import { useState } from "react";
import {
  MessageCircle,
  Heart,
  Eye,
  Skull,
  Shield,
  LogOut,
} from "lucide-react";
import { Button } from "../ui/button";
import { Input } from "../ui/input";

interface SocialActionGridProps {
  npcId: string;
  onAction: (payload: Record<string, unknown>) => void;
  onLeave: () => void;
}

export function SocialActionGrid({
  npcId,
  onAction,
  onLeave,
}: SocialActionGridProps) {
  const [dialogue, setDialogue] = useState("");
  const [showInput, setShowInput] = useState(false);

  const submitSpeak = () => {
    if (!dialogue.trim()) return;
    onAction({
      npcId,
      dialogue: dialogue.trim(),
      socialAction: "speak",
    });
    setDialogue("");
    setShowInput(false);
  };

  const socialActions = [
    {
      key: "speak",
      label: "Speak",
      icon: MessageCircle,
      onClick: () => setShowInput(true),
    },
    {
      key: "persuade",
      label: "Persuade",
      icon: Heart,
      onClick: () => onAction({ npcId, socialAction: "persuade" }),
    },
    {
      key: "deceive",
      label: "Deceive",
      icon: Eye,
      onClick: () => onAction({ npcId, socialAction: "deceive" }),
    },
    {
      key: "intimidate",
      label: "Intimidate",
      icon: Skull,
      onClick: () => onAction({ npcId, socialAction: "intimidate" }),
    },
    {
      key: "insight",
      label: "Insight",
      icon: Shield,
      onClick: () => onAction({ npcId, socialAction: "insight" }),
    },
  ];

  if (showInput) {
    return (
      <div className="space-y-2">
        <div className="text-sm font-medium">What do you say?</div>
        <div className="flex gap-2">
          <Input
            value={dialogue}
            onChange={(e) => setDialogue(e.target.value)}
            placeholder="Type your dialogue..."
            onKeyDown={(e) => {
              if (e.key === "Enter") submitSpeak();
            }}
            autoFocus
          />
          <Button size="sm" onClick={submitSpeak} disabled={!dialogue.trim()}>
            Say
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setShowInput(false)}
          >
            Back
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-3 gap-2">
        {socialActions.map((action) => (
          <Button
            key={action.key}
            variant="outline"
            size="sm"
            className="flex items-center gap-1.5"
            onClick={action.onClick}
          >
            <action.icon className="h-3.5 w-3.5" />
            {action.label}
          </Button>
        ))}
        <Button
          variant="ghost"
          size="sm"
          className="flex items-center gap-1.5 text-muted-foreground"
          onClick={onLeave}
        >
          <LogOut className="h-3.5 w-3.5" />
          Leave
        </Button>
      </div>
    </div>
  );
}
