import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Badge } from "./ui/badge";
import { ScrollArea } from "./ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";
import { Avatar, AvatarFallback } from "./ui/avatar";
import { Send, Users, Crown, Dice6 } from "lucide-react";

interface Message {
  id: number;
  sender: string;
  content: string;
  timestamp: Date;
  type: 'message' | 'roll' | 'system';
  isPrivate?: boolean;
}

export function ChatSystem() {
  const [dmMessages, setDmMessages] = useState<Message[]>([
    {
      id: 1,
      sender: "DM",
      content: "Welcome to the session! You find yourselves at the entrance to the ancient ruins.",
      timestamp: new Date(Date.now() - 10 * 60000),
      type: 'message'
    },
    {
      id: 2,
      sender: "DM",
      content: "Roll for initiative as you hear footsteps echoing from within.",
      timestamp: new Date(Date.now() - 8 * 60000),
      type: 'system'
    },
    {
      id: 3,
      sender: "You",
      content: "I rolled a 15 for initiative",
      timestamp: new Date(Date.now() - 7 * 60000),
      type: 'roll'
    },
    {
      id: 4,
      sender: "DM",
      content: "A group of goblins emerges from the shadows! Combat begins.",
      timestamp: new Date(Date.now() - 5 * 60000),
      type: 'message'
    }
  ]);

  const [partyMessages, setPartyMessages] = useState<Message[]>([
    {
      id: 1,
      sender: "Gandalf",
      content: "Should we try the stealth approach?",
      timestamp: new Date(Date.now() - 15 * 60000),
      type: 'message'
    },
    {
      id: 2,
      sender: "Legolas",
      content: "I can cover you with my bow from here",
      timestamp: new Date(Date.now() - 12 * 60000),
      type: 'message'
    },
    {
      id: 3,
      sender: "You",
      content: "I'll take point and scout ahead",
      timestamp: new Date(Date.now() - 10 * 60000),
      type: 'message'
    },
    {
      id: 4,
      sender: "Gimli",
      content: "And my axe!",
      timestamp: new Date(Date.now() - 8 * 60000),
      type: 'message'
    }
  ]);

  const [dmInput, setDmInput] = useState("");
  const [partyInput, setPartyInput] = useState("");

  const partyMembers = [
    { name: "You", status: "online", character: "Aragorn" },
    { name: "Gandalf", status: "online", character: "Gandalf the Grey" },
    { name: "Legolas", status: "online", character: "Legolas Greenleaf" },
    { name: "Gimli", status: "online", character: "Gimli, son of Glóin" },
    { name: "Boromir", status: "away", character: "Boromir of Gondor" }
  ];

  const sendMessage = (content: string, type: 'dm' | 'party') => {
    if (!content.trim()) return;

    const newMessage: Message = {
      id: Date.now(),
      sender: "You",
      content: content.trim(),
      timestamp: new Date(),
      type: 'message'
    };

    if (type === 'dm') {
      setDmMessages(prev => [...prev, newMessage]);
      setDmInput("");
    } else {
      setPartyMessages(prev => [...prev, newMessage]);
      setPartyInput("");
    }
  };

  const getMessageIcon = (type: string) => {
    switch (type) {
      case 'roll': return <Dice6 className="w-4 h-4" />;
      case 'system': return <Crown className="w-4 h-4" />;
      default: return null;
    }
  };

  const MessageList = ({ messages }: { messages: Message[] }) => (
    <ScrollArea className="h-96 w-full">
      <div className="space-y-3 p-4">
        {messages.map((message) => (
          <div key={message.id} className="flex gap-3">
            <Avatar className="w-8 h-8">
              <AvatarFallback>
                {message.sender === "DM" ? "DM" : message.sender.slice(0, 2)}
              </AvatarFallback>
            </Avatar>
            <div className="flex-1 space-y-1">
              <div className="flex items-center gap-2">
                <span className="font-medium text-sm">{message.sender}</span>
                {getMessageIcon(message.type)}
                <span className="text-xs text-muted-foreground">
                  {message.timestamp.toLocaleTimeString()}
                </span>
                {message.isPrivate && <Badge variant="secondary" className="text-xs">Private</Badge>}
              </div>
              <p className="text-sm">{message.content}</p>
            </div>
          </div>
        ))}
      </div>
    </ScrollArea>
  );

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Party Members */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="w-5 h-5" />
              Party Members
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {partyMembers.map((member, index) => (
                <div key={index} className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Avatar className="w-8 h-8">
                      <AvatarFallback>{member.name.slice(0, 2)}</AvatarFallback>
                    </Avatar>
                    <div>
                      <div className="font-medium text-sm">{member.name}</div>
                      <div className="text-xs text-muted-foreground">{member.character}</div>
                    </div>
                  </div>
                  <Badge 
                    variant={member.status === 'online' ? 'default' : 'secondary'}
                    className="text-xs"
                  >
                    {member.status}
                  </Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Chat Tabs */}
        <div className="lg:col-span-3">
          <Card>
            <CardContent className="p-0">
              <Tabs defaultValue="dm" className="h-full">
                <TabsList className="grid w-full grid-cols-2">
                  <TabsTrigger value="dm" className="flex items-center gap-2">
                    <Crown className="w-4 h-4" />
                    DM Chat
                  </TabsTrigger>
                  <TabsTrigger value="party" className="flex items-center gap-2">
                    <Users className="w-4 h-4" />
                    Party Chat
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="dm" className="mt-0">
                  <div className="border-t">
                    <MessageList messages={dmMessages} />
                    <div className="p-4 border-t">
                      <div className="flex gap-2">
                        <Input
                          placeholder="Message to DM..."
                          value={dmInput}
                          onChange={(e) => setDmInput(e.target.value)}
                          onKeyPress={(e) => e.key === 'Enter' && sendMessage(dmInput, 'dm')}
                          className="flex-1"
                        />
                        <Button 
                          onClick={() => sendMessage(dmInput, 'dm')}
                          size="sm"
                        >
                          <Send className="w-4 h-4" />
                        </Button>
                      </div>
                      <div className="flex gap-2 mt-2">
                        <Button variant="outline" size="sm">Whisper</Button>
                        <Button variant="outline" size="sm">Roll</Button>
                        <Button variant="outline" size="sm">Initiative</Button>
                      </div>
                    </div>
                  </div>
                </TabsContent>

                <TabsContent value="party" className="mt-0">
                  <div className="border-t">
                    <MessageList messages={partyMessages} />
                    <div className="p-4 border-t">
                      <div className="flex gap-2">
                        <Input
                          placeholder="Message to party..."
                          value={partyInput}
                          onChange={(e) => setPartyInput(e.target.value)}
                          onKeyPress={(e) => e.key === 'Enter' && sendMessage(partyInput, 'party')}
                          className="flex-1"
                        />
                        <Button 
                          onClick={() => sendMessage(partyInput, 'party')}
                          size="sm"
                        >
                          <Send className="w-4 h-4" />
                        </Button>
                      </div>
                      <div className="flex gap-2 mt-2">
                        <Button variant="outline" size="sm">Roll</Button>
                        <Button variant="outline" size="sm">Share Item</Button>
                        <Button variant="outline" size="sm">Strategy</Button>
                      </div>
                    </div>
                  </div>
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}