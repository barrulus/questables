import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";
import { Input } from "./ui/input";
import { 
  MapPin, 
  ZoomIn, 
  ZoomOut, 
  Move, 
  Flag, 
  Users, 
  Skull, 
  Crown,
  Globe,
  Crosshair,
  Trees,
  Mountain,
  Waves,
  Castle,
  Home,
  Tent
} from "lucide-react";

interface MapPin {
  id: number;
  x: number;
  y: number;
  type: 'party' | 'enemy' | 'location' | 'treasure' | 'danger' | 'town' | 'dungeon';
  name: string;
  visible: boolean;
}

export function EnhancedMap() {
  const [mapMode, setMapMode] = useState<'world' | 'encounter'>('world');
  const [zoom, setZoom] = useState(100);
  const [selectedTool, setSelectedTool] = useState<'move' | 'pin'>('move');

  // World map pins - broader locations
  const [worldPins] = useState<MapPin[]>([
    { id: 1, x: 200, y: 150, type: 'town', name: 'Rivendell', visible: true },
    { id: 2, x: 400, y: 200, type: 'location', name: 'Misty Mountains', visible: true },
    { id: 3, x: 600, y: 300, type: 'dungeon', name: 'Moria', visible: true },
    { id: 4, x: 300, y: 400, type: 'location', name: 'Fangorn Forest', visible: true },
    { id: 5, x: 500, y: 450, type: 'town', name: 'Edoras', visible: true },
    { id: 6, x: 150, y: 300, type: 'party', name: 'Party Location', visible: true }
  ]);

  // Encounter map pins - tactical locations
  const [encounterPins] = useState<MapPin[]>([
    { id: 1, x: 150, y: 200, type: 'party', name: 'Party Location', visible: true },
    { id: 2, x: 300, y: 150, type: 'location', name: 'Ancient Altar', visible: true },
    { id: 3, x: 450, y: 300, type: 'enemy', name: 'Goblin Ambush', visible: true },
    { id: 4, x: 200, y: 350, type: 'treasure', name: 'Hidden Cache', visible: false },
    { id: 5, x: 400, y: 100, type: 'danger', name: 'Trap', visible: true }
  ]);

  const currentPins = mapMode === 'world' ? worldPins : encounterPins;

  const tools = [
    { id: 'move', name: 'Move', icon: <Move className="w-4 h-4" /> },
    { id: 'pin', name: 'Add Pin', icon: <MapPin className="w-4 h-4" /> }
  ];

  const getPinIcon = (type: string) => {
    switch (type) {
      case 'party': return <Users className="w-4 h-4" />;
      case 'enemy': return <Skull className="w-4 h-4" />;
      case 'location': return <Flag className="w-4 h-4" />;
      case 'treasure': return <Crown className="w-4 h-4" />;
      case 'danger': return <Skull className="w-4 h-4" />;
      case 'town': return <Home className="w-4 h-4" />;
      case 'dungeon': return <Castle className="w-4 h-4" />;
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
      case 'town': return 'bg-purple-500';
      case 'dungeon': return 'bg-gray-600';
      default: return 'bg-gray-500';
    }
  };

  const renderWorldMap = () => (
    <div className="relative w-full h-full bg-gradient-to-br from-green-100 via-yellow-50 to-blue-100">
      {/* World terrain features */}
      <div className="absolute top-16 left-32 w-32 h-24 bg-gray-400 opacity-60 rounded-lg">
        <Mountain className="w-8 h-8 m-8 text-gray-700" />
        <div className="text-xs text-center text-gray-700 mt-1">Misty Mountains</div>
      </div>
      
      <div className="absolute bottom-32 left-48 w-40 h-40 rounded-full bg-green-300 opacity-60">
        <Trees className="w-10 h-10 m-16 text-green-700" />
        <div className="text-xs text-center text-green-700 mt-2">Fangorn Forest</div>
      </div>
      
      <div className="absolute top-32 right-24 w-24 h-16 rounded-full bg-blue-300 opacity-60">
        <Waves className="w-6 h-6 m-5 text-blue-600" />
        <div className="text-xs text-center text-blue-600 mt-1">River</div>
      </div>

      {/* Roads/Paths */}
      <svg className="absolute inset-0 w-full h-full pointer-events-none">
        <path 
          d="M 150 300 Q 300 250 500 450" 
          stroke="#8B4513" 
          strokeWidth="3" 
          fill="none" 
          strokeDasharray="5,5"
          opacity="0.6"
        />
        <path 
          d="M 200 150 Q 400 200 600 300" 
          stroke="#8B4513" 
          strokeWidth="3" 
          fill="none" 
          strokeDasharray="5,5"
          opacity="0.6"
        />
      </svg>
    </div>
  );

  const renderEncounterMap = () => (
    <div className="relative w-full h-full bg-gradient-to-br from-stone-200 to-stone-300">
      {/* Grid overlay for tactical positioning */}
      <div className="absolute inset-0 opacity-30">
        <svg width="100%" height="100%">
          <defs>
            <pattern id="encounterGrid" width="25" height="25" patternUnits="userSpaceOnUse">
              <path d="M 25 0 L 0 0 0 25" fill="none" stroke="gray" strokeWidth="1"/>
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#encounterGrid)" />
        </svg>
      </div>

      {/* Encounter terrain */}
      <div className="absolute top-20 left-20 w-24 h-16 bg-stone-400 rounded opacity-70">
        <div className="text-xs text-center text-stone-700 mt-5">Ruins</div>
      </div>
      
      <div className="absolute bottom-24 right-32 w-20 h-20 rounded-full bg-green-400 opacity-70">
        <Trees className="w-6 h-6 m-7 text-green-700" />
      </div>
      
      <div className="absolute top-40 right-16 w-16 h-12 bg-brown-400 rounded opacity-70">
        <div className="text-xs text-center text-brown-700 mt-3">Rocks</div>
      </div>

      {/* Measurement reference */}
      <div className="absolute bottom-4 left-4 text-xs text-muted-foreground">
        Each square = 5 feet
      </div>
    </div>
  );

  return (
    <Card className="h-full rounded-none border-0 border-r">
      <CardHeader className="pb-3">
        <div className="flex justify-between items-center">
          <CardTitle className="flex items-center gap-2">
            {mapMode === 'world' ? <Globe className="w-5 h-5" /> : <Crosshair className="w-5 h-5" />}
            {mapMode === 'world' ? 'World Map' : 'Encounter Map'}
          </CardTitle>
          <div className="flex items-center gap-2">
            {/* Map Mode Toggle */}
            <Tabs value={mapMode} onValueChange={(value) => setMapMode(value as 'world' | 'encounter')}>
              <TabsList className="h-8">
                <TabsTrigger value="world" className="h-6 px-2 text-xs">
                  <Globe className="w-3 h-3 mr-1" />
                  World
                </TabsTrigger>
                <TabsTrigger value="encounter" className="h-6 px-2 text-xs">
                  <Crosshair className="w-3 h-3 mr-1" />
                  Encounter
                </TabsTrigger>
              </TabsList>
            </Tabs>

            <div className="flex items-center gap-1 border-l pl-2">
              {tools.map((tool) => (
                <Button
                  key={tool.id}
                  variant={selectedTool === tool.id ? "default" : "outline"}
                  size="sm"
                  onClick={() => setSelectedTool(tool.id as any)}
                  className="h-8 px-2"
                >
                  {tool.icon}
                </Button>
              ))}
            </div>

            <div className="flex items-center gap-1 border-l pl-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setZoom(Math.max(50, zoom - 25))}
                className="h-8 px-2"
              >
                <ZoomOut className="w-3 h-3" />
              </Button>
              <span className="text-xs font-medium w-12 text-center">{zoom}%</span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setZoom(Math.min(200, zoom + 25))}
                className="h-8 px-2"
              >
                <ZoomIn className="w-3 h-3" />
              </Button>
            </div>
          </div>
        </div>
      </CardHeader>
      
      <CardContent className="p-0">
        <div 
          className="relative overflow-hidden"
          style={{ height: 'calc(100vh - 140px)' }}
        >
          <div 
            className="absolute inset-0"
            style={{ transform: `scale(${zoom / 100})`, transformOrigin: 'top left' }}
          >
            {mapMode === 'world' ? renderWorldMap() : renderEncounterMap()}
            
            {/* Map pins */}
            {currentPins.filter(pin => pin.visible).map((pin) => (
              <div
                key={pin.id}
                className={`absolute w-8 h-8 rounded-full ${getPinColor(pin.type)} flex items-center justify-center text-white cursor-pointer shadow-lg transform -translate-x-1/2 -translate-y-1/2 hover:scale-110 transition-transform z-10`}
                style={{ left: pin.x, top: pin.y }}
                title={pin.name}
              >
                {getPinIcon(pin.type)}
              </div>
            ))}
          </div>
        </div>
      </CardContent>

      {/* Map Info Panel */}
      <div className="border-t p-3 bg-muted/30">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4 text-xs text-muted-foreground">
            <span>Pins: {currentPins.filter(p => p.visible).length}</span>
            <span>Mode: {mapMode === 'world' ? 'Exploration' : 'Tactical'}</span>
          </div>
          <div className="flex gap-1">
            <Button variant="ghost" size="sm" className="h-6 px-2 text-xs">
              Save View
            </Button>
            <Button variant="ghost" size="sm" className="h-6 px-2 text-xs">
              Share
            </Button>
          </div>
        </div>
      </div>
    </Card>
  );
}