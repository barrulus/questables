import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Textarea } from "./ui/textarea";
import { ScrollArea } from "./ui/scroll-area";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "./ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";
import { Checkbox } from "./ui/checkbox";
import { Progress } from "./ui/progress";
import { toast } from "sonner@2.0.3";
import {
  MapIcon,
  Upload,
  Search,
  Edit,
  Trash2,
  Eye,
  Download,
  Globe,
  Layers,
  FileText,
  Image,
  Plus,
  Calendar,
  User,
  MoreHorizontal,
  X,
  Check,
  Info
} from "lucide-react";

interface WorldMap {
  id: string;
  name: string;
  description: string;
  geoJsonFile: string;
  thumbnailUrl?: string;
  uploadDate: Date;
  lastModified: Date;
  createdBy: string;
  fileSize: number;
  bounds: {
    north: number;
    south: number;
    east: number;
    west: number;
  };
  layers: {
    political: boolean;
    terrain: boolean;
    climate: boolean;
    cultures: boolean;
    religions: boolean;
    provinces: boolean;
  };
}

interface TileSet {
  id: string;
  name: string;
  description: string;
  baseUrl: string;
  format: "png" | "jpg" | "webp";
  minZoom: number;
  maxZoom: number;
  tileSize: number;
  uploadDate: Date;
  createdBy: string;
  isActive: boolean;
  attribution?: string;
}

