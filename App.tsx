import { useEffect, useMemo, useState } from "react";
import { LandingPage } from "./components/landing-page";
import { PlayerDashboard } from "./components/player-dashboard";
import { DMDashboard } from "./components/dm-dashboard";
import { AdminDashboard } from "./components/admin-dashboard";
import { IconSidebar } from "./components/icon-sidebar";
import { ExpandablePanel } from "./components/expandable-panel";
import { OpenLayersMap } from "./components/openlayers-map";
import { ChatPanel } from "./components/chat-panel";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "./components/ui/resizable";
import { Badge } from "./components/ui/badge";
import { Button } from "./components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./components/ui/card";
import { Settings, Menu, Loader2, AlertCircle, User, MapIcon, Shield, PanelLeft } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { UserProvider, useUser } from "./contexts/UserContext";
import { ErrorBoundary } from "./components/error-boundary";
import { DatabaseProvider, DatabaseStatus, useDatabaseContext } from "./components/database-status";
import { GameSessionProvider, useGameSession } from "./contexts/GameSessionContext";
import { GameStateProvider } from "./contexts/GameStateContext";
import { PhaseIndicator } from "./components/game-state/phase-indicator";
import { TurnBanner } from "./components/game-state/turn-banner";
import { CharacterCreationWizard } from "./components/character-wizard/character-creation-wizard";

type AppState = "landing" | "dashboard" | "game" | "character-create";
type DashboardView = "player" | "dm" | "admin";

interface DashboardNavItem {
  key: DashboardView;
  label: string;
  description: string;
  icon: LucideIcon;
}

