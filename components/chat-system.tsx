import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Badge } from "./ui/badge";
import { ScrollArea } from "./ui/scroll-area";
import { Avatar, AvatarFallback } from "./ui/avatar";
import { Switch } from "./ui/switch";
import { toast } from "sonner";
import { Send, Users, Crown, Dice6, Loader2, Trash2, AlertCircle, Wifi, WifiOff } from "lucide-react";
import { useUser } from "../contexts/UserContext";
import { useWebSocket } from "../hooks/useWebSocket";
import { apiFetch, readErrorMessage, readJsonBody } from "../utils/api-client";
import { handleAsyncError } from "../utils/error-handling";
import {
  ChatChannelTabs,
  buildDefaultTabs,
  type ChannelTab,
  type ChannelType,
} from "./chat-channel-tabs";

interface DiceRollResult {
  expression: string;
  rolls: number[];
  modifier: number;
  total: number;
  details?: string;
}

interface ChatMessage {
  id: string;
  campaign_id: string;
  content: string;
  message_type: "text" | "dice_roll" | "system" | "ooc";
  sender_id: string;
  sender_name: string;
  username: string;
  character_id?: string | null;
  character_name?: string | null;
  dice_roll?: DiceRollResult;
  channel_type?: ChannelType;
  channel_target_user_id?: string | null;
  created_at: string;
}

interface CampaignCharacter {
  id: string;
  name: string;
}

interface ChatSystemProps {
  campaignId: string;
  campaignName?: string;
  campaignRole?: "dm" | "player";
  dmUserId?: string | null;
}

interface ApiChatMessage {
  id: string;
  campaign_id: string;
  content: string;
  message_type: string;
  sender_id: string;
  sender_name: string;
  username: string;
  character_id?: string | null;
  character_name?: string | null;
  dice_roll?: unknown;
  channel_type?: string;
  channel_target_user_id?: string | null;
  created_at: string;
}

interface ApiCampaignCharacter {
  id: string;
  name: string;
  user_id: string;
}

const MAX_RECONNECT_ATTEMPTS = 5;

function parseDiceRoll(rawValue: unknown): DiceRollResult | undefined {
  if (!rawValue) {
    return undefined;
  }

  if (typeof rawValue === "string") {
    try {
      return JSON.parse(rawValue) as DiceRollResult;
    } catch {
      return undefined;
    }
  }

  if (typeof rawValue === "object") {
    const candidate = rawValue as Partial<DiceRollResult>;
    if (Array.isArray(candidate.rolls) && typeof candidate.total === "number") {
      return {
        expression: typeof candidate.expression === "string" ? candidate.expression : "",
        rolls: candidate.rolls,
        modifier: typeof candidate.modifier === "number" ? candidate.modifier : 0,
        total: candidate.total,
        details: typeof candidate.details === "string" ? candidate.details : undefined,
      };
    }
  }

  return undefined;
}

function normalizeChatMessage(raw: ApiChatMessage): ChatMessage {
  return {
    id: raw.id,
    campaign_id: raw.campaign_id,
    content: raw.content,
    message_type: (raw.message_type as ChatMessage["message_type"]) ?? "text",
    sender_id: raw.sender_id,
    sender_name: raw.sender_name,
    username: raw.username ?? raw.sender_name,
    character_id: raw.character_id ?? null,
    character_name: raw.character_name ?? undefined,
    dice_roll: parseDiceRoll(raw.dice_roll),
    channel_type: (raw.channel_type as ChannelType) ?? "party",
    channel_target_user_id: raw.channel_target_user_id ?? null,
    created_at: raw.created_at,
  };
}

const DEFAULT_CHANNEL: ChannelTab = { channelType: "party", label: "Party" };

