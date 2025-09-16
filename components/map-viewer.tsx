import { useState, useEffect, useContext } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";
import { Input } from "./ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { useUser } from "../contexts/UserContext";
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
  Waves,
  Loader2
} from "lucide-react";

interface WorldMap {
  id: string;
  name: string;
  description: string;
  bounds: { north: number; south: number; east: number; west: number };
  layers: { political: boolean; terrain: boolean; rivers: boolean; routes: boolean };
  uploaded_by: string;
  uploaded_by_username?: string;
}

interface Burg {
  id: string;
  world_id: string;
  burg_id: number;
  name: string;
  population: number;
  capital: boolean;
  xworld: number;
  yworld: number;
  geom: any;
}

interface CampaignLocation {
  id: string;
  campaign_id: string;
  name: string;
  description: string;
  type: 'city' | 'dungeon' | 'wilderness' | 'building' | 'room' | 'landmark';
  lng: number;
  lat: number;
  is_discovered: boolean;
}

interface MapPin {
  id: string;
  x: number;
  y: number;
  type: 'party' | 'enemy' | 'npc' | 'location' | 'treasure' | 'danger' | 'burg' | 'campaign_location';
  name: string;
  description?: string;
  visible: boolean;
  data?: any;
}

export function MapViewer({ campaignId }: { campaignId?: string }) {
  const { user } = useUser();
  const [zoom, setZoom] = useState(100);
  const [selectedTool, setSelectedTool] = useState<'move' | 'pin' | 'measure'>('move');
  const [worldMaps, setWorldMaps] = useState<WorldMap[]>([]);
  const [selectedWorldMap, setSelectedWorldMap] = useState<WorldMap | null>(null);
  const [burgs, setBurgs] = useState<Burg[]>([]);
  const [rivers, setRivers] = useState<any[]>([]);
  const [routes, setRoutes] = useState<any[]>([]);
  const [campaignLocations, setCampaignLocations] = useState<CampaignLocation[]>([]);
  const [loading, setLoading] = useState(true);
  const [mapBounds, setMapBounds] = useState<any>(null);
  const [pins, setPins] = useState<MapPin[]>([]);
  
  // New location form state
  const [newLocationName, setNewLocationName] = useState('');
  const [newLocationType, setNewLocationType] = useState<'city' | 'dungeon' | 'wilderness' | 'building' | 'room' | 'landmark'>('city');
  const [newLocationDescription, setNewLocationDescription] = useState('');

  const [layers, setLayers] = useState({
    political: true,
    terrain: true,
    rivers: true,
    routes: true,
    campaignLocations: true,
    grid: true,
    fog: false
  });

  // Data loading functions
  const loadWorldMaps = async () => {
    try {
      const response = await fetch('/api/maps/world');
      const data = await response.json();
      setWorldMaps(data);
      if (data.length > 0 && !selectedWorldMap) {
        setSelectedWorldMap(data[0]);
      }
    } catch (error) {
      console.error('Failed to load world maps:', error);
    }
  };

  const loadMapData = async (worldMapId: string, bounds?: any) => {
    try {
      setLoading(true);
      const boundsParam = bounds ? `?bounds=${JSON.stringify(bounds)}` : '';
      
      const [burgsRes, riversRes, routesRes] = await Promise.all([
        fetch(`/api/maps/${worldMapId}/burgs${boundsParam}`),
        fetch(`/api/maps/${worldMapId}/rivers${boundsParam}`),
        fetch(`/api/maps/${worldMapId}/routes${boundsParam}`)
      ]);

      const [burgsData, riversData, routesData] = await Promise.all([
        burgsRes.json(),
        riversRes.json(), 
        routesRes.json()
      ]);

      setBurgs(burgsData);
      setRivers(riversData);
      setRoutes(routesData);
      
      // Convert data to pins for display
      const newPins: MapPin[] = [];
      
      // Add burgs as pins
      burgsData.forEach((burg: Burg) => {
        newPins.push({
          id: `burg-${burg.id}`,
          x: burg.xworld * 2, // Scale coordinates for display
          y: burg.yworld * 2,
          type: 'burg',
          name: burg.name,
          description: `Population: ${burg.population}${burg.capital ? ' (Capital)' : ''}`,
          visible: layers.political,
          data: burg
        });
      });
      
      setPins(newPins);
    } catch (error) {
      console.error('Failed to load map data:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadCampaignLocations = async () => {
    if (!campaignId) return;
    
    try {
      const response = await fetch(`/api/campaigns/${campaignId}/locations`);
      const data = await response.json();
      setCampaignLocations(data);
      
      // Add campaign locations to pins
      const locationPins: MapPin[] = data.map((location: CampaignLocation) => ({
        id: `location-${location.id}`,
        x: (location.lng || 0) * 5, // Convert lat/lng to display coordinates
        y: (location.lat || 0) * 5,
        type: 'campaign_location',
        name: location.name,
        description: location.description,
        visible: layers.campaignLocations && location.is_discovered,
        data: location
      }));
      
      setPins(prev => [...prev.filter(p => !p.id.startsWith('location-')), ...locationPins]);
    } catch (error) {
      console.error('Failed to load campaign locations:', error);
    }
  };

  const addCampaignLocation = async (lat: number, lng: number, locationData: any) => {
    if (!campaignId || !selectedWorldMap) return;

    try {
      const response = await fetch(`/api/campaigns/${campaignId}/locations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...locationData,
          world_map_id: selectedWorldMap.id,
          world_position: { lat, lng }
        })
      });

      if (response.ok) {
        await loadCampaignLocations();
        // Reset form
        setNewLocationName('');
        setNewLocationDescription('');
        setNewLocationType('city');
      }
    } catch (error) {
      console.error('Failed to add campaign location:', error);
    }
  };

  const searchNearbyBurgs = async (lat: number, lng: number, radius: number = 50) => {
    if (!selectedWorldMap) return [];

    try {
      const response = await fetch('/api/database/spatial/get_burgs_near_point', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          world_map_id: selectedWorldMap.id,
          lat,
          lng,
          radius_km: radius
        })
      });

      const data = await response.json();
      return data.data || [];
    } catch (error) {
      console.error('Failed to search nearby burgs:', error);
      return [];
    }
  };

  const tools = [
    { id: 'move', name: 'Move', icon: <Move className="w-4 h-4" /> },
    { id: 'pin', name: 'Add Location', icon: <MapPin className="w-4 h-4" /> },
    { id: 'measure', name: 'Measure', icon: <Flag className="w-4 h-4" /> }
  ];

  const pinTypes = [
    { type: 'party', name: 'Party', icon: <Users className="w-4 h-4" />, color: 'bg-blue-500' },
    { type: 'enemy', name: 'Enemy', icon: <Skull className="w-4 h-4" />, color: 'bg-red-500' },
    { type: 'npc', name: 'NPC', icon: <Crown className="w-4 h-4" />, color: 'bg-purple-500' },
    { type: 'burg', name: 'Settlement', icon: <Castle className="w-4 h-4" />, color: 'bg-amber-500' },
    { type: 'campaign_location', name: 'Location', icon: <Castle className="w-4 h-4" />, color: 'bg-green-500' },
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

  // Load data on component mount
  useEffect(() => {
    loadWorldMaps();
  }, []);

  useEffect(() => {
    if (selectedWorldMap) {
      loadMapData(selectedWorldMap.id, mapBounds);
    }
  }, [selectedWorldMap, mapBounds]);

  useEffect(() => {
    loadCampaignLocations();
  }, [campaignId, layers.campaignLocations]);

  const handleMapClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (selectedTool === 'pin' && newLocationName && campaignId) {
      const rect = event.currentTarget.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      
      // Convert screen coordinates to lat/lng (simplified conversion)
      const lat = y / 5; // Convert back from display coordinates
      const lng = x / 5;
      
      addCampaignLocation(lat, lng, {
        name: newLocationName,
        description: newLocationDescription,
        type: newLocationType
      });
    }
  };

  const togglePinVisibility = (id: string) => {
    setPins(prev => prev.map(pin => 
      pin.id === id ? { ...pin, visible: !pin.visible } : pin
    ));
  };

  const deletePin = (id: string) => {
    setPins(prev => prev.filter(pin => pin.id !== id));
  };

  const toggleLayer = (layerName: string) => {
    setLayers(prev => ({
      ...prev,
      [layerName]: !prev[layerName]
    }));
  };

  if (loading && worldMaps.length === 0) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin" />
        <span className="ml-2">Loading world maps...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* World Map Selection */}
      {worldMaps.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">World Map</CardTitle>
          </CardHeader>
          <CardContent>
            <Select
              value={selectedWorldMap?.id || ''}
              onValueChange={(value) => {
                const map = worldMaps.find(m => m.id === value);
                setSelectedWorldMap(map || null);
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select a world map" />
              </SelectTrigger>
              <SelectContent>
                {worldMaps.map((map) => (
                  <SelectItem key={map.id} value={map.id}>
                    {map.name} {map.uploaded_by_username && `(by ${map.uploaded_by_username})`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {selectedWorldMap && (
              <p className="text-sm text-muted-foreground mt-2">
                {selectedWorldMap.description}
              </p>
            )}
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Map Display */}
        <div className="lg:col-span-3">
          <Card>
            <CardHeader>
              <div className="flex justify-between items-center">
                <CardTitle className="flex items-center gap-2">
                  <MapPin className="w-5 h-5" />
                  {selectedWorldMap ? selectedWorldMap.name : 'World Map'}
                  {loading && <Loader2 className="w-4 h-4 animate-spin ml-2" />}
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

              {selectedTool === 'pin' && campaignId && (
                <div className="mb-4 p-3 border rounded-lg bg-muted">
                  <div className="grid grid-cols-2 gap-2">
                    <Input 
                      placeholder="Location name" 
                      value={newLocationName}
                      onChange={(e) => setNewLocationName(e.target.value)}
                    />
                    <Select
                      value={newLocationType}
                      onValueChange={(value: any) => setNewLocationType(value)}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="city">City</SelectItem>
                        <SelectItem value="dungeon">Dungeon</SelectItem>
                        <SelectItem value="wilderness">Wilderness</SelectItem>
                        <SelectItem value="building">Building</SelectItem>
                        <SelectItem value="room">Room</SelectItem>
                        <SelectItem value="landmark">Landmark</SelectItem>
                      </SelectContent>
                    </Select>
                    <div className="col-span-2">
                      <Input 
                        placeholder="Description (optional)" 
                        value={newLocationDescription}
                        onChange={(e) => setNewLocationDescription(e.target.value)}
                      />
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground mt-2">
                    Fill in location details, then click on the map to place it.
                  </p>
                </div>
              )}

              {/* Map Canvas */}
              <div 
                className="relative border rounded-lg overflow-hidden bg-green-50"
                style={{ height: '500px' }}
                onClick={handleMapClick}
              >
                {selectedWorldMap ? (
                  <div 
                    className="absolute inset-0 bg-gradient-to-br from-green-100 to-brown-100"
                    style={{ transform: `scale(${zoom / 100})`, transformOrigin: 'top left' }}
                  >
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

                    {/* Rivers */}
                    {layers.rivers && rivers.map((river, index) => (
                      <div 
                        key={`river-${index}`}
                        className="absolute bg-blue-300 opacity-60"
                        style={{ 
                          // This would need proper PostGIS coordinate conversion
                          left: '10px', 
                          top: '20px', 
                          width: '200px', 
                          height: '3px',
                          borderRadius: '1px'
                        }}
                      />
                    ))}

                    {/* Routes */}
                    {layers.routes && routes.map((route, index) => (
                      <div 
                        key={`route-${index}`}
                        className="absolute bg-yellow-600 opacity-40"
                        style={{ 
                          // This would need proper PostGIS coordinate conversion
                          left: '50px', 
                          top: '100px', 
                          width: '150px', 
                          height: '2px'
                        }}
                      />
                    ))}

                    {/* Map pins */}
                    {pins.filter(pin => pin.visible).map((pin) => (
                      <div
                        key={pin.id}
                        className={`absolute w-8 h-8 rounded-full ${getPinColor(pin.type)} flex items-center justify-center text-white cursor-pointer shadow-lg transform -translate-x-1/2 -translate-y-1/2 hover:scale-110 transition-transform`}
                        style={{ left: pin.x, top: pin.y }}
                        title={`${pin.name}${pin.description ? `: ${pin.description}` : ''}`}
                      >
                        {getPinIcon(pin.type)}
                      </div>
                    ))}

                    {/* Fog of war overlay */}
                    {layers.fog && (
                      <div className="absolute inset-0 bg-black opacity-20 pointer-events-none" />
                    )}
                  </div>
                ) : (
                  <div className="flex items-center justify-center h-full text-muted-foreground">
                    {worldMaps.length > 0 ? 'Select a world map to view' : 'No world maps available'}
                  </div>
                )}
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
                  <span className="text-sm capitalize">{layer.replace(/([A-Z])/g, ' $1')}</span>
                  <Button
                    variant={enabled ? "default" : "outline"}
                    size="sm"
                    onClick={() => toggleLayer(layer)}
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
              <CardTitle className="text-base">Map Features</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="max-h-64 overflow-y-auto space-y-2">
                {pins.filter(pin => pin.visible).map((pin) => (
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
                      </div>
                    </div>
                    {pin.description && (
                      <p className="text-xs text-muted-foreground">{pin.description}</p>
                    )}
                    <Badge variant="outline" className="text-xs mt-1">
                      {pinTypes.find(t => t.type === pin.type)?.name || pin.type}
                    </Badge>
                  </div>
                ))}
                {pins.filter(pin => pin.visible).length === 0 && (
                  <p className="text-sm text-muted-foreground">No visible features</p>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Statistics */}
          {selectedWorldMap && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Map Statistics</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span>Settlements:</span>
                  <Badge variant="outline">{burgs.length}</Badge>
                </div>
                <div className="flex justify-between text-sm">
                  <span>Rivers:</span>
                  <Badge variant="outline">{rivers.length}</Badge>
                </div>
                <div className="flex justify-between text-sm">
                  <span>Routes:</span>
                  <Badge variant="outline">{routes.length}</Badge>
                </div>
                {campaignId && (
                  <div className="flex justify-between text-sm">
                    <span>Campaign Locations:</span>
                    <Badge variant="outline">{campaignLocations.length}</Badge>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

export default MapViewer;