function AppContent() {
  const { user, logout, loading } = useUser();
  const { health } = useDatabaseContext();
  const {
    activeCampaignId,
    activeCampaign,
    latestSession,
    loading: campaignLoading,
    error: campaignError,
    refreshActiveCampaign,
  } = useGameSession();
  const [appState, setAppState] = useState<AppState>("landing");
  const [activePanel, setActivePanel] = useState<string | null>(null);
  const [activeDashboard, setActiveDashboard] = useState<DashboardView>("player");

  const dashboardNavItems = useMemo<DashboardNavItem[]>(() => {
    if (!user) return [];

    const navItems: DashboardNavItem[] = [
      {
        key: "player",
        label: "Player Dashboard",
        description: "Characters & sessions",
        icon: User,
      },
    ];

    if (user.roles?.includes("dm")) {
      navItems.push({
        key: "dm",
        label: "DM Toolkit",
        description: "Campaign management",
        icon: MapIcon,
      });
    }

    if (user.roles?.includes("admin")) {
      navItems.push({
        key: "admin",
        label: "Admin Console",
        description: "System metrics",
        icon: Shield,
      });
    }

    return navItems;
  }, [user]);

  const userId = user?.id;

  useEffect(() => {
    if (user && appState === "landing") {
      setAppState("dashboard");
    }

    if (!user && appState !== "landing") {
      setAppState("landing");
      setActivePanel(null);
      setActiveDashboard("player");
    }
  }, [user, appState]);

  useEffect(() => {
    if (userId) {
      setActiveDashboard("player");
    }
  }, [userId]);

  useEffect(() => {
    if (!user) {
      return;
    }

    if (!dashboardNavItems.some((item) => item.key === activeDashboard)) {
      setActiveDashboard("player");
    }
  }, [user, dashboardNavItems, activeDashboard]);

  const handleLogin = () => {
    setActiveDashboard("player");
    setAppState("dashboard");
  };

  const handleLogout = () => {
    logout();
    setAppState("landing");
    setActivePanel(null);
    setActiveDashboard("player");
  };

  const handleEnterGame = () => {
    setAppState("game");
    setActivePanel(null);
  };

  const handleExitGame = () => {
    setAppState("dashboard");
  };

  // Show loading state during authentication
  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary mx-auto mb-4" />
          <p className="text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  // Landing page (pre-login) or if no user
  if (appState === "landing" || !user) {
    return <LandingPage onLogin={handleLogin} />;
  }

  // Dashboard view (post-login, pre-game)
  if (appState === "dashboard" && user) {
    const renderDashboard = () => {
      switch (activeDashboard) {
        case "dm":
          if (user.roles?.includes("dm")) {
            return (
              <DMDashboard
                user={user}
                onEnterGame={handleEnterGame}
                onLogout={handleLogout}
              />
            );
          }
          break;
        case "admin":
          if (user.roles?.includes("admin")) {
            return <AdminDashboard user={user} onLogout={handleLogout} />;
          }
          break;
        case "player":
        default:
          break;
      }

      return (
        <PlayerDashboard
          user={user}
          onEnterGame={handleEnterGame}
          onLogout={handleLogout}
          onCreateCharacter={() => setAppState("character-create")}
        />
      );
    };

    const dashboardContent = renderDashboard();

    return (
      <div className="min-h-screen bg-background flex flex-col">
        {dashboardNavItems.length > 1 && (
          <div className="border-b bg-card">
            <div className="mx-auto flex w-full max-w-7xl flex-wrap items-center gap-2 px-4 py-3">
              <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Dashboards
              </span>
              <div className="flex flex-wrap gap-2">
                {dashboardNavItems.map((item) => {
                  const Icon = item.icon;
                  const isActive = activeDashboard === item.key;
                  return (
                    <Button
                      key={item.key}
                      variant={isActive ? "default" : "outline"}
                      size="sm"
                      className="flex items-center gap-2"
                      onClick={() => setActiveDashboard(item.key)}
                    >
                      <Icon className="h-4 w-4" aria-hidden="true" />
                      <span>{item.label}</span>
                    </Button>
                  );
                })}
              </div>
            </div>
          </div>
        )}
        <div className="flex-1">
          {dashboardContent}
        </div>
      </div>
    );
  }

  // Character creation wizard
  if (appState === "character-create" && user) {
    return (
      <CharacterCreationWizard
        user={user}
        onBack={() => setAppState("dashboard")}
        onCharacterCreated={() => setAppState("dashboard")}
      />
    );
  }

  // Game view (the original D&D interface)
  if (appState === "game" && user) {
    if (!activeCampaignId && !campaignLoading) {
      return (
        <div className="min-h-screen bg-background flex items-center justify-center px-6">
          <Card className="max-w-lg w-full">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <AlertCircle className="w-5 h-5 text-destructive" />
                Select a campaign to continue
              </CardTitle>
              <CardDescription>
                Choose an active campaign from your dashboard before entering the shared game view.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex justify-end gap-2">
              <Button variant="outline" onClick={handleExitGame}>
                Return to dashboard
              </Button>
            </CardContent>
          </Card>
        </div>
      );
    }

    if (campaignLoading && !activeCampaign) {
      return (
        <div className="min-h-screen bg-background flex items-center justify-center">
          <div className="text-center">
            <Loader2 className="h-8 w-8 animate-spin text-primary mx-auto mb-4" />
            <p className="text-muted-foreground">Loading campaign data…</p>
          </div>
        </div>
      );
    }

    return (
      <div className="min-h-screen bg-background flex flex-col">
        {campaignError && (
          <div className="border-b border-destructive/30 bg-destructive/10 text-destructive px-4 py-2 text-sm">
            {campaignError}
            <Button
              variant="link"
              size="sm"
              disabled={campaignLoading}
              className="ml-2 text-destructive underline-offset-2"
              onClick={() => void refreshActiveCampaign()}
            >
              Retry
            </Button>
          </div>
        )}
        {/* Header */}
        <div className="border-b bg-card">
          <div className="flex items-center justify-between px-4 py-3">
            <div className="flex items-center gap-4">
              <Button variant="ghost" size="sm" onClick={handleExitGame}>
                <Menu className="w-4 h-4" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="md:hidden"
                onClick={() => setActivePanel(activePanel ? null : "character")}
                aria-label="Toggle tools panel"
              >
                <PanelLeft className="w-4 h-4" />
              </Button>
              <div>
                <h1 className="font-bold">
                  {activeCampaign?.name ?? "Campaign"}
                </h1>
                <p className="text-sm text-muted-foreground">
                  {activeCampaign
                    ? [activeCampaign.system, activeCampaign.setting]
                        .filter(Boolean)
                        .join(" • ") || "Live campaign data"
                    : "Live campaign data"}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 justify-end">
              {campaignLoading && (
                <Badge variant="secondary" className="flex items-center gap-1">
                  <Loader2 className="w-3 h-3 animate-spin" />
                  Syncing
                </Badge>
              )}
              {activeCampaign && (
                <Badge variant="outline" className="capitalize">
                  {activeCampaign.status}
                </Badge>
              )}
              {activeCampaign?.system && (
                <Badge variant="outline">{activeCampaign.system}</Badge>
              )}
              {activeCampaign?.levelRange && (
                <Badge variant="outline">
                  Levels {activeCampaign.levelRange.min}-{activeCampaign.levelRange.max}
                </Badge>
              )}
              {latestSession && (
                <Badge variant="secondary" className="capitalize">
                  Session {latestSession.sessionNumber}
                  {latestSession.title ? ` · ${latestSession.title}` : ""}
                </Badge>
              )}
              {!latestSession && !campaignLoading && (
                <Badge variant="outline">No sessions recorded</Badge>
              )}
              <PhaseIndicator />
              <DatabaseStatus variant="badge" />
              <span className="text-sm text-muted-foreground">{health.status}</span>
              <span className="text-sm text-muted-foreground">{user.username}</span>
              <Button 
                variant="ghost" 
                size="sm"
                onClick={() => setActivePanel(activePanel === "settings" ? null : "settings")}
                aria-label="Open settings"
              >
                <Settings className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </div>

        {/* Turn Banner */}
        <TurnBanner />

        {/* Main Layout */}
        <div className="flex flex-1 overflow-hidden">
          {/* Icon Sidebar */}
          <IconSidebar 
            activePanel={activePanel} 
            onPanelChange={setActivePanel} 
          />

          {/* Main Content Area */}
          <div className="flex flex-1 overflow-hidden">
            <ResizablePanelGroup direction="horizontal">
              {/* Left Panel - Map or Tool Panel */}
              <ResizablePanel defaultSize={activePanel ? 60 : 70} minSize={40}>
                <div className="flex h-full">
                  {/* Expandable Tool Panel */}
                  {activePanel && (
                    <>
                      <ExpandablePanel 
                        activePanel={activePanel} 
                        onClose={() => setActivePanel(null)} 
                      />
                      <div className="w-px bg-border" />
                    </>
                  )}
                  
                  {/* Map */}
                  <div className="flex-1">
                    <OpenLayersMap />
                  </div>
                </div>
              </ResizablePanel>

              <ResizableHandle withHandle />

              {/* Right Panel - Chat */}
              <ResizablePanel defaultSize={activePanel ? 40 : 30} minSize={25}>
                <ChatPanel />
              </ResizablePanel>
            </ResizablePanelGroup>
          </div>
        </div>
      </div>
    );
  }

  // Fallback to landing page
  return <LandingPage onLogin={handleLogin} />;
}

// Main App component with UserProvider
export default function App() {
  return (
    <ErrorBoundary>
      <DatabaseProvider>
        <UserProvider>
          <GameSessionProvider>
            <GameStateProvider>
              <AppContent />
            </GameStateProvider>
          </GameSessionProvider>
        </UserProvider>
      </DatabaseProvider>
    </ErrorBoundary>
  );
}