export function ChatSystem({ campaignId, campaignName, campaignRole, dmUserId }: ChatSystemProps) {
  const { user } = useUser();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [newMessage, setNewMessage] = useState("");
  const [campaignCharacter, setCampaignCharacter] = useState<CampaignCharacter | null>(null);
  const [speakingInCharacter, setSpeakingInCharacter] = useState(true);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [charactersError, setCharactersError] = useState<string | null>(null);

  // Channel state
  const [activeChannel, setActiveChannel] = useState<ChannelTab>(DEFAULT_CHANNEL);
  const [unreadCounts, setUnreadCounts] = useState<Record<string, number>>({});

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messageInputRef = useRef<HTMLInputElement | null>(null);
  const typingActiveRef = useRef(false);

  const {
    connected,
    messages: wsMessages,
    typingUsers,
    presenceUsers,
    sendChatMessage,
    startTyping,
    stopTyping,
    connectionAttempts,
  } = useWebSocket(campaignId);

  const isDm = campaignRole === "dm" || (user && dmUserId === user.id);
  const channelTabs = useMemo(() => buildDefaultTabs(isDm ?? false), [isDm]);

  // ── Channel key for unread tracking ─────────────────────────────────
  const channelKey = useCallback(
    (channelType: string, targetUserId?: string | null) =>
      `${channelType}:${targetUserId ?? "all"}`,
    [],
  );

  // ── Load unread counts ──────────────────────────────────────────────
  const loadUnreadCounts = useCallback(async () => {
    if (!campaignId || !user) return;
    try {
      const response = await apiFetch(`/api/campaigns/${campaignId}/channels/unread`);
      if (!response.ok) return;
      const payload = await readJsonBody<{
        counts: { channel_type: string; channel_target_user_id?: string | null; unread_count: number }[];
      }>(response);
      const counts: Record<string, number> = {};
      for (const row of payload.counts ?? []) {
        counts[channelKey(row.channel_type, row.channel_target_user_id)] = row.unread_count;
      }
      setUnreadCounts(counts);
    } catch {
      /* ignore */
    }
  }, [campaignId, channelKey, user]);

  useEffect(() => {
    loadUnreadCounts();
  }, [loadUnreadCounts]);

  // ── Mark channel as read on tab switch ──────────────────────────────
  const handleChannelChange = useCallback(
    (tab: ChannelTab) => {
      setActiveChannel(tab);

      // Clear local unread for this channel
      const key = channelKey(tab.channelType, tab.targetUserId);
      setUnreadCounts((prev) => ({ ...prev, [key]: 0 }));

      // Tell server
      if (campaignId) {
        void apiFetch(`/api/campaigns/${campaignId}/channels/read`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            channel_type: tab.channelType,
            channel_target_user_id: tab.targetUserId ?? null,
          }),
        }).catch(() => {});
      }
    },
    [campaignId, channelKey],
  );

  // ── Tabs with unread counts ─────────────────────────────────────────
  const tabsWithUnread = useMemo(
    () =>
      channelTabs.map((tab) => ({
        ...tab,
        unreadCount: unreadCounts[channelKey(tab.channelType, tab.targetUserId)] ?? 0,
      })),
    [channelTabs, channelKey, unreadCounts],
  );

  // ── Filter messages by active channel ───────────────────────────────
  const filteredMessages = useMemo(() => {
    return messages.filter((msg) => {
      const msgChannel = msg.channel_type ?? "party";

      if (activeChannel.channelType === "party") {
        return msgChannel === "party";
      }
      if (activeChannel.channelType === "dm_broadcast") {
        return msgChannel === "dm_broadcast";
      }
      if (activeChannel.channelType === "dm_whisper") {
        return msgChannel === "dm_whisper";
      }
      if (activeChannel.channelType === "private") {
        return (
          msgChannel === "private" &&
          ((msg.sender_id === user?.id && msg.channel_target_user_id === activeChannel.targetUserId) ||
            (msg.sender_id === activeChannel.targetUserId && msg.channel_target_user_id === user?.id))
        );
      }
      return true;
    });
  }, [messages, activeChannel, user]);

  const hasMessages = filteredMessages.length > 0;

  const loadCampaignCharacter = useCallback(async (signal?: AbortSignal) => {
    if (!user || !campaignId) {
      return;
    }

    try {
      setCharactersError(null);
      const response = await apiFetch(`/api/campaigns/${campaignId}/characters`, { signal });
      if (!response.ok) {
        throw new Error(await readErrorMessage(response, "Failed to load campaign characters"));
      }

      const payload = await readJsonBody<ApiCampaignCharacter[]>(response);
      const characters = Array.isArray(payload) ? payload : [];
      const mine = characters.find((c) => c.user_id === user.id);

      setCampaignCharacter(mine ? { id: mine.id, name: mine.name } : null);
      setSpeakingInCharacter(mine != null);
    } catch (loadError) {
      if (loadError instanceof DOMException && loadError.name === "AbortError") {
        return;
      }
      const errorMessage = handleAsyncError(loadError);
      setCharactersError(errorMessage);
      console.error("Failed to load campaign character:", loadError);
    }
  }, [campaignId, user]);

  const loadMessages = useCallback(
    async ({ signal, showSpinner = true }: { signal?: AbortSignal; showSpinner?: boolean } = {}) => {
      if (!campaignId) {
        return;
      }

      try {
        if (showSpinner) {
          setLoading(true);
        }
        setError(null);

        // Load all channel messages at once (no channel filter — we filter client-side)
        const response = await apiFetch(`/api/campaigns/${campaignId}/messages`, { signal });
        if (!response.ok) {
          throw new Error(await readErrorMessage(response, "Failed to load chat messages"));
        }

        const payload = await readJsonBody<unknown>(response);
        if (payload !== null && !Array.isArray(payload)) {
          throw new Error("Unexpected messages payload format");
        }

        const list = (payload as ApiChatMessage[] | null | undefined) ?? [];
        const normalized = list.map(normalizeChatMessage);
        setMessages(normalized);
      } catch (loadError) {
        if (loadError instanceof DOMException && loadError.name === "AbortError") {
          return;
        }
        const errorMessage = handleAsyncError(loadError);
        setError(errorMessage);
        console.error("Failed to load messages:", loadError);
        toast.error("Failed to load chat messages");
      } finally {
        if (showSpinner) {
          setLoading(false);
        }
      }
    },
    [campaignId]
  );

  useEffect(() => {
    if (!user) {
      setCampaignCharacter(null);
      setSpeakingInCharacter(false);
      return;
    }

    const controller = new AbortController();
    loadCampaignCharacter(controller.signal);
    return () => controller.abort();
  }, [loadCampaignCharacter, user]);

  useEffect(() => {
    const controller = new AbortController();
    setMessages([]);
    setLoading(true);
    loadMessages({ signal: controller.signal, showSpinner: true });
    return () => {
      controller.abort();
      setMessages([]);
      setError(null);
      setLoading(true);
    };
  }, [campaignId, loadMessages]);

  useEffect(() => {
    if (wsMessages.length === 0) {
      return;
    }

    const latestEnvelope = wsMessages[wsMessages.length - 1];
    if (!latestEnvelope || latestEnvelope.type !== "new_message" || !latestEnvelope.data) {
      return;
    }

    const incoming = normalizeChatMessage(latestEnvelope.data as ApiChatMessage);

    setMessages((prev) => {
      if (prev.some((message) => message.id === incoming.id)) {
        return prev;
      }

      const next = [...prev, incoming];
      next.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
      return next;
    });

    // Increment unread for non-active channels
    const incomingKey = channelKey(incoming.channel_type ?? "party", incoming.channel_target_user_id);
    const activeKey = channelKey(activeChannel.channelType, activeChannel.targetUserId);
    if (incomingKey !== activeKey && incoming.sender_id !== user?.id) {
      setUnreadCounts((prev) => ({
        ...prev,
        [incomingKey]: (prev[incomingKey] ?? 0) + 1,
      }));
    }

    if (incoming.sender_id !== user?.id) {
      toast.success(`New message from ${incoming.sender_name}`);
    }
  }, [wsMessages, user, activeChannel, channelKey]);

  useEffect(() => {
    if (loading) {
      return;
    }
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [filteredMessages, loading]);

  useEffect(() => () => stopTyping(), [stopTyping]);

  const sendStructuredMessage = useCallback(
    async ({
      content,
      messageType = "text",
      diceRoll,
    }: {
      content: string;
      messageType?: "text" | "dice_roll" | "ooc";
      diceRoll?: DiceRollResult;
    }) => {
      if (!user) {
        return;
      }

      const trimmed = content.trim();
      if (!trimmed) {
        return;
      }

      try {
        setSending(true);

        const characterId = speakingInCharacter && campaignCharacter ? campaignCharacter.id : null;

        const response = await apiFetch(`/api/campaigns/${campaignId}/messages`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            content: trimmed,
            type: messageType,
            character_id: characterId,
            dice_roll: diceRoll ?? null,
            channel_type: activeChannel.channelType,
            channel_target_user_id: activeChannel.targetUserId ?? null,
          }),
        });

        if (!response.ok) {
          throw new Error(await readErrorMessage(response, "Failed to send message"));
        }

        const { message } = await readJsonBody<{ message: ApiChatMessage }>(response);
        const persisted = normalizeChatMessage(message);

        setMessages((prev) => {
          const next = [...prev, persisted];
          next.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
          return next;
        });

        if (connected) {
          sendChatMessage({
            content: persisted.content,
            messageId: persisted.id,
            characterId: persisted.character_id ?? null,
            characterName: persisted.character_name ?? undefined,
            messageType: persisted.message_type,
            diceRoll: persisted.dice_roll,
            createdAt: persisted.created_at,
          });
        }

        setNewMessage("");
        typingActiveRef.current = false;
        stopTyping();
      } catch (sendError) {
        console.error("Failed to send message:", sendError);
        toast.error("Failed to send message");
      } finally {
        setSending(false);
      }
    },
    [activeChannel, campaignCharacter, campaignId, connected, sendChatMessage, speakingInCharacter, stopTyping, user]
  );

  const evaluateDiceExpression = (expression: string): DiceRollResult => {
    const match = expression.match(/(\d+)?d(\d+)(?:([+-])(\d+))?/i);
    if (!match) {
      return { total: 0, rolls: [], expression, modifier: 0 };
    }

    const numDice = parseInt(match[1] || "1", 10);
    const diceSize = parseInt(match[2], 10);
    const modifier = match[3] && match[4] ? (match[3] === "+" ? 1 : -1) * parseInt(match[4], 10) : 0;

    const rolls: number[] = [];
    for (let i = 0; i < numDice; i += 1) {
      rolls.push(Math.floor(Math.random() * diceSize) + 1);
    }

    const rollSum = rolls.reduce((sum, roll) => sum + roll, 0);
    const total = rollSum + modifier;

    return {
      expression,
      rolls,
      modifier,
      total,
      details: `${rolls.join(", ")}${modifier !== 0 ? ` ${modifier > 0 ? "+" : ""}${modifier}` : ""} = ${total}`,
    };
  };

  const rollDice = useCallback(
    async (diceExpression: string) => {
      const trimmed = diceExpression.trim();
      if (!trimmed) {
        return;
      }

      const rollResult = evaluateDiceExpression(trimmed);
      const speaker = speakingInCharacter && campaignCharacter
        ? campaignCharacter.name
        : user?.username || "You";
      const content = `${speaker} rolled ${trimmed}: ${rollResult.total}`;

      await sendStructuredMessage({ content, messageType: "dice_roll", diceRoll: rollResult });
    },
    [campaignCharacter, sendStructuredMessage, speakingInCharacter, user?.username]
  );

  const deleteMessage = useCallback(
    async (messageId: string) => {
      if (!user) {
        return;
      }

      try {
        const response = await apiFetch(`/api/campaigns/${campaignId}/messages/${messageId}`, {
          method: "DELETE",
        });

        if (!response.ok) {
          throw new Error(await readErrorMessage(response, "Failed to delete message"));
        }

        setMessages((prev) => prev.filter((message) => message.id !== messageId));
        toast.success("Message deleted");
      } catch (deleteError) {
        console.error("Failed to delete message:", deleteError);
        toast.error("Failed to delete message");
      }
    },
    [campaignId, user]
  );

  const formatTime = useCallback((timestamp: string) => {
    return new Date(timestamp).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
  }, []);

  const getMessageIcon = useCallback((type: string) => {
    switch (type) {
      case "dice_roll":
        return <Dice6 className="w-4 h-4 text-blue-500" />;
      case "system":
        return <Crown className="w-4 h-4 text-purple-500" />;
      case "ooc":
        return <Users className="w-4 h-4 text-gray-500" />;
      default:
        return null;
    }
  }, []);

  const getMessageStyling = useCallback((message: ChatMessage) => {
    // Channel-specific visual styles
    const channelType = message.channel_type ?? "party";
    if (channelType === "dm_broadcast") {
      return "bg-amber-50 border border-amber-200 text-amber-900 italic";
    }
    if (channelType === "dm_whisper") {
      return "bg-indigo-50 border border-indigo-200 text-indigo-900";
    }
    if (channelType === "private") {
      return "bg-emerald-50 border border-emerald-200 text-emerald-900";
    }

    // Default message type styles
    if (message.message_type === "system") {
      return "bg-purple-50 border border-purple-200 text-purple-800";
    }
    if (message.message_type === "dice_roll") {
      return "bg-blue-50 border border-blue-200 text-blue-800";
    }
    if (message.message_type === "ooc") {
      return "bg-gray-50 border border-gray-200 text-gray-700";
    }
    return "";
  }, []);

  const handleTextSubmit = useCallback(async () => {
    const content = newMessage;
    const trimmedLower = content.trim().toLowerCase();
    const messageType: "text" | "ooc" = trimmedLower.startsWith("[ooc]") ? "ooc" : "text";
    await sendStructuredMessage({ content, messageType });
  }, [newMessage, sendStructuredMessage]);

  const typingIndicator = useMemo(() => {
    if (typingUsers.length === 0) {
      return null;
    }

    if (typingUsers.length === 1) {
      return `${typingUsers[0]} is typing...`;
    }

    return `${typingUsers.slice(0, -1).join(", ")} and ${typingUsers[typingUsers.length - 1]} are typing...`;
  }, [typingUsers]);

  // Channel placeholder text
  const inputPlaceholder = useMemo(() => {
    switch (activeChannel.channelType) {
      case "dm_broadcast":
        return "Narrate to all players...";
      case "dm_whisper":
        return "Whisper to/from the DM...";
      case "private":
        return "Private message...";
      default:
        return "Type your message...";
    }
  }, [activeChannel.channelType]);

  // Disable input for dm_broadcast if not DM
  const inputDisabled = sending || (activeChannel.channelType === "dm_broadcast" && !isDm);

  if (!user) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        <Users className="w-12 h-12 mx-auto mb-4 opacity-50" />
        <p>Please log in to participate in chat</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="text-center py-8">
        <Loader2 className="w-8 h-8 animate-spin mx-auto mb-4" />
        <p>Loading chat...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-8">
        <AlertCircle className="w-8 h-8 mx-auto mb-4 text-red-500" />
        <p className="text-red-600 mb-4">Failed to load chat</p>
        <p className="text-sm text-red-500 mb-4">{error}</p>
        <Button onClick={() => loadMessages({ showSpinner: true })} variant="outline">
          Try Again
        </Button>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <div className="flex items-center gap-2">
          <Users className="w-5 h-5" />
          <div className="flex flex-col">
            <span className="font-semibold">Campaign Chat</span>
            {campaignName && (
              <span className="text-xs text-muted-foreground">{campaignName}</span>
            )}
          </div>
          {presenceUsers.length > 0 && (
            <Badge variant="secondary" className="ml-2 text-xs">
              {presenceUsers.length} online
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          {connected ? (
            <div className="flex items-center gap-1 text-green-600">
              <Wifi className="w-4 h-4" />
              <span className="text-xs">Live</span>
            </div>
          ) : (
            <div className="flex items-center gap-1 text-orange-600">
              <WifiOff className="w-4 h-4" />
              <span className="text-xs">
                {connectionAttempts > 0 ? `Reconnecting (${connectionAttempts}/${MAX_RECONNECT_ATTEMPTS})` : "Offline"}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Channel Tabs */}
      <ChatChannelTabs
        tabs={tabsWithUnread}
        activeChannel={activeChannel}
        onChannelChange={handleChannelChange}
      />

      <div className="flex flex-col gap-3 border-b px-4 py-3">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {campaignCharacter ? (
            <>
              <span className="text-muted-foreground">Speaking as:</span>
              <span className="font-medium">
                {speakingInCharacter ? campaignCharacter.name : `${user.username} (OOC)`}
              </span>
              <div className="flex items-center gap-1.5 ml-auto">
                <span className="text-xs text-muted-foreground">IC</span>
                <Switch
                  checked={speakingInCharacter}
                  onCheckedChange={setSpeakingInCharacter}
                />
              </div>
            </>
          ) : (
            <div className="space-y-1">
              <span className="text-muted-foreground">Speaking as: {user.username} (OOC)</span>
              <p className="text-xs text-muted-foreground">
                No character enrolled in this campaign. Join with a character from the dashboard to speak in-character.
              </p>
            </div>
          )}
        </div>
        {charactersError && (
          <p className="text-xs text-red-500">{charactersError}</p>
        )}
        {typingIndicator && (
          <p className="text-sm text-muted-foreground">{typingIndicator}</p>
        )}
      </div>

      <ScrollArea className="flex-1 px-4">
        <div className="space-y-3 py-4">
          {filteredMessages.map((message) => (
            <div key={message.id} className={`flex gap-3 rounded p-2 ${getMessageStyling(message)}`}>
              <Avatar className="h-8 w-8">
                <AvatarFallback>
                  {message.character_name?.slice(0, 2) || message.sender_name.slice(0, 2)}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1 space-y-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">
                    {message.character_name ? `${message.character_name} (${message.username})` : message.username}
                  </span>
                  {getMessageIcon(message.message_type)}
                  <span className="text-xs text-muted-foreground">{formatTime(message.created_at)}</span>
                  {message.sender_id === user.id && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="ml-auto h-4 w-4 p-0 opacity-50 hover:opacity-100"
                      onClick={() => deleteMessage(message.id)}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  )}
                </div>
                <p className="text-sm">{message.content}</p>
                {message.dice_roll && (
                  <div className="text-xs font-mono text-muted-foreground">
                    {message.dice_roll.details || JSON.stringify(message.dice_roll)}
                  </div>
                )}
              </div>
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>
      </ScrollArea>

      <div className="border-t px-4 py-4">
        <div className="flex gap-2">
          <Input
            ref={messageInputRef}
            placeholder={inputPlaceholder}
            value={newMessage}
            onChange={(event) => {
              const value = event.target.value;
              setNewMessage(value);

              const hasValue = value.trim().length > 0;
              if (hasValue && !typingActiveRef.current) {
                startTyping();
                typingActiveRef.current = true;
              } else if (!hasValue && typingActiveRef.current) {
                stopTyping();
                typingActiveRef.current = false;
              }
            }}
            onKeyDown={async (event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                await handleTextSubmit();
              }
            }}
            onBlur={() => {
              if (typingActiveRef.current) {
                stopTyping();
                typingActiveRef.current = false;
              }
            }}
            className="flex-1"
            disabled={inputDisabled}
          />
          <Button onClick={handleTextSubmit} disabled={inputDisabled || !newMessage.trim()} size="sm">
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </Button>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
          const dice = prompt("Enter dice expression (e.g., 1d20+5, 2d6):");
          if (dice) {
            void rollDice(dice);
          }
        }}
      >
            <Dice6 className="mr-1 h-4 w-4" />
            Roll Dice
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setNewMessage("[OOC] ");
              typingActiveRef.current = true;
              startTyping();
              setTimeout(() => {
                messageInputRef.current?.focus();
                messageInputRef.current?.setSelectionRange(6, 6);
              }, 0);
              setSpeakingInCharacter(false);
            }}
          >
            OOC
          </Button>
    </div>
      </div>

      {!hasMessages && (
        <div className="border-t px-4 py-6 text-center text-muted-foreground">
          <Users className="mx-auto mb-4 h-12 w-12 opacity-50" />
          <p>No messages yet</p>
          <p className="text-sm">Be the first to say something!</p>
        </div>
      )}
    </div>
  );
}
