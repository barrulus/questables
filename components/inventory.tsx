import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Textarea } from "./ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "./ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { toast } from "sonner";
import { Package, Sword, Shield, Shirt, Plus, Minus, Trash2, Loader2, Star as StarIcon } from "lucide-react";
import type { InventoryItem, Equipment } from '../utils/database/data-structures';
import { getCharacter, updateCharacter, type CharacterUpdateRequest } from '../utils/api/characters';

interface InventoryProps {
  characterId: string;
  onInventoryChange?: () => void;
}

const INITIAL_NEW_ITEM: Partial<InventoryItem> & { value?: InventoryItem['value'] } = {
  name: "",
  description: "",
  quantity: 1,
  type: "other",
  weight: 0,
  value: { amount: 0, currency: "gp" },
};

export function Inventory({ characterId, onInventoryChange }: InventoryProps) {
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [equipment, setEquipment] = useState<Equipment | null>(null);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);
  
  // Add item dialog state
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [newItem, setNewItem] = useState<typeof INITIAL_NEW_ITEM>(INITIAL_NEW_ITEM);

  // Load character inventory data
  const loadCharacterInventory = async () => {
    try {
      setLoading(true);
      const char = await getCharacter(characterId);
      if (char) {
        setInventory(char.inventory ?? []);
        const equipmentData: Equipment = char.equipment ?? { weapons: {}, accessories: {} };
        setEquipment(equipmentData);
      }
    } catch (error) {
      console.error('Failed to load character inventory:', error);
      toast.error('Failed to load inventory');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (characterId) {
      loadCharacterInventory();
    }
  }, [characterId]);

  // Update character in database
  const updateCharacterData = async (updates: CharacterUpdateRequest) => {
    try {
      setUpdating(true);
      await updateCharacter(characterId, updates);
      onInventoryChange?.();
    } catch (error) {
      console.error('Failed to update character:', error);
      toast.error('Failed to save changes');
    } finally {
      setUpdating(false);
    }
  };

  // Add new item to inventory
  const addItem = async () => {
    if (!newItem.name?.trim()) {
      toast.error('Item name is required');
      return;
    }

    try {
      const valuePayload = newItem.value && typeof newItem.value.amount === "number"
        ? {
            amount: Math.max(0, newItem.value.amount),
            currency: newItem.value.currency?.trim() || "gp",
          }
        : undefined;

      const item: InventoryItem = {
        id: `item_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`,
        name: newItem.name.trim(),
        description: newItem.description ?? '',
        quantity: newItem.quantity ?? 1,
        type: newItem.type ?? 'other',
        weight: newItem.weight ?? 0,
        ...(valuePayload ? { value: valuePayload } : {}),
      };
      
      const updatedInventory = [...inventory, item];
      setInventory(updatedInventory);
      
      await updateCharacterData({ inventory: updatedInventory });
      
      // Reset form and close dialog
      setNewItem(INITIAL_NEW_ITEM);
      setShowAddDialog(false);
      toast.success('Item added successfully');
    } catch (error) {
      console.error('Failed to add item:', error);
      toast.error('Failed to add item');
    }
  };

  // Remove item from inventory
  const removeItem = async (itemId: string) => {
    try {
      const updatedInventory = inventory.filter(item => item.id !== itemId);
      setInventory(updatedInventory);
      await updateCharacterData({ inventory: updatedInventory });
      toast.success('Item removed');
    } catch (error) {
      console.error('Failed to remove item:', error);
      toast.error('Failed to remove item');
    }
  };

  // Update item quantity
  const updateItemQuantity = async (itemId: string, change: number) => {
    try {
      const updatedInventory = inventory.map(item => {
        if (item.id === itemId) {
          const newQuantity = Math.max(0, item.quantity + change);
          if (newQuantity === 0) {
            // Remove item if quantity becomes 0
            return null;
          }
          return { ...item, quantity: newQuantity };
        }
        return item;
      }).filter(Boolean) as InventoryItem[];
      
      setInventory(updatedInventory);
      await updateCharacterData({ inventory: updatedInventory });
    } catch (error) {
      console.error('Failed to update item quantity:', error);
      toast.error('Failed to update quantity');
    }
  };

  const formatItemValue = (value?: InventoryItem['value']): string => {
    if (!value) {
      return '—';
    }
    const amount = Number.isFinite(value.amount) ? value.amount : 0;
    const currency = value.currency?.toUpperCase() ?? 'GP';
    return `${amount} ${currency}`;
  };

  const isShieldItem = (item: InventoryItem): boolean => {
    const name = item.name.toLowerCase();
    const props = item.properties?.map((prop) => prop.toLowerCase()) ?? [];
    return props.includes('shield') || name.includes('shield');
  };

  // Equip/unequip item
  const toggleEquipItem = async (item: InventoryItem) => {
    if (!equipment) return;

    try {
      const updatedEquipment = { ...equipment };
      
      // Handle different equipment types
      if (item.type === 'weapon') {
        if (!updatedEquipment.weapons) updatedEquipment.weapons = {};
        
        // Check if item is already equipped
        const isEquipped = updatedEquipment.weapons.mainHand?.id === item.id || 
                          updatedEquipment.weapons.offHand?.id === item.id;
        
        if (isEquipped) {
          // Unequip
          if (updatedEquipment.weapons.mainHand?.id === item.id) {
            delete updatedEquipment.weapons.mainHand;
          }
          if (updatedEquipment.weapons.offHand?.id === item.id) {
            delete updatedEquipment.weapons.offHand;
          }
        } else {
          // Equip to main hand (or off hand if main hand is occupied)
          if (!updatedEquipment.weapons.mainHand) {
            updatedEquipment.weapons.mainHand = item;
          } else if (!updatedEquipment.weapons.offHand) {
            updatedEquipment.weapons.offHand = item;
          } else {
            // Replace main hand
            updatedEquipment.weapons.mainHand = item;
          }
        }
      } else if (item.type === 'armor') {
        if (isShieldItem(item)) {
          if (updatedEquipment.shield?.id === item.id) {
            delete updatedEquipment.shield;
          } else {
            updatedEquipment.shield = item;
          }
        } else if (updatedEquipment.armor?.id === item.id) {
          delete updatedEquipment.armor;
        } else {
          updatedEquipment.armor = item;
        }
      }
      
      setEquipment(updatedEquipment);
      await updateCharacterData({ equipment: updatedEquipment });
      toast.success(isItemEquipped(item) ? 'Item unequipped' : 'Item equipped');
    } catch (error) {
      console.error('Failed to toggle equip item:', error);
      toast.error('Failed to update equipment');
    }
  };

  // Check if item is equipped
  const isItemEquipped = (item: InventoryItem): boolean => {
    if (!equipment) return false;
    
    return (equipment.weapons?.mainHand?.id === item.id ||
            equipment.weapons?.offHand?.id === item.id ||
            equipment.armor?.id === item.id ||
            equipment.shield?.id === item.id);
  };

  // Get equipment icon
  const getEquipmentIcon = (item: InventoryItem) => {
    if (item.type === "weapon") {
      return <Sword className="w-4 h-4" />;
    }
    if (item.type === "armor" && isShieldItem(item)) {
      return <Shield className="w-4 h-4" />;
    }
    if (item.type === "armor") {
      return <Shirt className="w-4 h-4" />;
    }
    if (item.type === "tool") {
      return <Package className="w-4 h-4" />;
    }
    if (item.type === "treasure") {
      return <StarIcon className="w-4 h-4" />;
    }
    return <Package className="w-4 h-4" />;
  };

  // Filter items by type
  const equipableItems = inventory.filter((item) => item.type === 'weapon' || item.type === 'armor');
  const consumableItems = inventory.filter((item) => item.type === 'consumable');
  const treasureItems = inventory.filter((item) => item.type === 'treasure');
  const toolItems = inventory.filter((item) => item.type === 'tool');
  const otherItems = inventory.filter((item) => item.type === 'other');

  if (loading) {
    return (
      <div className="text-center py-8">
        <Loader2 className="w-8 h-8 animate-spin mx-auto mb-4" />
        <p>Loading inventory...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h3 className="text-lg font-semibold">Items</h3>
        <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="w-4 h-4 mr-2" />
              Add Item
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add New Item</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label htmlFor="itemName">Item Name *</Label>
                <Input
                  id="itemName"
                  value={newItem.name || ''}
                  onChange={(e) => setNewItem(prev => ({ ...prev, name: e.target.value }))}
                  placeholder="Enter item name"
                />
              </div>
              <div>
                <Label htmlFor="itemDescription">Description</Label>
                <Textarea
                  id="itemDescription"
                  value={newItem.description || ''}
                  onChange={(e) => setNewItem(prev => ({ ...prev, description: e.target.value }))}
                  placeholder="Enter item description"
                  rows={3}
                />
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <Label htmlFor="itemType">Type</Label>
                  <Select 
                    value={newItem.type ?? 'other'} 
                    onValueChange={(value) => setNewItem(prev => ({ ...prev, type: value as InventoryItem['type'] }))}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select type" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="weapon">Weapon</SelectItem>
                      <SelectItem value="armor">Armor</SelectItem>
                      <SelectItem value="consumable">Consumable</SelectItem>
                      <SelectItem value="tool">Tool</SelectItem>
                      <SelectItem value="treasure">Treasure</SelectItem>
                      <SelectItem value="other">Other</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="itemQuantity">Quantity</Label>
                  <Input
                    id="itemQuantity"
                    type="number"
                    min="1"
                    value={newItem.quantity || 1}
                    onChange={(e) => setNewItem(prev => ({ ...prev, quantity: parseInt(e.target.value) || 1 }))}
                  />
                </div>
                <div>
                  <Label htmlFor="itemWeight">Weight (lbs)</Label>
                  <Input
                    id="itemWeight"
                    type="number"
                    min="0"
                    step="0.1"
                    value={newItem.weight || 0}
                    onChange={(e) => setNewItem(prev => ({ ...prev, weight: parseFloat(e.target.value) || 0 }))}
                  />
                </div>
              </div>
              <div>
                <Label htmlFor="itemValueAmount">Value</Label>
                <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,120px)] gap-2">
                  <Input
                    id="itemValueAmount"
                    type="number"
                    min="0"
                    value={newItem.value?.amount ?? 0}
                    onChange={(e) => setNewItem((prev) => ({
                      ...prev,
                      value: {
                        amount: Number.parseFloat(e.target.value) || 0,
                        currency: prev.value?.currency ?? 'gp',
                      },
                    }))}
                  />
                  <Select
                    value={newItem.value?.currency ?? 'gp'}
                    onValueChange={(value) => setNewItem((prev) => ({
                      ...prev,
                      value: {
                        amount: prev.value?.amount ?? 0,
                        currency: value,
                      },
                    }))}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="cp">Copper</SelectItem>
                      <SelectItem value="sp">Silver</SelectItem>
                      <SelectItem value="ep">Electrum</SelectItem>
                      <SelectItem value="gp">Gold</SelectItem>
                      <SelectItem value="pp">Platinum</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-4">
              <Button variant="outline" onClick={() => setShowAddDialog(false)}>
                Cancel
              </Button>
              <Button onClick={addItem}>
                Add Item
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Equipment */}
        <Card>
          <CardHeader>
            <CardTitle>Equipment</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {equipableItems.map((item) => (
              <div key={item.id} className="flex items-start justify-between p-3 border rounded">
                <div className="flex items-start gap-3">
                  {getEquipmentIcon(item)}
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{item.name}</span>
                      <Badge variant="outline" className="text-xs">×{item.quantity}</Badge>
                      {isItemEquipped(item) && <Badge variant="secondary" className="text-xs">Equipped</Badge>}
                    </div>
                    {item.description && (
                      <p className="text-sm text-muted-foreground mt-1">{item.description}</p>
                    )}
                    <p className="text-xs text-muted-foreground mt-1">Value: {formatItemValue(item.value)}</p>
                  </div>
                </div>
                <div className="flex gap-1">
                  <Button 
                    variant="ghost" 
                    size="sm"
                    onClick={() => toggleEquipItem(item)}
                  >
                    {isItemEquipped(item) ? "Unequip" : "Equip"}
                  </Button>
                  <Button 
                    variant="ghost" 
                    size="sm"
                    onClick={() => removeItem(item.id)}
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            ))}
            {equipableItems.length === 0 && (
              <p className="text-center text-muted-foreground py-4">No equipment items</p>
            )}
          </CardContent>
        </Card>

        {/* Consumables */}
        <Card>
          <CardHeader>
            <CardTitle>Consumables</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {consumableItems.map((item) => (
              <div key={item.id} className="flex items-start justify-between p-3 border rounded">
                <div className="flex items-start gap-3">
                  <Package className="w-4 h-4 mt-1" />
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{item.name}</span>
                      <Badge variant="outline">×{item.quantity}</Badge>
                    </div>
                    {item.description && (
                      <p className="text-sm text-muted-foreground mt-1">{item.description}</p>
                    )}
                    <p className="text-xs text-muted-foreground mt-1">Value: {formatItemValue(item.value)}</p>
                  </div>
                </div>
                <div className="flex gap-1">
                  <Button 
                    variant="ghost" 
                    size="sm"
                    onClick={() => updateItemQuantity(item.id, -1)}
                    disabled={updating}
                  >
                    <Minus className="w-4 h-4" />
                  </Button>
                  <Button 
                    variant="ghost" 
                    size="sm"
                    onClick={() => updateItemQuantity(item.id, 1)}
                    disabled={updating}
                  >
                    <Plus className="w-4 h-4" />
                  </Button>
                  <Button 
                    variant="ghost" 
                    size="sm"
                    onClick={() => removeItem(item.id)}
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            ))}
            {consumableItems.length === 0 && (
              <p className="text-center text-muted-foreground py-4">No consumable items</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Tools */}
      {toolItems.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Tools</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {toolItems.map((item) => (
                <div key={item.id} className="flex items-center justify-between p-3 border rounded">
                  <div className="flex items-center gap-2">
                    <Package className="w-4 h-4" />
                    <span className="font-medium">{item.name}</span>
                    <Badge variant="outline" className="text-xs">×{item.quantity}</Badge>
                  </div>
                  <span className="text-xs text-muted-foreground">{formatItemValue(item.value)}</span>
                  <Button 
                    variant="ghost" 
                    size="sm"
                    onClick={() => removeItem(item.id)}
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Treasure */}
      {treasureItems.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Treasure</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {treasureItems.map((item) => (
                <div key={item.id} className="flex items-center justify-between p-3 border rounded">
                  <div className="flex items-center gap-2">
                    <StarIcon className="w-4 h-4" />
                    <span className="font-medium">{item.name}</span>
                    <Badge variant="outline" className="text-xs">×{item.quantity}</Badge>
                  </div>
                  <span className="text-xs text-muted-foreground">{formatItemValue(item.value)}</span>
                  <Button 
                    variant="ghost" 
                    size="sm"
                    onClick={() => removeItem(item.id)}
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Other */}
      {otherItems.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Miscellaneous</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {otherItems.map((item) => (
                <div key={item.id} className="flex items-center justify-between p-3 border rounded">
                  <div className="flex items-center gap-2">
                    <Package className="w-4 h-4" />
                    <span className="font-medium">{item.name}</span>
                    <Badge variant="outline" className="text-xs">×{item.quantity}</Badge>
                  </div>
                  <span className="text-xs text-muted-foreground">{formatItemValue(item.value)}</span>
                  <Button 
                    variant="ghost" 
                    size="sm"
                    onClick={() => removeItem(item.id)}
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {updating && (
        <div className="text-center py-2">
          <Loader2 className="w-4 h-4 animate-spin inline mr-2" />
          Saving changes...
        </div>
      )}
    </div>
  );
}
