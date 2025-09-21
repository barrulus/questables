import { Button } from "./ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "./ui/tooltip";
import { 
  User, 
  Package, 
  Dice6, 
  BookOpen, 
  Sword,
  Compass,
  Sparkles,
  Settings,
  ScrollText,
  Book,
  Library
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
      label: "Active Character"
    },
    { 
      id: "inventory", 
      icon: <Package className="w-5 h-5" />, 
      label: "Inventory"
    },
    { 
      id: "spells", 
      icon: <BookOpen className="w-5 h-5" />, 
      label: "Spells"
    },
    { 
      id: "dice", 
      icon: <Dice6 className="w-5 h-5" />, 
      label: "Dice Roller"
    },
    { 
      id: "combat", 
      icon: <Sword className="w-5 h-5" />, 
      label: "Combat"
    },
    { 
      id: "exploration", 
      icon: <Compass className="w-5 h-5" />, 
      label: "Exploration"
    },
    { 
      id: "narratives", 
      icon: <Sparkles className="w-5 h-5" />, 
      label: "Narratives"
    },
    { 
      id: "rulebooks", 
      icon: <Book className="w-5 h-5" />, 
      label: "Rule Books"
    },
    { 
      id: "journals", 
      icon: <ScrollText className="w-5 h-5" />, 
      label: "Session Notes"
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
                      className="w-full h-12 p-0"
                      onClick={() => handleToolClick(tool.id)}
                    >
                      <div className="flex flex-col items-center gap-1">
                        {tool.icon}
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
