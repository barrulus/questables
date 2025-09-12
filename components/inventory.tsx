import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Separator } from "./ui/separator";
import { Coins, Package, Sword, Shield, Shirt } from "lucide-react";

export function Inventory() {
  const currency = {
    platinum: 15,
    gold: 247,
    silver: 38,
    copper: 156
  };

  const equipment = [
    { name: "Longsword +1", type: "weapon", description: "A magical longsword with a +1 enchantment", equipped: true },
    { name: "Studded Leather Armor", type: "armor", description: "Light armor made of tough leather with metal studs", equipped: true },
    { name: "Shield", type: "shield", description: "A sturdy wooden shield reinforced with iron", equipped: true },
    { name: "Longbow", type: "weapon", description: "A composite longbow for ranged combat", equipped: false },
    { name: "Quiver", type: "gear", description: "Holds up to 20 arrows", equipped: true },
  ];

  const consumables = [
    { name: "Arrows", quantity: 47, description: "Standard arrows for longbow" },
    { name: "Healing Potion", quantity: 3, description: "Restores 2d4+2 hit points" },
    { name: "Rations", quantity: 7, description: "One day's food for a Medium creature" },
    { name: "Rope (50 feet)", quantity: 1, description: "Hemp rope, 2 hit points, AC 11" },
    { name: "Thieves' Tools", quantity: 1, description: "Set of tools for picking locks" },
  ];

  const miscItems = [
    "Bedroll", "Blanket", "Tinderbox", "Torch (5)", "Waterskin", "Belt Pouch",
    "Hunting Trap", "Traveler's Clothes", "Signet Ring", "Scroll Case"
  ];

  const getEquipmentIcon = (type: string) => {
    switch (type) {
      case "weapon": return <Sword className="w-4 h-4" />;
      case "armor": return <Shirt className="w-4 h-4" />;
      case "shield": return <Shield className="w-4 h-4" />;
      default: return <Package className="w-4 h-4" />;
    }
  };

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
              <div className="text-2xl font-bold text-blue-600">{currency.platinum}</div>
              <div className="text-sm text-muted-foreground">Platinum</div>
            </div>
            <div className="text-center p-3 border rounded">
              <div className="text-2xl font-bold text-yellow-600">{currency.gold}</div>
              <div className="text-sm text-muted-foreground">Gold</div>
            </div>
            <div className="text-center p-3 border rounded">
              <div className="text-2xl font-bold text-gray-500">{currency.silver}</div>
              <div className="text-sm text-muted-foreground">Silver</div>
            </div>
            <div className="text-center p-3 border rounded">
              <div className="text-2xl font-bold text-amber-600">{currency.copper}</div>
              <div className="text-sm text-muted-foreground">Copper</div>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Equipment */}
        <Card>
          <CardHeader>
            <CardTitle>Equipment</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {equipment.map((item, index) => (
              <div key={index} className="flex items-start justify-between p-3 border rounded">
                <div className="flex items-start gap-3">
                  {getEquipmentIcon(item.type)}
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{item.name}</span>
                      {item.equipped && <Badge variant="secondary" className="text-xs">Equipped</Badge>}
                    </div>
                    <p className="text-sm text-muted-foreground mt-1">{item.description}</p>
                  </div>
                </div>
                <Button 
                  variant="ghost" 
                  size="sm"
                  onClick={() => {/* Toggle equip/unequip */}}
                >
                  {item.equipped ? "Unequip" : "Equip"}
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Consumables */}
        <Card>
          <CardHeader>
            <CardTitle>Consumables</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {consumables.map((item, index) => (
              <div key={index} className="flex items-start justify-between p-3 border rounded">
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
                  <Button variant="ghost" size="sm">Use</Button>
                  <Button variant="ghost" size="sm">+/-</Button>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      {/* Miscellaneous Items */}
      <Card>
        <CardHeader>
          <CardTitle>Miscellaneous Items</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-2">
            {miscItems.map((item, index) => (
              <Badge key={index} variant="outline" className="justify-center p-2">
                {item}
              </Badge>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Quick Actions */}
      <Card>
        <CardHeader>
          <CardTitle>Quick Actions</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex gap-2 flex-wrap">
            <Button variant="outline">Add Item</Button>
            <Button variant="outline">Remove Item</Button>
            <Button variant="outline">Sort Inventory</Button>
            <Button variant="outline">Calculate Weight</Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}