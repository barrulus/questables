import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Badge } from "./ui/badge";
import { ScrollArea } from "./ui/scroll-area";
import { Tabs, TabsList, TabsTrigger } from "./ui/tabs";
import { Avatar, AvatarFallback } from "./ui/avatar";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "./ui/resizable";
import { 
  MapPin, 
  ZoomIn, 
  ZoomOut, 
  Move, 
  Flag, 
  Users, 
  Skull, 
  Crown,
  Send,
  MessageSquare,
  Map,
  Trees,
  Mountain,
  Waves
} from "lucide-react";

interface Message {
  id: number;
  sender: string;
  content: string;
  timestamp: Date;
  type: 'message' | 'roll' | 'system';
  channel: 'dm' | 'party';
}

interface MapPin {
  id: number;
  x: number;
  y: number;
  type: 'party' | 'enemy' | 'location' | 'treasure' | 'danger';
  name: string;
  visible: boolean;
}

export function MainContent() {
  const [messages, setMessages] = useState<Message[]>([]);

  const [activeChannel, setActiveChannel] = useState<'dm' | 'party'>('dm');
  const [messageInput, setMessageInput] = useState("");
  const [zoom, setZoom] = useState(100);
  const [selectedTool, setSelectedTool] = useState<'move' | 'pin'>('move');

  const [pins] = useState<MapPin[]>([]);

  const [partyMembers] = useState<Array<{ name: string; status: string; character: string }>>([]);

  const visiblePins = pins.filter((pin) => pin.visible);

  const filteredMessages = messages.filter(msg => msg.channel === activeChannel);

  const sendMessage = () => {
    if (!messageInput.trim()) return;

    const newMessage: Message = {
      id: Date.now(),
      sender: "You",
      content: messageInput.trim(),
      timestamp: new Date(),
      type: 'message',
      channel: activeChannel
    };

    setMessages(prev => [...prev, newMessage]);
    setMessageInput("");
  };

  const getPinIcon = (type: string) => {
    switch (type) {
      case 'party': return <Users className="w-4 h-4" />;
      case 'enemy': return <Skull className="w-4 h-4" />;
      case 'location': return <Flag className="w-4 h-4" />;
      case 'treasure': return <Crown className="w-4 h-4" />;
      case 'danger': return <Skull className="w-4 h-4" />;
      default: return <MapPin className="w-4 h-4" />;
    }
  };

  const getPinColor = (type: string) => {
    switch (type) {
      case 'party': return 'bg-blue-500';
      case 'enemy': return 'bg-red-500';
      case 'location': return 'bg-green-500';
      case 'treasure': return 'bg-yellow-500';
      case 'danger': return 'bg-orange-500';
      default: return 'bg-gray-500';
    }
  };

  return (
    <div className="flex-1 flex flex-col">
      <ResizablePanelGroup direction="horizontal" className="flex-1">
        {/* Map Panel */}
        <ResizablePanel defaultSize={60} minSize={40}>
          <Card className="h-full rounded-none border-0 border-r">
            <CardHeader className="pb-3">
              <div className="flex justify-between items-center">
                <CardTitle className="flex items-center gap-2">
                  <Map className="w-5 h-5" />
                  Campaign Map
                </CardTitle>
                <div className="flex items-center gap-2">
                  <Button
                    variant={selectedTool === 'move' ? "default" : "outline"}
                    size="sm"
                    onClick={() => setSelectedTool('move')}
                  >
                    <Move className="w-4 h-4" />
                  </Button>
                  <Button
                    variant={selectedTool === 'pin' ? "default" : "outline"}
                    size="sm"
                    onClick={() => setSelectedTool('pin')}
                  >
                    <MapPin className="w-4 h-4" />
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setZoom(Math.max(50, zoom - 25))}
                  >
                    <ZoomOut className="w-4 h-4" />
                  </Button>
                  <span className="text-sm font-medium">{zoom}%</span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setZoom(Math.min(200, zoom + 25))}
                  >
                    <ZoomIn className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {/* Map Canvas */}
              <div 
                className="relative bg-green-50 overflow-hidden"
                style={{ height: 'calc(100vh - 180px)' }}
              >
                <div 
                  className="absolute inset-0 bg-gradient-to-br from-green-100 to-brown-100"
                  style={{ transform: `scale(${zoom / 100})`, transformOrigin: 'top left' }}
                >
                  {/* Terrain features */}
                  <div className="absolute top-10 left-10 w-20 h-20 rounded-full bg-blue-200 opacity-50">
                    <Waves className="w-6 h-6 m-7 text-blue-600" />
                  </div>
                  <div className="absolute top-5 right-20 w-16 h-24 bg-gray-400 opacity-50 rounded-t-full">
                    <Mountain className="w-6 h-6 m-5 text-gray-700" />
                  </div>
                  <div className="absolute bottom-20 left-32 w-32 h-32 rounded-full bg-green-300 opacity-50">
                    <Trees className="w-8 h-8 m-12 text-green-700" />
                  </div>

                  {/* Grid overlay */}
                  <div className="absolute inset-0 opacity-20">
                    <svg width="100%" height="100%" className="absolute inset-0">
                      <defs>
                        <pattern id="grid" width="50" height="50" patternUnits="userSpaceOnUse">
                          <path d="M 50 0 L 0 0 0 50" fill="none" stroke="gray" strokeWidth="1"/>
                        </pattern>
                      </defs>
                      <rect width="100%" height="100%" fill="url(#grid)" />
                    </svg>
                  </div>

                  {/* Map pins */}
                  {visiblePins.map((pin) => (
                    <div
                      key={pin.id}
                      className={`absolute w-8 h-8 rounded-full ${getPinColor(pin.type)} flex items-center justify-center text-white cursor-pointer shadow-lg transform -translate-x-1/2 -translate-y-1/2 hover:scale-110 transition-transform`}
                      style={{ left: pin.x, top: pin.y }}
                      title={pin.name}
                    >
                      {getPinIcon(pin.type)}
                    </div>
                  ))}
                  {visiblePins.length === 0 && (
                    <div className="absolute inset-0 flex items-center justify-center">
                      <p className="rounded-full bg-black/30 px-4 py-2 text-sm text-white">
                        No map pins available. Load campaign data to plot locations.
                      </p>
                    </div>
                  )}

                  {/* Fog of war overlay */}
                  <div className="absolute inset-0 bg-black opacity-20 pointer-events-none" />
                </div>
              </div>
            </CardContent>
          </Card>
        </ResizablePanel>

        <ResizableHandle withHandle />

        {/* Chat Panel */}
        <ResizablePanel defaultSize={40} minSize={30}>
          <Card className="h-full rounded-none border-0">
            <CardContent className="p-0 h-full flex flex-col">
              <div className="p-4 border-b">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-semibold flex items-center gap-2">
                    <MessageSquare className="w-5 h-5" />
                    Campaign Chat
                  </h3>
                  <Badge variant="outline">{partyMembers.filter(m => m.status === 'online').length} online</Badge>
                </div>
                
                <Tabs value={activeChannel} onValueChange={(value) => setActiveChannel(value as 'dm' | 'party')}>
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
                </Tabs>
              </div>

              {/* Messages */}
              <ScrollArea className="flex-1 p-4">
                <div className="space-y-4">
                  {filteredMessages.map((message) => (
                    <div key={message.id} className="flex gap-3">
                      <Avatar className="w-8 h-8">
                        <AvatarFallback>
                          {message.sender === "DM" ? "DM" : message.sender.slice(0, 2)}
                        </AvatarFallback>
                      </Avatar>
                      <div className="flex-1 space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-sm">{message.sender}</span>
                          <span className="text-xs text-muted-foreground">
                            {message.timestamp.toLocaleTimeString()}
                          </span>
                          {message.type === 'roll' && <Badge variant="secondary" className="text-xs">Roll</Badge>}
                          {message.type === 'system' && <Badge variant="outline" className="text-xs">System</Badge>}
                        </div>
                        <p className="text-sm">{message.content}</p>
                      </div>
                    </div>
                  ))}
                  {filteredMessages.length === 0 && (
                    <p className="text-sm text-muted-foreground text-center">
                      No messages yet. Start the conversation to sync with the live chat service.
                    </p>
                  )}
                </div>
              </ScrollArea>

              {/* Message Input */}
              <div className="p-4 border-t">
                <div className="flex gap-2">
                  <Input
                    placeholder={`Message ${activeChannel === 'dm' ? 'DM' : 'party'}...`}
                    value={messageInput}
                    onChange={(e) => setMessageInput(e.target.value)}
                    onKeyPress={(e) => e.key === 'Enter' && sendMessage()}
                    className="flex-1"
                  />
                  <Button onClick={sendMessage} size="sm">
                    <Send className="w-4 h-4" />
                  </Button>
                </div>
                
                <div className="flex gap-2 mt-2">
                  <Button variant="outline" size="sm">Roll</Button>
                  <Button variant="outline" size="sm">Whisper</Button>
                  {activeChannel === 'party' && (
                    <Button variant="outline" size="sm">Share Item</Button>
                  )}
                </div>
              </div>

              {/* Party Members Sidebar */}
              <div className="border-t bg-muted/30 p-3">
                <h4 className="font-medium text-sm mb-2">Party Members</h4>
                <div className="space-y-1">
                  {partyMembers.map((member, index) => (
                    <div key={index} className="flex items-center justify-between text-sm">
                      <div className="flex items-center gap-2">
                        <div className={`w-2 h-2 rounded-full ${member.status === 'online' ? 'bg-green-500' : 'bg-gray-400'}`} />
                        <span>{member.name}</span>
                      </div>
                      <Badge 
                        variant={member.status === 'online' ? 'default' : 'secondary'}
                        className="text-xs"
                      >
                        {member.status}
                      </Badge>
                    </div>
                  ))}
                  {partyMembers.length === 0 && (
                    <p className="text-xs text-muted-foreground">No party roster loaded.</p>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}
