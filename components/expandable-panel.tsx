import { useState, useEffect, useMemo } from "react";
import { Button } from "./ui/button";
import { ScrollArea } from "./ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";

import Journals from "./journals";
import { Settings } from "./settings";
import { FeatureUnavailable } from "./feature-unavailable";
import { CharacterSheet } from "./character-sheet";
import { Inventory } from "./inventory";
import { Spellbook } from "./spellbook";
import { useUser } from "../contexts/UserContext";
import { useGameSession } from "../contexts/GameSessionContext";
import type { Character } from '../utils/database/data-structures';
import { listUserCharacters } from '../utils/api/characters';
import { createAsyncHandler } from '../utils/error-handling';
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
  Crown
} from "lucide-react";

interface ExpandablePanelProps {
  activePanel: string | null;
  onClose: () => void;
}

export function ExpandablePanel({ activePanel, onClose }: ExpandablePanelProps) {
  const { user } = useUser();
  const { activeCampaign, viewerRole } = useGameSession();
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [selectedCharacter, setSelectedCharacter] = useState<string>('');
  const [userCharacters, setUserCharacters] = useState<Character[]>([]);
  const [loadingCharacters, setLoadingCharacters] = useState(true);
  const [characterError, setCharacterError] = useState<string | null>(null);

  const canAccessDmSidebar = useMemo(() => {
    if (!user) return false;
    if (user.roles?.includes('admin')) return true;
    if (viewerRole && ['dm', 'co-dm'].includes(viewerRole)) return true;
    if (activeCampaign?.dmUserId && activeCampaign.dmUserId === user.id) return true;
    return false;
  }, [activeCampaign?.dmUserId, user, viewerRole]);

  // Load user's characters when component mounts
  useEffect(() => {
    if (user) {
      loadUserCharacters();
    }
  }, [user]);

  const loadUserCharacters = createAsyncHandler(
    async () => {
      if (!user) return;
      
      const characters = await listUserCharacters(user.id);
      setUserCharacters(characters || []);
      
      // Auto-select first character if available and none selected
      if (characters?.length > 0 && !selectedCharacter) {
        setSelectedCharacter(characters[0].id);
      }
    },
    setCharacterError,
    setLoadingCharacters
  );

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
            <CharacterSheet characterId={selectedCharacter} refreshTrigger={refreshTrigger} />
          </OfflineModeWrapper>
        );
      case "inventory":
        return (
          <OfflineModeWrapper>
            <Inventory characterId={selectedCharacter} onInventoryChange={refreshCharacter} />
          </OfflineModeWrapper>
        );
      case "spells":
        return (
          <OfflineModeWrapper>
            <Spellbook characterId={selectedCharacter} onSpellcastingChange={refreshCharacter} />
          </OfflineModeWrapper>
        );
      case "narratives":
        return <NarrativeConsole />;
      case "journals":
        return <Journals />;
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
    <div className="w-72 lg:w-96 border-r bg-card flex flex-col">
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
        
        {/* Character Selection */}
        {needsCharacterSelection && user && (
          <div className="space-y-2">
            <label className="text-sm font-medium">Select Character:</label>
            {characterError ? (
              <div className="p-2 border border-red-200 bg-red-50 rounded">
                <p className="text-red-800 text-sm">Failed to load characters</p>
                <p className="text-red-600 text-xs">{characterError}</p>
                <Button 
                  variant="outline" 
                  size="sm" 
                  className="mt-2" 
                  onClick={loadUserCharacters}
                >
                  Retry
                </Button>
              </div>
            ) : loadingCharacters ? (
              <div className="text-sm text-muted-foreground">Loading characters...</div>
            ) : userCharacters.length > 0 ? (
              <Select value={selectedCharacter} onValueChange={setSelectedCharacter}>
                <SelectTrigger>
                  <SelectValue placeholder="Choose a character" />
                </SelectTrigger>
                <SelectContent>
                  {userCharacters.map((character) => (
                    <SelectItem key={character.id} value={character.id}>
                      {character.name} (Level {character.level} {character.class})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <div className="text-sm text-muted-foreground">No characters found</div>
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
