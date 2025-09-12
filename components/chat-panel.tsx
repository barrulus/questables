import { useState } from "react";
import { Card, CardContent } from "./ui/card";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Badge } from "./ui/badge";
import { ScrollArea } from "./ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";
import { Avatar, AvatarFallback } from "./ui/avatar";
import { 
  Send,
  MessageSquare,
  Users,
  Crown,
  Dice6,
  Eye,
  EyeOff
} from "lucide-react";

interface Message {
  id: number;
  sender: string;
  content: string;
  timestamp: Date;
  type: 'message' | 'roll' | 'system' | 'whisper';
  channel: 'dm' | 'party';
  isPrivate?: boolean;
}

export function ChatPanel() {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: 1,
      sender: "DM",
      content: "Welcome to the session! You find yourselves at the entrance to the ancient ruins.",
      timestamp: new Date(Date.now() - 10 * 60000),
      type: 'message',
      channel: 'dm'
    },
    {
      id: 2,
      sender: "Legolas",
      content: "I can cover you with my bow from here",
      timestamp: new Date(Date.now() - 8 * 60000),
      type: 'message',
      channel: 'party'
    },
    {
      id: 3,
      sender: "DM",
      content: "Roll for initiative as you hear footsteps echoing from within.",
      timestamp: new Date(Date.now() - 5 * 60000),
      type: 'system',
      channel: 'dm'
    },
    {
      id: 4,
      sender: "You",
      content: "I rolled a 18 for initiative (d20: 15 + 3)",
      timestamp: new Date(Date.now() - 3 * 60000),
      type: 'roll',
      channel: 'dm'
    },
    {
      id: 5,
      sender: "DM",
      content: "A group of goblins emerges from the shadows! Combat begins.",
      timestamp: new Date(Date.now() - 1 * 60000),
      type: 'message',
      channel: 'dm'
    },
    {
      id: 6,
      sender: "Gimli",
      content: "And my axe!",
      timestamp: new Date(Date.now() - 30000),
      type: 'message',
      channel: 'party'
    }
  ]);

  const [activeChannel, setActiveChannel] = useState<'dm' | 'party'>('dm');
  const [messageInput, setMessageInput] = useState("");
  const [isWhisper, setIsWhisper] = useState(false);

  const partyMembers = [
    { name: "You", status: "online", character: "Aragorn", isPlayer: true },
    { name: "Gandalf", status: "online", character: "Gandalf the Grey", isPlayer: true },
    { name: "Legolas", status: "online", character: "Legolas Greenleaf", isPlayer: true },
    { name: "Gimli", status: "online", character: "Gimli, son of Glóin", isPlayer: true },
    { name: "Boromir", status: "away", character: "Boromir of Gondor", isPlayer: true },
    { name: "DM", status: "online", character: "Dungeon Master", isPlayer: false }
  ];

  const filteredMessages = messages.filter(msg => msg.channel === activeChannel);
  const unreadCounts = {
    dm: messages.filter(m => m.channel === 'dm' && m.sender !== 'You').length,
    party: messages.filter(m => m.channel === 'party' && m.sender !== 'You').length
  };

  const sendMessage = () => {
    if (!messageInput.trim()) return;

    const newMessage: Message = {
      id: Date.now(),
      sender: "You",
      content: messageInput.trim(),
      timestamp: new Date(),
      type: isWhisper ? 'whisper' : 'message',
      channel: activeChannel,
      isPrivate: isWhisper
    };

    setMessages(prev => [...prev, newMessage]);
    setMessageInput("");
    setIsWhisper(false);
  };

  const getMessageIcon = (type: string, isPrivate: boolean = false) => {
    if (isPrivate) return <EyeOff className="w-3 h-3" />;
    switch (type) {
      case 'roll': return <Dice6 className="w-3 h-3" />;
      case 'system': return <Crown className="w-3 h-3" />;
      case 'whisper': return <EyeOff className="w-3 h-3" />;
      default: return null;
    }
  };

  const quickActions = activeChannel === 'dm' 
    ? [
        { label: "Roll d20", action: () => {} },
        { label: "Initiative", action: () => {} },
        { label: "Save", action: () => {} }
      ]
    : [
        { label: "Share Item", action: () => {} },
        { label: "Strategy", action: () => {} },
        { label: "Help", action: () => {} }
      ];

  return (
    <Card className="h-full rounded-none border-0 flex flex-col">
      <CardContent className="p-0 h-full flex flex-col">
        {/* Header */}
        <div className="p-4 border-b">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold flex items-center gap-2">
              <MessageSquare className="w-5 h-5" />
              Campaign Chat
            </h3>
            <Badge variant="outline" className="text-xs">
              {partyMembers.filter(m => m.status === 'online').length} online
            </Badge>
          </div>
          
          <Tabs value={activeChannel} onValueChange={(value) => setActiveChannel(value as 'dm' | 'party')}>
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="dm" className="flex items-center gap-2 relative">
                <Crown className="w-4 h-4" />
                DM Chat
                {unreadCounts.dm > 0 && activeChannel !== 'dm' && (
                  <Badge variant="destructive" className="absolute -top-1 -right-1 h-5 w-5 p-0 text-xs">
                    {unreadCounts.dm}
                  </Badge>
                )}
              </TabsTrigger>
              <TabsTrigger value="party" className="flex items-center gap-2 relative">
                <Users className="w-4 h-4" />
                Party Chat
                {unreadCounts.party > 0 && activeChannel !== 'party' && (
                  <Badge variant="destructive" className="absolute -top-1 -right-1 h-5 w-5 p-0 text-xs">
                    {unreadCounts.party}
                  </Badge>
                )}
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>

        {/* Messages */}
        <ScrollArea className="flex-1 p-4">
          <div className="space-y-4">
            {filteredMessages.map((message) => (
              <div key={message.id} className="flex gap-3">
                <Avatar className="w-8 h-8 shrink-0">
                  <AvatarFallback className={
                    message.sender === "DM" ? "bg-purple-100 text-purple-600" :
                    message.sender === "You" ? "bg-blue-100 text-blue-600" :
                    "bg-green-100 text-green-600"
                  }>
                    {message.sender === "DM" ? "DM" : message.sender.slice(0, 2)}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1 space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm">{message.sender}</span>
                    {getMessageIcon(message.type, message.isPrivate)}
                    <span className="text-xs text-muted-foreground">
                      {message.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                    {message.type === 'roll' && <Badge variant="secondary" className="text-xs">Roll</Badge>}
                    {message.type === 'system' && <Badge variant="outline" className="text-xs">System</Badge>}
                    {message.type === 'whisper' && <Badge variant="destructive" className="text-xs">Whisper</Badge>}
                  </div>
                  <p className={`text-sm ${message.isPrivate ? 'italic text-muted-foreground' : ''}`}>
                    {message.content}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </ScrollArea>

        {/* Message Input */}
        <div className="p-4 border-t space-y-3">
          <div className="flex gap-2">
            <div className="flex-1 relative">
              <Input
                placeholder={`${isWhisper ? 'Whisper to ' : 'Message '}${activeChannel === 'dm' ? 'DM' : 'party'}...`}
                value={messageInput}
                onChange={(e) => setMessageInput(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && sendMessage()}
                className={isWhisper ? 'border-orange-300 bg-orange-50' : ''}
              />
              {isWhisper && (
                <EyeOff className="absolute right-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-orange-500" />
              )}
            </div>
            <Button onClick={sendMessage} size="sm" className="px-3">
              <Send className="w-4 h-4" />
            </Button>
          </div>
          
          <div className="flex gap-2 flex-wrap">
            <Button 
              variant={isWhisper ? "default" : "outline"} 
              size="sm"
              onClick={() => setIsWhisper(!isWhisper)}
              className="h-7"
            >
              <EyeOff className="w-3 h-3 mr-1" />
              Whisper
            </Button>
            {quickActions.map((action, index) => (
              <Button 
                key={index}
                variant="outline" 
                size="sm"
                onClick={action.action}
                className="h-7"
              >
                {action.label}
              </Button>
            ))}
          </div>
        </div>

        {/* Party Members */}
        <div className="border-t bg-muted/30 p-3">
          <h4 className="font-medium text-sm mb-2">Party Members</h4>
          <div className="space-y-1">
            {partyMembers.map((member, index) => (
              <div key={index} className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-2">
                  <div className={`w-2 h-2 rounded-full ${
                    member.status === 'online' ? 'bg-green-500' : 'bg-gray-400'
                  }`} />
                  <Avatar className="w-6 h-6">
                    <AvatarFallback className={
                      member.name === "DM" ? "bg-purple-100 text-purple-600 text-xs" :
                      member.name === "You" ? "bg-blue-100 text-blue-600 text-xs" :
                      "bg-green-100 text-green-600 text-xs"
                    }>
                      {member.name === "DM" ? "DM" : member.name.slice(0, 2)}
                    </AvatarFallback>
                  </Avatar>
                  <div>
                    <div className="font-medium">{member.name}</div>
                    <div className="text-xs text-muted-foreground">{member.character}</div>
                  </div>
                </div>
                <Badge 
                  variant={member.status === 'online' ? 'default' : 'secondary'}
                  className="text-xs h-5"
                >
                  {member.status}
                </Badge>
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}