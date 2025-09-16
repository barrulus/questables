import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { Progress } from "./ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";
import { 
  MapPin, 
  Clock, 
  Eye, 
  Search, 
  Compass, 
  Tent, 
  Sun, 
  Moon, 
  Cloud, 
  Droplets,
  Trees,
  Mountain,
  Castle
} from "lucide-react";

export function ExplorationTools() {
  const [travelLog, setTravelLog] = useState([
    { location: "Rivendell", date: "Day 1", description: "Started journey from the Last Homely House" },
    { location: "Misty Mountains", date: "Day 3", description: "Encountered goblin scouts near the pass" },
    { location: "Moria Entrance", date: "Day 5", description: "Found the ancient doors sealed" }
  ]);

  const [restOptions, setRestOptions] = useState({
    shortRest: { available: true, duration: "1 hour" },
    longRest: { available: true, duration: "8 hours" }
  });

  const [weather, setWeather] = useState({
    condition: "Clear",
    temperature: "Mild",
    visibility: "Good",
    wind: "Light"
  });

  const [survivalChecks, setSurvivalChecks] = useState([
    { type: "Navigation", dc: 15, result: null, description: "Find the correct path through the forest" },
    { type: "Foraging", dc: 12, result: 18, description: "Search for food and water" },
    { type: "Tracking", dc: 14, result: null, description: "Follow goblin tracks" }
  ]);

  const terrainTypes = [
    { name: "Forest", icon: <Trees className="w-4 h-4" />, color: "text-green-600" },
    { name: "Mountains", icon: <Mountain className="w-4 h-4" />, color: "text-gray-600" },
    { name: "Plains", icon: <Sun className="w-4 h-4" />, color: "text-yellow-600" },
    { name: "City", icon: <Castle className="w-4 h-4" />, color: "text-blue-600" }
  ];

  const timeOfDay = [
    { name: "Dawn", icon: <Sun className="w-4 h-4" />, time: "6:00 AM" },
    { name: "Morning", icon: <Sun className="w-4 h-4" />, time: "9:00 AM" },
    { name: "Noon", icon: <Sun className="w-4 h-4" />, time: "12:00 PM" },
    { name: "Afternoon", icon: <Sun className="w-4 h-4" />, time: "3:00 PM" },
    { name: "Evening", icon: <Moon className="w-4 h-4" />, time: "6:00 PM" },
    { name: "Night", icon: <Moon className="w-4 h-4" />, time: "9:00 PM" }
  ];

  const explorationActions = [
    { name: "Search", icon: <Search className="w-4 h-4" />, skill: "Investigation", dc: 15 },
    { name: "Listen", icon: <Eye className="w-4 h-4" />, skill: "Perception", dc: 12 },
    { name: "Navigate", icon: <Compass className="w-4 h-4" />, skill: "Survival", dc: 15 },
    { name: "Track", icon: <MapPin className="w-4 h-4" />, skill: "Survival", dc: 14 },
    { name: "Forage", icon: <Trees className="w-4 h-4" />, skill: "Survival", dc: 12 },
    { name: "Hide", icon: <Cloud className="w-4 h-4" />, skill: "Stealth", dc: 13 }
  ];

  const performCheck = (checkIndex: number) => {
    const roll = Math.floor(Math.random() * 20) + 1;
    const modifier = 5; // Character's skill modifier
    const total = roll + modifier;

    setSurvivalChecks(prev => prev.map((check, index) => 
      index === checkIndex ? { ...check, result: total } : check
    ));
  };

  const takeRest = (type: 'short' | 'long') => {
    // In a real app, this would recover hit points, spell slots, etc.
    console.log(`Taking ${type} rest`);
  };

  return (
    <div className="space-y-6">
      <Tabs defaultValue="exploration" className="space-y-4">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="exploration">Exploration</TabsTrigger>
          <TabsTrigger value="travel">Travel</TabsTrigger>
          <TabsTrigger value="environment">Environment</TabsTrigger>
          <TabsTrigger value="rest">Rest</TabsTrigger>
        </TabsList>

        <TabsContent value="exploration" className="space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Exploration Actions */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Search className="w-5 h-5" />
                  Exploration Actions
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-3">
                  {explorationActions.map((action, index) => (
                    <Button
                      key={index}
                      variant="outline"
                      className="h-16 flex flex-col gap-1"
                      onClick={() => {/* Perform action */}}
                    >
                      {action.icon}
                      <span className="text-sm">{action.name}</span>
                      <span className="text-xs text-muted-foreground">
                        {action.skill} DC {action.dc}
                      </span>
                    </Button>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* Active Checks */}
            <Card>
              <CardHeader>
                <CardTitle>Active Checks</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {survivalChecks.map((check, index) => (
                  <div key={index} className="p-3 border rounded">
                    <div className="flex justify-between items-start mb-2">
                      <div>
                        <span className="font-medium">{check.type}</span>
                        <p className="text-sm text-muted-foreground">{check.description}</p>
                      </div>
                      <Badge variant="outline">DC {check.dc}</Badge>
                    </div>
                    
                    <div className="flex items-center gap-2">
                      {check.result !== null ? (
                        <Badge 
                          variant={check.result >= check.dc ? "default" : "destructive"}
                          className="px-3"
                        >
                          {check.result} {check.result >= check.dc ? "Success" : "Failure"}
                        </Badge>
                      ) : (
                        <Button
                          size="sm"
                          onClick={() => performCheck(index)}
                        >
                          Roll Check
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>

          {/* Discovery Log */}
          <Card>
            <CardHeader>
              <CardTitle>Discovery Log</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                <Textarea placeholder="Record discoveries, clues, or observations..." className="min-h-20" />
                <Button size="sm">Add Entry</Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="travel" className="space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Travel Planning */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <MapPin className="w-5 h-5" />
                  Travel Planning
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-sm font-medium">From</label>
                    <Input placeholder="Current location" />
                  </div>
                  <div>
                    <label className="text-sm font-medium">To</label>
                    <Input placeholder="Destination" />
                  </div>
                </div>
                
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-sm font-medium">Distance</label>
                    <Input placeholder="Miles" type="number" />
                  </div>
                  <div>
                    <label className="text-sm font-medium">Travel Pace</label>
                    <select className="w-full p-2 border rounded">
                      <option>Normal (24 miles/day)</option>
                      <option>Fast (30 miles/day)</option>
                      <option>Slow (18 miles/day)</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="text-sm font-medium">Terrain</label>
                  <div className="grid grid-cols-2 gap-2 mt-1">
                    {terrainTypes.map((terrain, index) => (
                      <Button key={index} variant="outline" size="sm" className="justify-start">
                        <span className={terrain.color}>{terrain.icon}</span>
                        <span className="ml-2">{terrain.name}</span>
                      </Button>
                    ))}
                  </div>
                </div>

                <Button className="w-full">Calculate Journey</Button>
              </CardContent>
            </Card>

            {/* Travel Log */}
            <Card>
              <CardHeader>
                <CardTitle>Travel Log</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {travelLog.map((entry, index) => (
                    <div key={index} className="p-3 border rounded">
                      <div className="flex justify-between items-start mb-1">
                        <h4 className="font-medium">{entry.location}</h4>
                        <Badge variant="outline">{entry.date}</Badge>
                      </div>
                      <p className="text-sm text-muted-foreground">{entry.description}</p>
                    </div>
                  ))}
                </div>
                
                <div className="mt-4 space-y-2">
                  <Input placeholder="Location" />
                  <Textarea placeholder="Description" className="min-h-16" />
                  <Button size="sm">Add Entry</Button>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="environment" className="space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Weather & Time */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Sun className="w-5 h-5" />
                  Environment
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-sm font-medium">Weather</label>
                    <select 
                      className="w-full p-2 border rounded mt-1"
                      value={weather.condition}
                      onChange={(e) => setWeather(prev => ({...prev, condition: e.target.value}))}
                    >
                      <option>Clear</option>
                      <option>Cloudy</option>
                      <option>Rainy</option>
                      <option>Stormy</option>
                      <option>Foggy</option>
                      <option>Snowy</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-sm font-medium">Temperature</label>
                    <select 
                      className="w-full p-2 border rounded mt-1"
                      value={weather.temperature}
                      onChange={(e) => setWeather(prev => ({...prev, temperature: e.target.value}))}
                    >
                      <option>Very Cold</option>
                      <option>Cold</option>
                      <option>Cool</option>
                      <option>Mild</option>
                      <option>Warm</option>
                      <option>Hot</option>
                      <option>Very Hot</option>
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-sm font-medium">Visibility</label>
                    <select 
                      className="w-full p-2 border rounded mt-1"
                      value={weather.visibility}
                      onChange={(e) => setWeather(prev => ({...prev, visibility: e.target.value}))}
                    >
                      <option>Excellent</option>
                      <option>Good</option>
                      <option>Fair</option>
                      <option>Poor</option>
                      <option>Very Poor</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-sm font-medium">Wind</label>
                    <select 
                      className="w-full p-2 border rounded mt-1"
                      value={weather.wind}
                      onChange={(e) => setWeather(prev => ({...prev, wind: e.target.value}))}
                    >
                      <option>Calm</option>
                      <option>Light</option>
                      <option>Moderate</option>
                      <option>Strong</option>
                      <option>Severe</option>
                    </select>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Time of Day */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Clock className="w-5 h-5" />
                  Time Management
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-3 gap-2">
                  {timeOfDay.map((time, index) => (
                    <Button key={index} variant="outline" size="sm" className="flex flex-col h-16">
                      {time.icon}
                      <span className="text-xs">{time.name}</span>
                      <span className="text-xs text-muted-foreground">{time.time}</span>
                    </Button>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="rest" className="space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Rest Options */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Tent className="w-5 h-5" />
                  Rest Options
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="p-4 border rounded">
                  <div className="flex justify-between items-center mb-2">
                    <h4 className="font-medium">Short Rest</h4>
                    <Badge variant="outline">{restOptions.shortRest.duration}</Badge>
                  </div>
                  <p className="text-sm text-muted-foreground mb-3">
                    Regain hit points by spending Hit Dice, recover some class features
                  </p>
                  <Button 
                    onClick={() => takeRest('short')}
                    disabled={!restOptions.shortRest.available}
                    className="w-full"
                  >
                    Take Short Rest
                  </Button>
                </div>

                <div className="p-4 border rounded">
                  <div className="flex justify-between items-center mb-2">
                    <h4 className="font-medium">Long Rest</h4>
                    <Badge variant="outline">{restOptions.longRest.duration}</Badge>
                  </div>
                  <p className="text-sm text-muted-foreground mb-3">
                    Regain all hit points, spell slots, and class features
                  </p>
                  <Button 
                    onClick={() => takeRest('long')}
                    disabled={!restOptions.longRest.available}
                    className="w-full"
                  >
                    Take Long Rest
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* Rest Activities */}
            <Card>
              <CardHeader>
                <CardTitle>Rest Activities</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <Button variant="outline" className="w-full justify-start">
                  <Search className="w-4 h-4 mr-2" />
                  Keep Watch
                </Button>
                <Button variant="outline" className="w-full justify-start">
                  <Trees className="w-4 h-4 mr-2" />
                  Forage for Food
                </Button>
                <Button variant="outline" className="w-full justify-start">
                  <Eye className="w-4 h-4 mr-2" />
                  Scout the Area
                </Button>
                <Button variant="outline" className="w-full justify-start">
                  <Compass className="w-4 h-4 mr-2" />
                  Plan Route
                </Button>
                <Button variant="outline" className="w-full justify-start">
                  <Droplets className="w-4 h-4 mr-2" />
                  Find Water
                </Button>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}