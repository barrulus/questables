import { useState, useEffect, useContext, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Badge } from "./ui/badge";
import { ScrollArea } from "./ui/scroll-area";
import { Avatar, AvatarFallback } from "./ui/avatar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { toast } from "sonner";
import { Send, Users, Crown, Dice6, Loader2, Trash2, AlertCircle, Wifi, WifiOff } from "lucide-react";
import { useUser } from "../contexts/UserContext";
import { characterHelpers } from '../utils/database/data-helpers';
import { createAsyncHandler, handleAsyncError } from '../utils/error-handling';
import { useWebSocket } from '../hooks/useWebSocket';

interface ChatMessage {
  id: string;
  campaign_id: string;
  content: string;
  message_type: 'text' | 'dice_roll' | 'system' | 'ooc';
  sender_id: string;
  sender_name: string;
  username: string;
  character_id?: string;
  character_name?: string;
  dice_roll?: any;
  created_at: string;
}

interface Character {
  id: string;
  name: string;
}

interface ChatSystemProps {
  campaignId: string;
}

export function ChatSystem({ campaignId }: ChatSystemProps) {
  const { user } = useUser();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [selectedCharacter, setSelectedCharacter] = useState<string>('');
  const [userCharacters, setUserCharacters] = useState<Character[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [charactersError, setCharactersError] = useState<string | null>(null);
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  
  // WebSocket integration  
  const { 
    connected, 
    messages: wsMessages, 
    typingUsers,
    presenceUsers,
    sendChatMessage, 
    startTyping,
    stopTyping,
    getMessagesByType,
    connectionAttempts
  } = useWebSocket(campaignId);
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Scroll to bottom when new messages arrive
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  // Load user's characters for character selection  
  const loadUserCharacters = async () => {
    if (!user) return;

    try {
      setCharactersError(null);
      const characters = await characterHelpers.getCharactersByUser(user.id);
      setUserCharacters(characters || []);
      
      // Auto-select first character if available
      if (characters?.length > 0 && !selectedCharacter) {
        setSelectedCharacter(characters[0].id);
      }
    } catch (error) {
      const errorMessage = handleAsyncError(error);
      setCharactersError(errorMessage);
      console.error('Failed to load user characters:', error);
    }
  };

  // Load initial campaign messages
  const loadMessages = async () => {
    try {
      setError(null);
      const response = await fetch(`/api/campaigns/${campaignId}/messages`);
      if (!response.ok) throw new Error('Failed to load messages');
      
      const messagesData = await response.json();
      setMessages(messagesData);
    } catch (error) {
      const errorMessage = handleAsyncError(error);
      setError(errorMessage);
      console.error('Failed to load messages:', error);
      toast.error('Failed to load chat messages');
    } finally {
      setLoading(false);
    }
  };

  // Handle incoming WebSocket messages
  useEffect(() => {
    const newChatMessages = getMessagesByType('new_message');
    if (newChatMessages.length > 0) {
      const latestMessage = newChatMessages[newChatMessages.length - 1];
      
      // Add new message to the chat
      setMessages(prev => {
        // Check if message already exists to avoid duplicates
        const messageExists = prev.some(msg => msg.id === latestMessage.data.id);
        if (!messageExists) {
          return [...prev, latestMessage.data];
        }
        return prev;
      });
      
      // Show toast notification for messages from other users
      if (latestMessage.data.sender_id !== user?.id) {
        toast.success(`New message from ${latestMessage.data.sender_name}`);
      }
    }
  }, [wsMessages, getMessagesByType, user]);

  // Initialize component
  useEffect(() => {
    if (user && campaignId) {
      loadUserCharacters();
      loadMessages();
    }
  }, [user, campaignId]);

  // Auto-scroll when new messages arrive
  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // Send a message using WebSocket
  const sendMessage = async (messageType: 'text' | 'dice_roll' | 'ooc' = 'text', diceRoll?: any) => {
    if (!user || !newMessage.trim()) return;

    try {
      setSending(true);
      
      if (connected) {
        // Send via WebSocket for real-time delivery
        sendChatMessage(newMessage.trim(), selectedCharacter || undefined);
        stopTyping();
        setNewMessage('');
      } else {
        // Fallback to HTTP if WebSocket not connected
        const messageData = {
          content: newMessage.trim(),
          type: messageType,
          sender_id: user.id,
          sender_name: user.username,
          character_id: selectedCharacter || null,
          dice_roll: diceRoll || null
        };

        const response = await fetch(`/api/campaigns/${campaignId}/messages`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(messageData)
        });

        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.error || 'Failed to send message');
        }

        setNewMessage('');
        // Reload messages if WebSocket isn't working
        await loadMessages();
      }
    } catch (error) {
      console.error('Failed to send message:', error);
      toast.error('Failed to send message');
    } finally {
      setSending(false);
    }
  };

  // Roll dice and send message
  const rollDice = async (diceExpression: string) => {
    if (!diceExpression.trim()) return;

    // Simple dice rolling logic
    const rollResult = evaluateDiceExpression(diceExpression);
    const content = `${user?.username} rolled ${diceExpression}: ${rollResult.total}`;
    
    setNewMessage(content);
    await sendMessage('dice_roll', rollResult);
  };

  // Simple dice expression evaluator
  const evaluateDiceExpression = (expression: string) => {
    // Basic d20 system: 1d20+5, 2d6, etc.
    const match = expression.match(/(\d+)?d(\d+)(?:([+-])(\d+))?/i);
    if (!match) {
      return { total: 0, rolls: [], expression };
    }

    const numDice = parseInt(match[1] || '1');
    const diceSize = parseInt(match[2]);
    const modifier = match[3] && match[4] ? (match[3] === '+' ? 1 : -1) * parseInt(match[4]) : 0;

    const rolls = [];
    for (let i = 0; i < numDice; i++) {
      rolls.push(Math.floor(Math.random() * diceSize) + 1);
    }

    const rollSum = rolls.reduce((sum, roll) => sum + roll, 0);
    const total = rollSum + modifier;

    return {
      expression,
      rolls,
      modifier,
      total,
      details: `${rolls.join(', ')}${modifier !== 0 ? ` ${modifier > 0 ? '+' : ''}${modifier}` : ''} = ${total}`
    };
  };

  // Delete message
  const deleteMessage = async (messageId: string) => {
    if (!user) return;

    try {
      const response = await fetch(`/api/campaigns/${campaignId}/messages/${messageId}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.id })
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to delete message');
      }

      // Remove message from local state
      setMessages(prev => prev.filter(msg => msg.id !== messageId));
      toast.success('Message deleted');
    } catch (error) {
      console.error('Failed to delete message:', error);
      toast.error('Failed to delete message');
    }
  };

  // Format message timestamp
  const formatTime = (timestamp: string) => {
    return new Date(timestamp).toLocaleTimeString([], { 
      hour: '2-digit', 
      minute: '2-digit' 
    });
  };

  // Get message icon
  const getMessageIcon = (type: string) => {
    switch (type) {
      case 'dice_roll': return <Dice6 className="w-4 h-4 text-blue-500" />;
      case 'system': return <Crown className="w-4 h-4 text-purple-500" />;
      case 'ooc': return <Users className="w-4 h-4 text-gray-500" />;
      default: return null;
    }
  };

  // Get message styling based on type
  const getMessageStyling = (message: ChatMessage) => {
    if (message.message_type === 'system') {
      return 'bg-purple-50 border-purple-200 text-purple-800';
    }
    if (message.message_type === 'dice_roll') {
      return 'bg-blue-50 border-blue-200 text-blue-800';
    }
    if (message.message_type === 'ooc') {
      return 'bg-gray-50 border-gray-200 text-gray-700';
    }
    return '';
  };

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
        <Button onClick={loadMessages} variant="outline">
          Try Again
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Card className="h-[500px] flex flex-col">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Users className="w-5 h-5" />
              Campaign Chat
              {presenceUsers.length > 0 && (
                <Badge variant="secondary" className="text-xs">
                  {presenceUsers.length} online
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-2">
              {/* WebSocket Connection Status */}
              {connected ? (
                <div className="flex items-center gap-1 text-green-600">
                  <Wifi className="w-4 h-4" />
                  <span className="text-xs">Live</span>
                </div>
              ) : (
                <div className="flex items-center gap-1 text-orange-600">
                  <WifiOff className="w-4 h-4" />
                  <span className="text-xs">
                    {connectionAttempts > 0 ? `Reconnecting (${connectionAttempts}/5)` : 'Offline'}
                  </span>
                </div>
              )}
            </div>
          </CardTitle>
        </CardHeader>
        
        <CardContent className="flex-1 flex flex-col p-0">
          {/* Messages Area */}
          <ScrollArea className="flex-1 px-4">
            <div className="space-y-3 py-4">
              {messages.map((message) => (
                <div key={message.id} className={`flex gap-3 p-2 rounded ${getMessageStyling(message)}`}>
                  <Avatar className="w-8 h-8">
                    <AvatarFallback>
                      {message.sender_name?.slice(0, 2) || 'U'}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm">
                        {message.character_name ? `${message.character_name} (${message.username})` : message.username}
                      </span>
                      {getMessageIcon(message.message_type)}
                      <span className="text-xs text-muted-foreground">
                        {formatTime(message.created_at)}
                      </span>
                      {message.sender_id === user.id && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-4 w-4 p-0 ml-auto opacity-50 hover:opacity-100"
                          onClick={() => deleteMessage(message.id)}
                        >
                          <Trash2 className="w-3 h-3" />
                        </Button>
                      )}
                    </div>
                    <p className="text-sm">{message.content}</p>
                    {message.dice_roll && (
                      <div className="text-xs text-muted-foreground font-mono">
                        {message.dice_roll.details || JSON.stringify(message.dice_roll)}
                      </div>
                    )}
                  </div>
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>
          </ScrollArea>

          {/* Input Area */}
          <div className="border-t p-4 space-y-3">
            {/* Character Selection */}
            {userCharacters.length > 0 && (
              <div className="flex items-center gap-2">
                <span className="text-sm">Speaking as:</span>
                <Select value={selectedCharacter} onValueChange={setSelectedCharacter}>
                  <SelectTrigger className="w-48">
                    <SelectValue placeholder="Select character" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">Out of Character</SelectItem>
                    {userCharacters.map((character) => (
                      <SelectItem key={character.id} value={character.id}>
                        {character.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Typing Indicators */}
            {typingUsers.length > 0 && (
              <div className="text-sm text-muted-foreground mb-2">
                {typingUsers.length === 1 
                  ? `${typingUsers[0]} is typing...`
                  : `${typingUsers.slice(0, -1).join(', ')} and ${typingUsers[typingUsers.length - 1]} are typing...`
                }
              </div>
            )}

            {/* Message Input */}
            <div className="flex gap-2">
              <Input
                placeholder="Type your message..."
                value={newMessage}
                onChange={(e) => {
                  setNewMessage(e.target.value);
                  // Start typing indicator
                  if (e.target.value && !newMessage) {
                    startTyping();
                  } else if (!e.target.value && newMessage) {
                    stopTyping();
                  }
                }}
                onKeyPress={(e) => e.key === 'Enter' && !e.shiftKey && sendMessage()}
                onBlur={() => stopTyping()}
                className="flex-1"
                disabled={sending}
              />
              <Button 
                onClick={() => sendMessage()}
                disabled={sending || !newMessage.trim()}
                size="sm"
              >
                {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              </Button>
            </div>

            {/* Action Buttons */}
            <div className="flex gap-2">
              <Button 
                variant="outline" 
                size="sm"
                onClick={() => {
                  const dice = prompt('Enter dice expression (e.g., 1d20+5, 2d6):');
                  if (dice) rollDice(dice);
                }}
              >
                <Dice6 className="w-4 h-4 mr-1" />
                Roll Dice
              </Button>
              <Button 
                variant="outline" 
                size="sm"
                onClick={() => {
                  setNewMessage('[OOC] ');
                  // Focus input after setting OOC prefix
                  setTimeout(() => {
                    const input = document.querySelector('input[placeholder="Type your message..."]') as HTMLInputElement;
                    input?.focus();
                    input?.setSelectionRange(6, 6); // Position cursor after '[OOC] '
                  }, 0);
                }}
              >
                OOC
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {messages.length === 0 && (
        <div className="text-center py-8 text-muted-foreground">
          <Users className="w-12 h-12 mx-auto mb-4 opacity-50" />
          <p>No messages yet</p>
          <p className="text-sm">Be the first to say something!</p>
        </div>
      )}
    </div>
  );
}
