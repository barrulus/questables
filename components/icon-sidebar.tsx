import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "./ui/tooltip";
import { 
  User, 
  Package, 
  Dice6, 
  BookOpen, 
  Sword,
  Compass,
  Settings,
  Users,
  ScrollText,
  Book,
  Library,
  MapIcon,
  Cog
} from "lucide-react";

interface IconSidebarProps {
  activePanel: string | null;
  onPanelChange: (panel: string | null) => void;
}

export function IconSidebar({ activePanel, onPanelChange }: IconSidebarProps) {
  const tools = [
    { 
      id: "character", 
      icon: <User className="w-5 h-5" />, 
      label: "Active Character",
      badge: "8" // Level
    },
    { 
      id: "inventory", 
      icon: <Package className="w-5 h-5" />, 
      label: "Inventory",
      badge: "247g" // Gold amount
    },
    { 
      id: "spells", 
      icon: <BookOpen className="w-5 h-5" />, 
      label: "Spells",
      badge: "6" // Available spell slots
    },
    { 
      id: "dice", 
      icon: <Dice6 className="w-5 h-5" />, 
      label: "Dice Roller"
    },
    { 
      id: "combat", 
      icon: <Sword className="w-5 h-5" />, 
      label: "Combat",
      badge: "R3" // Round 3
    },
    { 
      id: "exploration", 
      icon: <Compass className="w-5 h-5" />, 
      label: "Exploration"
    },
    { 
      id: "rulebooks", 
      icon: <Book className="w-5 h-5" />, 
      label: "Rule Books",
      badge: "PHB" // Player's Handbook
    },
    { 
      id: "journals", 
      icon: <ScrollText className="w-5 h-5" />, 
      label: "Session Notes",
      badge: "12" // Number of journal entries
    },
    { 
      id: "compendium", 
      icon: <Library className="w-5 h-5" />, 
      label: "Compendium"
    }
  ];

  const handleToolClick = (toolId: string) => {
    if (activePanel === toolId) {
      onPanelChange(null); // Close if already open
    } else {
      onPanelChange(toolId); // Open new panel
    }
  };

  return (
    <div className="w-16 bg-sidebar border-r border-sidebar-border flex flex-col">
      {/* Logo/Brand */}
      <div className="h-12 flex items-center justify-center border-b border-sidebar-border">
        <div className="w-8 h-8 bg-primary rounded flex items-center justify-center">
          <span className="text-primary-foreground font-bold text-sm">D&D</span>
        </div>
      </div>

      {/* Tool Icons */}
      <div className="flex-1 py-4">
        <TooltipProvider>
          <div className="space-y-2">
            {tools.map((tool) => (
              <div key={tool.id} className="px-2">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant={activePanel === tool.id ? "default" : "ghost"}
                      size="sm"
                      className="w-full h-12 p-0 relative"
                      onClick={() => handleToolClick(tool.id)}
                    >
                      <div className="flex flex-col items-center gap-1">
                        {tool.icon}
                        {tool.badge && (
                          <Badge 
                            variant="secondary" 
                            className="absolute -top-1 -right-1 text-xs px-1 h-4 min-w-4"
                          >
                            {tool.badge}
                          </Badge>
                        )}
                      </div>
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="right">
                    <p>{tool.label}</p>
                  </TooltipContent>
                </Tooltip>
              </div>
            ))}
          </div>
        </TooltipProvider>
      </div>

      {/* Settings */}
      <div className="p-2 border-t border-sidebar-border">
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button 
                variant={activePanel === "settings" ? "default" : "ghost"} 
                size="sm" 
                className="w-full h-12 p-0"
                onClick={() => handleToolClick("settings")}
              >
                <Settings className="w-5 h-5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">
              <p>Settings</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
    </div>
  );
}