export function MapManager() {
  const [activeTab, setActiveTab] = useState("world-maps");
  const [searchQuery, setSearchQuery] = useState("");
  const [isUploadOpen, setIsUploadOpen] = useState(false);
  const [uploadType, setUploadType] = useState<"world" | "tiles">("world");
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [selectedMap, setSelectedMap] = useState<WorldMap | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [isUploading, setIsUploading] = useState(false);

  const [worldMaps, setWorldMaps] = useState<WorldMap[]>([
    {
      id: "world1",
      name: "Middle Earth",
      description: "Complete world map of Middle Earth with all regions, kingdoms, and geographical features.",
      geoJsonFile: "/maps/middle-earth.geojson",
      thumbnailUrl: "https://images.unsplash.com/photo-1578662996442-48f60103fc96?w=400&h=300&fit=crop",
      uploadDate: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000),
      lastModified: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
      createdBy: "TolkienDM",
      fileSize: 2.4,
      bounds: { north: 65.2, south: 32.1, east: 42.8, west: -15.6 },
      layers: {
        political: true,
        terrain: true,
        climate: true,
        cultures: true,
        religions: true,
        provinces: true
      }
    },
    {
      id: "world2", 
      name: "Forgotten Realms - Sword Coast",
      description: "Detailed map of the Sword Coast region including Waterdeep, Neverwinter, and Baldur's Gate.",
      geoJsonFile: "/maps/sword-coast.geojson",
      thumbnailUrl: "https://images.unsplash.com/photo-1518709268805-4e9042af2176?w=400&h=300&fit=crop",
      uploadDate: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
      lastModified: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000),
      createdBy: "ForgottenDM",
      fileSize: 3.8,
      bounds: { north: 52.4, south: 38.9, east: -1.2, west: -8.7 },
      layers: {
        political: true,
        terrain: true,
        climate: false,
        cultures: true,
        religions: false,
        provinces: true
      }
    }
  ]);

  const [tileSets, setTileSets] = useState<TileSet[]>([
    {
      id: "tiles1",
      name: "Antique Parchment",
      description: "Aged parchment style tiles for a classic fantasy feel",
      baseUrl: "https://tiles.example.com/antique/{z}/{x}/{y}",
      format: "png",
      minZoom: 0,
      maxZoom: 18,
      tileSize: 256,
      uploadDate: new Date(Date.now() - 21 * 24 * 60 * 60 * 1000),
      createdBy: "MapArtist",
      isActive: true,
      attribution: "Custom fantasy tiles by MapArtist"
    },
    {
      id: "tiles2",
      name: "Hand-drawn Fantasy",
      description: "Hand-drawn style map tiles with illustrated terrain features",
      baseUrl: "https://tiles.example.com/fantasy/{z}/{x}/{y}",
      format: "jpg",
      minZoom: 0,
      maxZoom: 16,
      tileSize: 256,
      uploadDate: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
      createdBy: "FantasyCartographer",
      isActive: false,
      attribution: "Hand-drawn tiles © FantasyCartographer"
    }
  ]);

  const [newUpload, setNewUpload] = useState({
    name: "",
    description: "",
    file: null as File | null
  });

  const filteredWorldMaps = worldMaps.filter(map =>
    map.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    map.description.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const filteredTileSets = tileSets.filter(tileSet =>
    tileSet.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    tileSet.description.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleUpload = async () => {
    if (!newUpload.name || !newUpload.file) {
      toast.error("Please provide a name and select a file");
      return;
    }

    setIsUploading(true);
    setUploadProgress(0);

    // Simulate upload progress
    const interval = setInterval(() => {
      setUploadProgress(prev => {
        if (prev >= 100) {
          clearInterval(interval);
          setIsUploading(false);
          setIsUploadOpen(false);
          
          if (uploadType === "world") {
            toast.success("World map uploaded successfully!");
          } else {
            toast.success("Tile set uploaded successfully!");
          }
          
          // Reset form
          setNewUpload({ name: "", description: "", file: null });
          return 100;
        }
        return prev + 10;
      });
    }, 200);
  };

  const handleDeleteWorldMap = (mapId: string) => {
    setWorldMaps(worldMaps.filter(map => map.id !== mapId));
    toast.success("World map deleted successfully!");
  };

  const handleDeleteTileSet = (tileSetId: string) => {
    setTileSets(tileSets.filter(tileSet => tileSet.id !== tileSetId));
    toast.success("Tile set deleted successfully!");
  };

  const toggleTileSetActive = (tileSetId: string) => {
    setTileSets(tileSets.map(tileSet => 
      tileSet.id === tileSetId 
        ? { ...tileSet, isActive: !tileSet.isActive }
        : tileSet
    ));
    toast.success("Tile set status updated!");
  };

  const handleEdit = (map: WorldMap) => {
    setSelectedMap(map);
    setIsEditOpen(true);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold">Map Manager</h2>
          <p className="text-sm text-muted-foreground">
            Manage world maps from Azgaar's FMG and tile sets for OpenLayers/Leaflet rendering
          </p>
        </div>
        <Dialog open={isUploadOpen} onOpenChange={setIsUploadOpen}>
          <DialogTrigger asChild>
            <Button>
              <Upload className="w-4 h-4 mr-2" />
              Upload
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>Upload Map Content</DialogTitle>
              <DialogDescription>
                Upload world maps (geoJSON) or tile sets for map rendering
              </DialogDescription>
            </DialogHeader>
            
            <Tabs value={uploadType} onValueChange={(value: "world" | "tiles") => setUploadType(value)}>
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="world">World Map</TabsTrigger>
                <TabsTrigger value="tiles">Tile Set</TabsTrigger>
              </TabsList>
              
              <TabsContent value="world" className="space-y-4">
                <div className="space-y-4">
                  <div className="border-2 border-dashed border-muted-foreground/25 rounded-lg p-6 text-center">
                    <Globe className="w-8 h-8 mx-auto text-muted-foreground mb-2" />
                    <p className="text-sm mb-1">Drop Azgaar's FMG geoJSON file here</p>
                    <p className="text-xs text-muted-foreground mb-3">Supports .geojson files exported from Fantasy Map Generator</p>
                    <Button variant="outline" size="sm" onClick={() => document.getElementById('world-file')?.click()}>
                      <FileText className="w-4 h-4 mr-2" />
                      Choose geoJSON File
                    </Button>
                    <input
                      id="world-file"
                      type="file"
                      accept=".geojson,.json"
                      className="hidden"
                      onChange={(e) => setNewUpload({ ...newUpload, file: e.target.files?.[0] || null })}
                    />
                  </div>
                  {newUpload.file && (
                    <div className="text-sm text-muted-foreground">
                      Selected: {newUpload.file.name} ({(newUpload.file.size / 1024 / 1024).toFixed(2)} MB)
                    </div>
                  )}
                </div>
              </TabsContent>
              
              <TabsContent value="tiles" className="space-y-4">
                <div className="space-y-4">
                  <div className="border-2 border-dashed border-muted-foreground/25 rounded-lg p-6 text-center">
                    <Layers className="w-8 h-8 mx-auto text-muted-foreground mb-2" />
                    <p className="text-sm mb-1">Upload tile set archive</p>
                    <p className="text-xs text-muted-foreground mb-3">Supports .zip archives with tile folder structure</p>
                    <Button variant="outline" size="sm" onClick={() => document.getElementById('tiles-file')?.click()}>
                      <Image className="w-4 h-4 mr-2" />
                      Choose Tile Archive
                    </Button>
                    <input
                      id="tiles-file"
                      type="file"
                      accept=".zip"
                      className="hidden"
                      onChange={(e) => setNewUpload({ ...newUpload, file: e.target.files?.[0] || null })}
                    />
                  </div>
                  {newUpload.file && (
                    <div className="text-sm text-muted-foreground">
                      Selected: {newUpload.file.name} ({(newUpload.file.size / 1024 / 1024).toFixed(2)} MB)
                    </div>
                  )}
                </div>
              </TabsContent>
            </Tabs>

            {isUploading && (
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span>Uploading...</span>
                  <span>{uploadProgress}%</span>
                </div>
                <Progress value={uploadProgress} />
              </div>
            )}

            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="upload-name">Name</Label>
                <Input
                  id="upload-name"
                  value={newUpload.name}
                  onChange={(e) => setNewUpload({ ...newUpload, name: e.target.value })}
                  placeholder={uploadType === "world" ? "Enter world map name" : "Enter tile set name"}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="upload-description">Description</Label>
                <Textarea
                  id="upload-description"
                  value={newUpload.description}
                  onChange={(e) => setNewUpload({ ...newUpload, description: e.target.value })}
                  placeholder={uploadType === "world" ? "Describe the world and its features" : "Describe the tile style and usage"}
                  rows={3}
                />
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setIsUploadOpen(false)}>Cancel</Button>
              <Button onClick={handleUpload} disabled={isUploading || !newUpload.name || !newUpload.file}>
                {isUploading ? "Uploading..." : "Upload"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {/* Search */}
      <div className="flex items-center gap-4">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground w-4 h-4" />
          <Input
            placeholder="Search maps and tile sets..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10"
          />
        </div>
      </div>

      {/* Content Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="world-maps">World Maps ({worldMaps.length})</TabsTrigger>
          <TabsTrigger value="tile-sets">Tile Sets ({tileSets.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="world-maps" className="space-y-4">
          {filteredWorldMaps.length > 0 ? (
            <div className="space-y-4">
              {filteredWorldMaps.map((map) => (
                <Card key={map.id}>
                  <CardContent className="p-6">
                    <div className="flex items-start gap-4">
                      <div className="w-20 h-16 rounded border overflow-hidden flex-shrink-0 bg-muted">
                        {map.thumbnailUrl ? (
                          <img
                            src={map.thumbnailUrl}
                            alt={map.name}
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center">
                            <Globe className="w-6 h-6 text-muted-foreground" />
                          </div>
                        )}
                      </div>
                      <div className="flex-1 space-y-2">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <h3 className="font-semibold">{map.name}</h3>
                            <Badge variant="outline" className="text-xs">
                              <FileText className="w-3 h-3 mr-1" />
                              geoJSON
                            </Badge>
                          </div>
                          <div className="text-sm text-muted-foreground">
                            {map.fileSize} MB
                          </div>
                        </div>
                        <p className="text-sm text-muted-foreground">{map.description}</p>
                        <div className="flex items-center gap-6 text-xs text-muted-foreground">
                          <span>Uploaded: {map.uploadDate.toLocaleDateString()}</span>
                          <span>By: {map.createdBy}</span>
                          <span>Modified: {map.lastModified.toLocaleDateString()}</span>
                        </div>
                        <div className="flex flex-wrap gap-1">
                          {map.layers.political && <Badge variant="outline" className="text-xs">Political</Badge>}
                          {map.layers.terrain && <Badge variant="outline" className="text-xs">Terrain</Badge>}
                          {map.layers.climate && <Badge variant="outline" className="text-xs">Climate</Badge>}
                          {map.layers.cultures && <Badge variant="outline" className="text-xs">Cultures</Badge>}
                          {map.layers.religions && <Badge variant="outline" className="text-xs">Religions</Badge>}
                          {map.layers.provinces && <Badge variant="outline" className="text-xs">Provinces</Badge>}
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <Button variant="outline" size="sm">
                          <Eye className="w-4 h-4 mr-1" />
                          Preview
                        </Button>
                        <Button variant="outline" size="sm">
                          <Download className="w-4 h-4 mr-1" />
                          Download
                        </Button>
                        <Button variant="outline" size="sm" onClick={() => handleEdit(map)}>
                          <Edit className="w-4 h-4 mr-1" />
                          Edit
                        </Button>
                        <Button variant="outline" size="sm" onClick={() => handleDeleteWorldMap(map.id)}>
                          <Trash2 className="w-4 h-4 mr-1" />
                          Delete
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : (
            <Card>
              <CardContent className="p-12 text-center">
                <Globe className="w-16 h-16 mx-auto text-muted-foreground mb-4" />
                <h3 className="font-semibold mb-2">No world maps found</h3>
                <p className="text-muted-foreground mb-4">
                  Upload geoJSON exports from Azgaar's Fantasy Map Generator to get started
                </p>
                <Button onClick={() => setIsUploadOpen(true)}>
                  <Upload className="w-4 h-4 mr-2" />
                  Upload World Map
                </Button>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="tile-sets" className="space-y-4">
          {filteredTileSets.length > 0 ? (
            <div className="space-y-4">
              {filteredTileSets.map((tileSet) => (
                <Card key={tileSet.id}>
                  <CardContent className="p-6">
                    <div className="flex items-start gap-4">
                      <div className="w-20 h-16 rounded border overflow-hidden flex-shrink-0 bg-muted flex items-center justify-center">
                        <Layers className="w-6 h-6 text-muted-foreground" />
                      </div>
                      <div className="flex-1 space-y-2">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <h3 className="font-semibold">{tileSet.name}</h3>
                            <Badge variant="outline" className="text-xs">
                              <Image className="w-3 h-3 mr-1" />
                              {tileSet.format.toUpperCase()}
                            </Badge>
                            <Badge 
                              variant={tileSet.isActive ? "default" : "secondary"} 
                              className="text-xs"
                            >
                              {tileSet.isActive ? "Active" : "Inactive"}
                            </Badge>
                          </div>
                        </div>
                        <p className="text-sm text-muted-foreground">{tileSet.description}</p>
                        <div className="flex items-center gap-6 text-xs text-muted-foreground">
                          <span>Zoom: {tileSet.minZoom}-{tileSet.maxZoom}</span>
                          <span>Tile Size: {tileSet.tileSize}px</span>
                          <span>Uploaded: {tileSet.uploadDate.toLocaleDateString()}</span>
                          <span>By: {tileSet.createdBy}</span>
                        </div>
                        {tileSet.attribution && (
                          <div className="text-xs text-muted-foreground">
                            Attribution: {tileSet.attribution}
                          </div>
                        )}
                      </div>
                      <div className="flex gap-2">
                        <Button 
                          variant={tileSet.isActive ? "secondary" : "default"} 
                          size="sm"
                          onClick={() => toggleTileSetActive(tileSet.id)}
                        >
                          {tileSet.isActive ? "Deactivate" : "Activate"}
                        </Button>
                        <Button variant="outline" size="sm">
                          <Edit className="w-4 h-4 mr-1" />
                          Edit
                        </Button>
                        <Button variant="outline" size="sm" onClick={() => handleDeleteTileSet(tileSet.id)}>
                          <Trash2 className="w-4 h-4 mr-1" />
                          Delete
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : (
            <Card>
              <CardContent className="p-12 text-center">
                <Layers className="w-16 h-16 mx-auto text-muted-foreground mb-4" />
                <h3 className="font-semibold mb-2">No tile sets found</h3>
                <p className="text-muted-foreground mb-4">
                  Upload tile archives for custom map rendering styles
                </p>
                <Button onClick={() => setIsUploadOpen(true)}>
                  <Upload className="w-4 h-4 mr-2" />
                  Upload Tile Set
                </Button>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>

      {/* Edit World Map Dialog */}
      <Dialog open={isEditOpen} onOpenChange={setIsEditOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit World Map</DialogTitle>
            <DialogDescription>
              Modify world map details and settings
            </DialogDescription>
          </DialogHeader>
          
          {selectedMap && (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Map Name</Label>
                <Input defaultValue={selectedMap.name} />
              </div>
              <div className="space-y-2">
                <Label>Description</Label>
                <Textarea defaultValue={selectedMap.description} rows={3} />
              </div>
              <div className="space-y-3">
                <Label>Available Layers</Label>
                <div className="grid grid-cols-2 gap-2">
                  <div className="flex items-center space-x-2">
                    <Checkbox id="political" defaultChecked={selectedMap.layers.political} />
                    <Label htmlFor="political">Political</Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <Checkbox id="terrain" defaultChecked={selectedMap.layers.terrain} />
                    <Label htmlFor="terrain">Terrain</Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <Checkbox id="climate" defaultChecked={selectedMap.layers.climate} />
                    <Label htmlFor="climate">Climate</Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <Checkbox id="cultures" defaultChecked={selectedMap.layers.cultures} />
                    <Label htmlFor="cultures">Cultures</Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <Checkbox id="religions" defaultChecked={selectedMap.layers.religions} />
                    <Label htmlFor="religions">Religions</Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <Checkbox id="provinces" defaultChecked={selectedMap.layers.provinces} />
                    <Label htmlFor="provinces">Provinces</Label>
                  </div>
                </div>
              </div>
            </div>
          )}
          
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsEditOpen(false)}>Cancel</Button>
            <Button onClick={() => {
              setIsEditOpen(false);
              toast.success("World map updated successfully!");
            }}>
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}