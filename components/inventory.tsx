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
import { Coins, Package, Sword, Shield, Shirt, Plus, Minus, Trash2, Edit, Loader2 } from "lucide-react";
import { characterHelpers, type Character, type InventoryItem, type Equipment } from '../utils/database/data-helpers';

interface InventoryProps {
  characterId: string;
  onInventoryChange?: () => void;
}

interface Currency {
  copper: number;
  silver: number;
  gold: number;
  platinum: number;
}

export function Inventory({ characterId, onInventoryChange }: InventoryProps) {
  const [character, setCharacter] = useState<Character | null>(null);
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [equipment, setEquipment] = useState<Equipment | null>(null);
  const [currency, setCurrency] = useState<Currency>({ copper: 0, silver: 0, gold: 0, platinum: 0 });
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);
  
  // Add item dialog state
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [newItem, setNewItem] = useState<Partial<InventoryItem>>({
    name: '',
    description: '',
    quantity: 1,
    type: 'gear',
    weight: 0,
    value: { gold: 0 }
  });

  // Load character inventory data
  const loadCharacterInventory = async () => {
    try {
      setLoading(true);
      const char = await characterHelpers.getCharacter(characterId);
      if (char) {
        setCharacter(char);
        setInventory(char.inventory || []);
        setEquipment(char.equipment || {});
        
        // Extract currency from inventory or set defaults
        const currencyItem = char.inventory?.find(item => item.type === 'currency');
        if (currencyItem && typeof currencyItem.value === 'object' && currencyItem.value !== null) {
          setCurrency({
            copper: currencyItem.value.copper || 0,
            silver: currencyItem.value.silver || 0,
            gold: currencyItem.value.gold || 0,
            platinum: currencyItem.value.platinum || 0
          });
        }
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
  const updateCharacterData = async (updates: Partial<Character>) => {
    try {
      setUpdating(true);
      await characterHelpers.updateCharacter(characterId, updates);
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
      const item: InventoryItem = {
        id: `item_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        name: newItem.name.trim(),
        description: newItem.description || '',
        quantity: newItem.quantity || 1,
        type: newItem.type || 'gear',
        weight: newItem.weight || 0,
        value: newItem.value || { gold: 0 }
      };
      
      const updatedInventory = [...inventory, item];
      setInventory(updatedInventory);
      
      await updateCharacterData({ inventory: updatedInventory });
      
      // Reset form and close dialog
      setNewItem({
        name: '',
        description: '',
        quantity: 1,
        type: 'gear',
        weight: 0,
        value: { gold: 0 }
      });
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
        if (updatedEquipment.armor?.id === item.id) {
          delete updatedEquipment.armor;
        } else {
          updatedEquipment.armor = item;
        }
      } else if (item.type === 'shield') {
        if (updatedEquipment.shield?.id === item.id) {
          delete updatedEquipment.shield;
        } else {
          updatedEquipment.shield = item;
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

  // Update currency
  const updateCurrency = async (newCurrency: Currency) => {
    try {
      // Find or create currency item in inventory
      const currencyItemIndex = inventory.findIndex(item => item.type === 'currency');
      const updatedInventory = [...inventory];
      
      if (currencyItemIndex >= 0) {
        updatedInventory[currencyItemIndex] = {
          ...updatedInventory[currencyItemIndex],
          value: newCurrency
        };
      } else {
        updatedInventory.push({
          id: 'currency',
          name: 'Currency',
          description: 'Character currency',
          quantity: 1,
          type: 'currency',
          weight: 0,
          value: newCurrency
        });
      }
      
      setInventory(updatedInventory);
      setCurrency(newCurrency);
      await updateCharacterData({ inventory: updatedInventory });
    } catch (error) {
      console.error('Failed to update currency:', error);
      toast.error('Failed to update currency');
    }
  };

  // Get equipment icon
  const getEquipmentIcon = (type: string) => {
    switch (type) {
      case "weapon": return <Sword className="w-4 h-4" />;
      case "armor": return <Shirt className="w-4 h-4" />;
      case "shield": return <Shield className="w-4 h-4" />;
      default: return <Package className="w-4 h-4" />;
    }
  };

  // Filter items by type
  const equipmentItems = inventory.filter(item => ['weapon', 'armor', 'shield'].includes(item.type));
  const consumableItems = inventory.filter(item => ['consumable', 'potion'].includes(item.type));
  const gearItems = inventory.filter(item => !['weapon', 'armor', 'shield', 'consumable', 'potion', 'currency'].includes(item.type));

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
      {/* Currency */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Coins className="w-5 h-5" />
            Currency
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-4 gap-4">
            <div className="text-center p-3 border rounded">
              <Input
                type="number"
                value={currency.platinum}
                onChange={(e) => setCurrency(prev => ({ ...prev, platinum: parseInt(e.target.value) || 0 }))}
                onBlur={() => updateCurrency(currency)}
                className="text-center text-lg font-bold border-0 p-0 h-8"
                min="0"
              />
              <div className="text-sm text-muted-foreground">Platinum</div>
            </div>
            <div className="text-center p-3 border rounded">
              <Input
                type="number"
                value={currency.gold}
                onChange={(e) => setCurrency(prev => ({ ...prev, gold: parseInt(e.target.value) || 0 }))}
                onBlur={() => updateCurrency(currency)}
                className="text-center text-lg font-bold border-0 p-0 h-8"
                min="0"
              />
              <div className="text-sm text-muted-foreground">Gold</div>
            </div>
            <div className="text-center p-3 border rounded">
              <Input
                type="number"
                value={currency.silver}
                onChange={(e) => setCurrency(prev => ({ ...prev, silver: parseInt(e.target.value) || 0 }))}
                onBlur={() => updateCurrency(currency)}
                className="text-center text-lg font-bold border-0 p-0 h-8"
                min="0"
              />
              <div className="text-sm text-muted-foreground">Silver</div>
            </div>
            <div className="text-center p-3 border rounded">
              <Input
                type="number"
                value={currency.copper}
                onChange={(e) => setCurrency(prev => ({ ...prev, copper: parseInt(e.target.value) || 0 }))}
                onBlur={() => updateCurrency(currency)}
                className="text-center text-lg font-bold border-0 p-0 h-8"
                min="0"
              />
              <div className="text-sm text-muted-foreground">Copper</div>
            </div>
          </div>
        </CardContent>
      </Card>

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
                    value={newItem.type || 'gear'} 
                    onValueChange={(value) => setNewItem(prev => ({ ...prev, type: value as any }))}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="weapon">Weapon</SelectItem>
                      <SelectItem value="armor">Armor</SelectItem>
                      <SelectItem value="shield">Shield</SelectItem>
                      <SelectItem value="consumable">Consumable</SelectItem>
                      <SelectItem value="potion">Potion</SelectItem>
                      <SelectItem value="gear">Gear</SelectItem>
                      <SelectItem value="treasure">Treasure</SelectItem>
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
                <Label htmlFor="itemValue">Value (Gold)</Label>
                <Input
                  id="itemValue"
                  type="number"
                  min="0"
                  value={typeof newItem.value === 'object' && newItem.value !== null ? newItem.value.gold || 0 : 0}
                  onChange={(e) => setNewItem(prev => ({ 
                    ...prev, 
                    value: { gold: parseInt(e.target.value) || 0 }
                  }))}
                />
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
            {equipmentItems.map((item) => (
              <div key={item.id} className="flex items-start justify-between p-3 border rounded">
                <div className="flex items-start gap-3">
                  {getEquipmentIcon(item.type)}
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{item.name}</span>
                      <Badge variant="outline" className="text-xs">×{item.quantity}</Badge>
                      {isItemEquipped(item) && <Badge variant="secondary" className="text-xs">Equipped</Badge>}
                    </div>
                    <p className="text-sm text-muted-foreground mt-1">{item.description}</p>
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
            {equipmentItems.length === 0 && (
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
                    <p className="text-sm text-muted-foreground mt-1">{item.description}</p>
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

      {/* Gear Items */}
      {gearItems.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Gear & Miscellaneous</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {gearItems.map((item) => (
                <div key={item.id} className="flex items-center justify-between p-3 border rounded">
                  <div className="flex items-center gap-2">
                    <Package className="w-4 h-4" />
                    <span className="font-medium">{item.name}</span>
                    <Badge variant="outline" className="text-xs">×{item.quantity}</Badge>
                  </div>
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