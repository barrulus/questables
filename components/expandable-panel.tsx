import { useState, useEffect, useMemo, useCallback } from "react";
import { Button } from "./ui/button";
import { ScrollArea } from "./ui/scroll-area";

import Journals from "./journals";
import { Settings } from "./settings";
import { FeatureUnavailable } from "./feature-unavailable";
import { CharacterSheet } from "./character-sheet";
import { Inventory } from "./inventory";
import { Spellbook } from "./spellbook";
import { useUser } from "../contexts/UserContext";
import { useGameSession } from "../contexts/GameSessionContext";
import { apiFetch, readJsonBody } from "../utils/api-client";
import { OfflineModeWrapper } from './database-status';
import { NarrativeConsole } from "./narrative-console";
import { DMSidebar } from "./dm-sidebar";
import {
  User,
  Package,
  BookOpen,
  Sparkles,
  X,
  ScrollText,
  Cog,
  Crown,
  Loader2,
} from "lucide-react";

interface CampaignCharacterRow {
  id: string;
  name: string;
  level: number;
  class: string;
  campaign_user_id: string;
}

interface ExpandablePanelProps {
  activePanel: string | null;
  onClose: () => void;
}

export function ExpandablePanel({ activePanel, onClose }: ExpandablePanelProps) {
  const { user } = useUser();
  const { activeCampaign, activeCampaignId, viewerRole } = useGameSession();
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [campaignCharacterId, setCampaignCharacterId] = useState<string>('');
  const [campaignCharacterLabel, setCampaignCharacterLabel] = useState<string>('');
  const [loadingCharacters, setLoadingCharacters] = useState(true);
  const [characterError, setCharacterError] = useState<string | null>(null);

  const canAccessDmSidebar = useMemo(() => {
    if (!user) return false;
    if (user.roles?.includes('admin')) return true;
    if (viewerRole && ['dm', 'co-dm'].includes(viewerRole)) return true;
    if (activeCampaign?.dmUserId && activeCampaign.dmUserId === user.id) return true;
    return false;
  }, [activeCampaign?.dmUserId, user, viewerRole]);

  const loadCampaignCharacter = useCallback(async (signal?: AbortSignal) => {
    if (!user || !activeCampaignId) {
      setCampaignCharacterId('');
      setCampaignCharacterLabel('');
      setLoadingCharacters(false);
      return;
    }

    try {
      setLoadingCharacters(true);
      setCharacterError(null);
      const response = await apiFetch(`/api/campaigns/${activeCampaignId}/characters`, { signal });
      if (!response.ok) {
        throw new Error('Failed to load campaign characters');
      }
      const rows = await readJsonBody<CampaignCharacterRow[]>(response);
      const characters = Array.isArray(rows) ? rows : [];
      const mine = characters.find((c) => c.campaign_user_id === user.id);

      if (mine) {
        setCampaignCharacterId(mine.id);
        setCampaignCharacterLabel(`${mine.name} (Level ${mine.level} ${mine.class})`);
      } else {
        setCampaignCharacterId('');
        setCampaignCharacterLabel('');
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      setCharacterError(err instanceof Error ? err.message : 'Failed to load character');
    } finally {
      setLoadingCharacters(false);
    }
  }, [activeCampaignId, user]);

  useEffect(() => {
    const controller = new AbortController();
    loadCampaignCharacter(controller.signal);
    return () => controller.abort();
  }, [loadCampaignCharacter]);

  if (!activePanel) return null;

  const refreshCharacter = () => {
    setRefreshTrigger(prev => prev + 1);
  };

  // Check if the current panel needs character selection
  const needsCharacterSelection = ['character', 'inventory', 'spells'].includes(activePanel);

  const renderPanelContent = () => {
    switch (activePanel) {
      case "character":
        return (
          <OfflineModeWrapper>
            <CharacterSheet characterId={campaignCharacterId} refreshTrigger={refreshTrigger} />
          </OfflineModeWrapper>
        );
      case "inventory":
        return (
          <OfflineModeWrapper>
            <Inventory characterId={campaignCharacterId} onInventoryChange={refreshCharacter} />
          </OfflineModeWrapper>
        );
      case "spells":
        return (
          <OfflineModeWrapper>
            <Spellbook characterId={campaignCharacterId} onSpellcastingChange={refreshCharacter} />
          </OfflineModeWrapper>
        );
      case "narratives":
        return <NarrativeConsole />;
      case "journals":
        return <Journals campaignId={activeCampaignId ?? undefined} />;
      case "settings":
        return <Settings />;
      case "dm-sidebar":
        if (!canAccessDmSidebar) {
          return (
            <FeatureUnavailable
              feature="DM Sidebar"
              reason="Only the active campaign’s DM, co-DMs, or administrators can access live sidebar controls."
              remediation="Request DM access from the campaign owner or switch to a campaign where you have DM permissions."
            />
          );
        }
        return <DMSidebar />;
      default:
        return null;
    }
  };

  const getPanelTitle = () => {
    switch (activePanel) {
      case "character": return "Active Character";
      case "inventory": return "Inventory";
      case "spells": return "Spellbook";
      case "narratives": return "Narrative Console";
      case "journals": return "Session Notes";
      case "settings": return "Settings";
      case "dm-sidebar": return "DM Sidebar";
      default: return "";
    }
  };

  const getPanelIcon = () => {
    switch (activePanel) {
      case "character": return <User className="w-5 h-5" />;
      case "inventory": return <Package className="w-5 h-5" />;
      case "spells": return <BookOpen className="w-5 h-5" />;
      case "narratives": return <Sparkles className="w-5 h-5" />;
      case "journals": return <ScrollText className="w-5 h-5" />;
      case "settings": return <Cog className="w-5 h-5" />;
      case "dm-sidebar": return <Crown className="w-5 h-5" />;
      default: return null;
    }
  };

  return (
    <div className="fixed inset-y-0 left-0 z-40 w-full sm:w-72 lg:w-96 md:static md:z-auto border-r bg-card flex flex-col">
      <div className="border-b p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            {getPanelIcon()}
            <h2 className="font-semibold">{getPanelTitle()}</h2>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose}>
            <X className="w-4 h-4" />
          </Button>
        </div>
        
        {/* Campaign Character */}
        {needsCharacterSelection && user && (
          <div className="space-y-2">
            {characterError ? (
              <div className="p-2 border border-red-200 bg-red-50 rounded">
                <p className="text-red-800 text-sm">Failed to load character</p>
                <p className="text-red-600 text-xs">{characterError}</p>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-2"
                  onClick={() => loadCampaignCharacter()}
                >
                  Retry
                </Button>
              </div>
            ) : loadingCharacters ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="w-3 h-3 animate-spin" />
                Loading character...
              </div>
            ) : campaignCharacterId ? (
              <div className="text-sm text-muted-foreground">
                Active character: <span className="font-medium text-foreground">{campaignCharacterLabel}</span>
              </div>
            ) : (
              <div className="text-sm text-muted-foreground">
                No character enrolled in this campaign. Join the campaign with a character from the dashboard.
              </div>
            )}
          </div>
        )}
      </div>
      
      {activePanel === "dm-sidebar" ? (
        <div className="flex-1 min-h-0">
          {renderPanelContent()}
        </div>
      ) : (
        <ScrollArea className="flex-1">
          <div className="p-4">
            {renderPanelContent()}
          </div>
        </ScrollArea>
      )}
    </div>
  );
}
