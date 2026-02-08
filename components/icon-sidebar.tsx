import { useMemo } from "react";
import { Button } from "./ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "./ui/tooltip";
import {
  User,
  Package,
  BookOpen,
  Sparkles,
  Settings,
  ScrollText,
  Crown,
} from "lucide-react";
import { useGameSession } from "../contexts/GameSessionContext";
import { useUser } from "../contexts/UserContext";

interface IconSidebarProps {
  activePanel: string | null;
  onPanelChange: (_panelId: string | null) => void;
}

export function IconSidebar({ activePanel, onPanelChange }: IconSidebarProps) {
  const { activeCampaign, viewerRole } = useGameSession();
  const { user } = useUser();

  const canAccessDmSidebar = useMemo(() => {
    if (!user) return false;
    if (user.roles?.includes("admin")) return true;
    if (viewerRole && ["dm", "co-dm"].includes(viewerRole)) return true;
    if (activeCampaign?.dmUserId && activeCampaign.dmUserId === user.id) return true;
    return false;
  }, [activeCampaign?.dmUserId, user, viewerRole]);

  const tools = useMemo(() => {
    const baseTools = [
      {
        id: "character",
        icon: <User className="w-5 h-5" />,
        label: "Active Character",
      },
      {
        id: "inventory",
        icon: <Package className="w-5 h-5" />,
        label: "Inventory",
      },
      {
        id: "spells",
        icon: <BookOpen className="w-5 h-5" />,
        label: "Spells",
      },
      {
        id: "narratives",
        icon: <Sparkles className="w-5 h-5" />,
        label: "Narratives",
      },
      {
        id: "journals",
        icon: <ScrollText className="w-5 h-5" />,
        label: "Session Notes",
      },
    ];

    if (!canAccessDmSidebar) {
      return baseTools;
    }

    return [
      {
        id: "dm-sidebar",
        icon: <Crown className="w-5 h-5" />,
        label: "DM Sidebar",
      },
      ...baseTools,
    ];
  }, [canAccessDmSidebar]);

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
      <div className="flex-1 py-4 overflow-y-auto">
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
