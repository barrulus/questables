import { useState } from "react";
import { Button } from "../ui/button";
import { ItemBrowser } from "./item-browser";
import { SpellBrowser } from "./spell-browser";
import { ShopEditor } from "./shop-editor";
import { ShopView } from "./shop-view";
import { LootTableEditor } from "./loot-table-editor";
import { useGameSession } from "../../contexts/GameSessionContext";

type Tab = "items" | "spells" | "shops" | "loot";

export function CompendiumPanel() {
  const [activeTab, setActiveTab] = useState<Tab>("items");
  const { viewerRole } = useGameSession();

  const isDm = viewerRole === "dm" || viewerRole === "co-dm";

  return (
    <div className="space-y-4">
      <div className="flex gap-1 border-b flex-wrap">
        <Button
          variant={activeTab === "items" ? "default" : "ghost"}
          size="sm"
          onClick={() => setActiveTab("items")}
        >
          Items
        </Button>
        <Button
          variant={activeTab === "spells" ? "default" : "ghost"}
          size="sm"
          onClick={() => setActiveTab("spells")}
        >
          Spells
        </Button>
        <Button
          variant={activeTab === "shops" ? "default" : "ghost"}
          size="sm"
          onClick={() => setActiveTab("shops")}
        >
          Shops
        </Button>
        {isDm && (
          <Button
            variant={activeTab === "loot" ? "default" : "ghost"}
            size="sm"
            onClick={() => setActiveTab("loot")}
          >
            Loot
          </Button>
        )}
      </div>

      {activeTab === "items" && <ItemBrowser />}
      {activeTab === "spells" && <SpellBrowser />}
      {activeTab === "shops" && (isDm ? <ShopEditor /> : <ShopView />)}
      {activeTab === "loot" && isDm && <LootTableEditor />}
    </div>
  );
}
