import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Badge } from "./ui/badge";
import { ScrollArea } from "./ui/scroll-area";
import { Avatar, AvatarFallback } from "./ui/avatar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { toast } from "sonner";
import { Send, Users, Crown, Dice6, Loader2, Trash2, AlertCircle, Wifi, WifiOff } from "lucide-react";
import { useUser } from "../contexts/UserContext";
import { useWebSocket } from "../hooks/useWebSocket";
import { apiFetch, readErrorMessage, readJsonBody } from "../utils/api-client";
import { handleAsyncError } from "../utils/error-handling";

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
  created_at: string;
}

interface CharacterOption {
  id: string;
  name: string;
}

interface ChatSystemProps {
  campaignId: string;
  campaignName?: string;
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
  created_at: string;
}

interface ApiCharacterSummary {
  id: string;
  name: string;
}

const MAX_RECONNECT_ATTEMPTS = 5;
const OUT_OF_CHARACTER_VALUE = "__out_of_character__";

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
    created_at: raw.created_at,
  };
}

export function ChatSystem({ campaignId, campaignName }: ChatSystemProps) {
  const { user } = useUser();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [newMessage, setNewMessage] = useState("");
  const [selectedCharacter, setSelectedCharacter] = useState<string>(OUT_OF_CHARACTER_VALUE);
  const [userCharacters, setUserCharacters] = useState<CharacterOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [charactersError, setCharactersError] = useState<string | null>(null);

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

  const hasMessages = messages.length > 0;

  const loadUserCharacters = useCallback(async (signal?: AbortSignal) => {
    if (!user) {
      return;
    }

    try {
      setCharactersError(null);
      const response = await apiFetch(`/api/users/${user.id}/characters`, { signal });
      if (!response.ok) {
        throw new Error(await readErrorMessage(response, "Failed to load characters"));
      }

      const payload = await readJsonBody<{ characters?: unknown }>(response);

      if (payload && payload.characters !== undefined && !Array.isArray(payload.characters)) {
        throw new Error("Unexpected characters payload format");
      }

      const options = (payload?.characters as ApiCharacterSummary[] | undefined)
        ?.filter((character) => typeof character.id === "string" && character.id.trim().length > 0)
        .map((character) => ({
          id: character.id,
          name: character.name,
        })) ?? [];

      setUserCharacters(options);
      setSelectedCharacter((prev) => {
        if (prev !== OUT_OF_CHARACTER_VALUE) {
          return prev;
        }
        return options[0]?.id ?? OUT_OF_CHARACTER_VALUE;
      });
    } catch (loadError) {
      if (loadError instanceof DOMException && loadError.name === "AbortError") {
        return;
      }
      const errorMessage = handleAsyncError(loadError);
      setCharactersError(errorMessage);
      console.error("Failed to load user characters:", loadError);
    }
  }, [user]);

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
      setUserCharacters([]);
      setSelectedCharacter("");
      return;
    }

    const controller = new AbortController();
    loadUserCharacters(controller.signal);
    return () => controller.abort();
  }, [loadUserCharacters, user]);

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

    if (incoming.sender_id !== user?.id) {
      toast.success(`New message from ${incoming.sender_name}`);
    }
  }, [wsMessages, user]);

  useEffect(() => {
    if (loading) {
      return;
    }
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

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

        const response = await apiFetch(`/api/campaigns/${campaignId}/messages`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            content: trimmed,
          type: messageType,
          sender_id: user.id,
          sender_name: user.username || user.email,
          character_id: selectedCharacter === OUT_OF_CHARACTER_VALUE ? null : selectedCharacter,
          dice_roll: diceRoll ?? null,
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
          senderId: persisted.sender_id,
          senderName: persisted.sender_name,
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
    [campaignId, connected, selectedCharacter, sendChatMessage, stopTyping, user]
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
      const speaker = selectedCharacter === OUT_OF_CHARACTER_VALUE
        ? user?.username || "You"
        : userCharacters.find((character) => character.id === selectedCharacter)?.name || user?.username || "You";
      const content = `${speaker} rolled ${trimmed}: ${rollResult.total}`;

      await sendStructuredMessage({ content, messageType: "dice_roll", diceRoll: rollResult });
    },
    [selectedCharacter, sendStructuredMessage, user?.username, userCharacters]
  );

  const deleteMessage = useCallback(
    async (messageId: string) => {
      if (!user) {
        return;
      }

      try {
        const response = await apiFetch(`/api/campaigns/${campaignId}/messages/${messageId}`, {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userId: user.id }),
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

      <div className="flex flex-col gap-3 border-b px-4 py-3">
        {userCharacters.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span>Speaking as:</span>
            <Select value={selectedCharacter} onValueChange={setSelectedCharacter}>
              <SelectTrigger className="w-48">
                <SelectValue placeholder="Out of Character" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={OUT_OF_CHARACTER_VALUE}>Out of Character</SelectItem>
                {userCharacters.map((character) => (
                  <SelectItem key={character.id} value={character.id}>
                    {character.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        {charactersError && (
          <p className="text-xs text-red-500">{charactersError}</p>
        )}
        {typingIndicator && (
          <p className="text-sm text-muted-foreground">{typingIndicator}</p>
        )}
      </div>

      <ScrollArea className="flex-1 px-4">
        <div className="space-y-3 py-4">
          {messages.map((message) => (
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
            placeholder="Type your message..."
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
            disabled={sending}
          />
          <Button onClick={handleTextSubmit} disabled={sending || !newMessage.trim()} size="sm">
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
          setSelectedCharacter(OUT_OF_CHARACTER_VALUE);
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
