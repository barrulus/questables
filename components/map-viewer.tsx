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
  Castle,
  Trees,
  Mountain,
  Waves
} from "lucide-react";

interface MapPin {
  id: number;
  x: number;
  y: number;
  type: 'party' | 'enemy' | 'npc' | 'location' | 'treasure' | 'danger';
  name: string;
  description?: string;
  visible: boolean;
}

export function MapViewer() {
  const [zoom, setZoom] = useState(100);
  const [selectedTool, setSelectedTool] = useState<'move' | 'pin' | 'measure'>('move');
  const [pins, setPins] = useState<MapPin[]>([
    { id: 1, x: 150, y: 200, type: 'party', name: 'Party Location', visible: true },
    { id: 2, x: 300, y: 150, type: 'location', name: 'Ancient Ruins', description: 'Mysterious stone structures', visible: true },
    { id: 3, x: 450, y: 300, type: 'enemy', name: 'Goblin Camp', description: 'Hostile creatures spotted', visible: false },
    { id: 4, x: 200, y: 350, type: 'treasure', name: 'Hidden Cache', description: 'Buried treasure location', visible: false },
    { id: 5, x: 400, y: 100, type: 'danger', name: 'Dragon Lair', description: 'Dangerous territory', visible: true }
  ]);

  const [layers, setLayers] = useState({
    terrain: true,
    grid: true,
    fog: true,
    pins: true,
    notes: true
  });

  const tools = [
    { id: 'move', name: 'Move', icon: <Move className="w-4 h-4" /> },
    { id: 'pin', name: 'Add Pin', icon: <MapPin className="w-4 h-4" /> },
    { id: 'measure', name: 'Measure', icon: <Flag className="w-4 h-4" /> }
  ];

  const pinTypes = [
    { type: 'party', name: 'Party', icon: <Users className="w-4 h-4" />, color: 'bg-blue-500' },
    { type: 'enemy', name: 'Enemy', icon: <Skull className="w-4 h-4" />, color: 'bg-red-500' },
    { type: 'npc', name: 'NPC', icon: <Crown className="w-4 h-4" />, color: 'bg-purple-500' },
    { type: 'location', name: 'Location', icon: <Castle className="w-4 h-4" />, color: 'bg-green-500' },
    { type: 'treasure', name: 'Treasure', icon: <Flag className="w-4 h-4" />, color: 'bg-yellow-500' },
    { type: 'danger', name: 'Danger', icon: <Skull className="w-4 h-4" />, color: 'bg-orange-500' }
  ];

  const getPinIcon = (type: string) => {
    const pinType = pinTypes.find(p => p.type === type);
    return pinType ? pinType.icon : <MapPin className="w-4 h-4" />;
  };

  const getPinColor = (type: string) => {
    const pinType = pinTypes.find(p => p.type === type);
    return pinType ? pinType.color : 'bg-gray-500';
  };

  const handleMapClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (selectedTool === 'pin') {
      const rect = event.currentTarget.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      
      const newPin: MapPin = {
        id: Date.now(),
        x,
        y,
        type: 'location',
        name: `Pin ${pins.length + 1}`,
        visible: true
      };
      
      setPins(prev => [...prev, newPin]);
    }
  };

  const togglePinVisibility = (id: number) => {
    setPins(prev => prev.map(pin => 
      pin.id === id ? { ...pin, visible: !pin.visible } : pin
    ));
  };

  const deletePin = (id: number) => {
    setPins(prev => prev.filter(pin => pin.id !== id));
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Map Display */}
        <div className="lg:col-span-3">
          <Card>
            <CardHeader>
              <div className="flex justify-between items-center">
                <CardTitle className="flex items-center gap-2">
                  <MapPin className="w-5 h-5" />
                  Campaign Map
                </CardTitle>
                <div className="flex items-center gap-2">
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
            <CardContent>
              {/* Map Tools */}
              <div className="flex gap-2 mb-4">
                {tools.map((tool) => (
                  <Button
                    key={tool.id}
                    variant={selectedTool === tool.id ? "default" : "outline"}
                    size="sm"
                    onClick={() => setSelectedTool(tool.id as any)}
                  >
                    {tool.icon}
                    {tool.name}
                  </Button>
                ))}
              </div>

              {/* Map Canvas */}
              <div 
                className="relative border rounded-lg overflow-hidden bg-green-50"
                style={{ height: '500px' }}
                onClick={handleMapClick}
              >
                {/* Background terrain */}
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
                  {layers.grid && (
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
                  )}

                  {/* Map pins */}
                  {layers.pins && pins.filter(pin => pin.visible).map((pin) => (
                    <div
                      key={pin.id}
                      className={`absolute w-8 h-8 rounded-full ${getPinColor(pin.type)} flex items-center justify-center text-white cursor-pointer shadow-lg transform -translate-x-1/2 -translate-y-1/2 hover:scale-110 transition-transform`}
                      style={{ left: pin.x, top: pin.y }}
                      title={pin.name}
                    >
                      {getPinIcon(pin.type)}
                    </div>
                  ))}

                  {/* Fog of war overlay */}
                  {layers.fog && (
                    <div className="absolute inset-0 bg-black opacity-20 pointer-events-none" />
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Map Controls */}
        <div className="space-y-4">
          {/* Layer Controls */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Layers</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {Object.entries(layers).map(([layer, enabled]) => (
                <div key={layer} className="flex items-center justify-between">
                  <span className="text-sm capitalize">{layer}</span>
                  <Button
                    variant={enabled ? "default" : "outline"}
                    size="sm"
                    onClick={() => setLayers(prev => ({...prev, [layer]: !enabled}))}
                  >
                    {enabled ? "On" : "Off"}
                  </Button>
                </div>
              ))}
            </CardContent>
          </Card>

          {/* Pin Management */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Map Pins</CardTitle>
            </CardHeader>
            <CardContent>
              <Tabs defaultValue="list" className="space-y-2">
                <TabsList className="grid w-full grid-cols-2">
                  <TabsTrigger value="list">List</TabsTrigger>
                  <TabsTrigger value="add">Add</TabsTrigger>
                </TabsList>

                <TabsContent value="list" className="space-y-2">
                  <div className="max-h-64 overflow-y-auto space-y-2">
                    {pins.map((pin) => (
                      <div key={pin.id} className="p-2 border rounded text-sm">
                        <div className="flex items-center justify-between mb-1">
                          <div className="flex items-center gap-2">
                            <div className={`w-3 h-3 rounded-full ${getPinColor(pin.type)}`} />
                            <span className="font-medium">{pin.name}</span>
                          </div>
                          <div className="flex gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => togglePinVisibility(pin.id)}
                            >
                              {pin.visible ? "Hide" : "Show"}
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => deletePin(pin.id)}
                            >
                              ×
                            </Button>
                          </div>
                        </div>
                        {pin.description && (
                          <p className="text-xs text-muted-foreground">{pin.description}</p>
                        )}
                      </div>
                    ))}
                  </div>
                </TabsContent>

                <TabsContent value="add" className="space-y-2">
                  <div className="space-y-2">
                    <Input placeholder="Pin name" />
                    <select className="w-full p-2 border rounded">
                      {pinTypes.map((type) => (
                        <option key={type.type} value={type.type}>
                          {type.name}
                        </option>
                      ))}
                    </select>
                    <Input placeholder="Description (optional)" />
                    <Button size="sm" className="w-full">
                      Add Pin
                    </Button>
                  </div>
                  
                  <div className="text-xs text-muted-foreground">
                    Select "Add Pin" tool and click on the map to place
                  </div>
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>

          {/* Quick Actions */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Quick Actions</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <Button variant="outline" size="sm" className="w-full">
                Center on Party
              </Button>
              <Button variant="outline" size="sm" className="w-full">
                Reveal Area
              </Button>
              <Button variant="outline" size="sm" className="w-full">
                Clear Fog
              </Button>
              <Button variant="outline" size="sm" className="w-full">
                Export Map
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}