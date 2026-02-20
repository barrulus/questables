import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Users, MessageSquare, Crown, Lock } from "lucide-react";

export type ChannelType = "party" | "dm_whisper" | "dm_broadcast" | "private";

export interface ChannelTab {
  channelType: ChannelType;
  targetUserId?: string | null;
  label: string;
  unreadCount?: number;
}

interface ChatChannelTabsProps {
  tabs: ChannelTab[];
  activeChannel: ChannelTab;
  onChannelChange: (tab: ChannelTab) => void;
}

const CHANNEL_ICONS: Record<ChannelType, typeof Users> = {
  party: Users,
  dm_whisper: MessageSquare,
  dm_broadcast: Crown,
  private: Lock,
};

export function ChatChannelTabs({ tabs, activeChannel, onChannelChange }: ChatChannelTabsProps) {
  return (
    <div className="flex items-center gap-1 overflow-x-auto border-b px-2 py-1.5">
      {tabs.map((tab) => {
        const Icon = CHANNEL_ICONS[tab.channelType] ?? Users;
        const isActive =
          tab.channelType === activeChannel.channelType &&
          (tab.targetUserId ?? null) === (activeChannel.targetUserId ?? null);

        return (
          <Button
            key={`${tab.channelType}-${tab.targetUserId ?? "all"}`}
            variant={isActive ? "default" : "ghost"}
            size="sm"
            className="relative flex items-center gap-1 whitespace-nowrap text-xs"
            onClick={() => onChannelChange(tab)}
          >
            <Icon className="h-3 w-3" />
            {tab.label}
            {(tab.unreadCount ?? 0) > 0 && (
              <Badge
                variant="destructive"
                className="ml-1 h-4 min-w-[1rem] px-1 text-[10px]"
              >
                {tab.unreadCount}
              </Badge>
            )}
          </Button>
        );
      })}
    </div>
  );
}

/**
 * Build the default channel tabs for a user.
 */
export function buildDefaultTabs(isDm: boolean): ChannelTab[] {
  const tabs: ChannelTab[] = [
    { channelType: "party", label: "Party" },
    { channelType: "dm_whisper", label: "DM Whisper" },
  ];

  if (isDm) {
    tabs.push({ channelType: "dm_broadcast", label: "DM Narration" });
  }

  return tabs;
}
