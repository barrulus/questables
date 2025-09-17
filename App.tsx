import { useEffect, useState } from "react";
import { LandingPage } from "./components/landing-page";
import { PlayerDashboard } from "./components/player-dashboard";
import { DMDashboard } from "./components/dm-dashboard";
import { AdminDashboard } from "./components/admin-dashboard";
import { IconSidebar } from "./components/icon-sidebar";
import { ExpandablePanel } from "./components/expandable-panel";
import { EnhancedOpenLayersMap } from "./components/enhanced-openlayers-map";
import { ChatPanel } from "./components/chat-panel";
import { Resizable, ResizableHandle, ResizablePanel, ResizablePanelGroup } from "./components/ui/resizable";
import { Badge } from "./components/ui/badge";
import { Button } from "./components/ui/button";
import { Settings, Menu } from "lucide-react";
import { UserProvider, useUser } from "./contexts/UserContext";
import { ErrorBoundary } from "./components/error-boundary";
import { DatabaseProvider, DatabaseStatus } from "./components/database-status";

type AppState = "landing" | "dashboard" | "game";

function AppContent() {
  const { user, logout, loading } = useUser();
  const [appState, setAppState] = useState<AppState>("landing");
  const [activePanel, setActivePanel] = useState<string | null>(null);

  useEffect(() => {
    if (user && appState === "landing") {
      setAppState("dashboard");
    }

    if (!user && appState !== "landing") {
      setAppState("landing");
      setActivePanel(null);
    }
  }, [user, appState]);

  const handleLogin = () => {
    setAppState("dashboard");
  };

  const handleLogout = () => {
    logout();
    setAppState("landing");
    setActivePanel(null);
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
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4"></div>
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
    switch (user.role) {
      case "player":
        return (
          <PlayerDashboard 
            user={user} 
            onEnterGame={handleEnterGame}
            onLogout={handleLogout}
          />
        );
      case "dm":
        return (
          <DMDashboard 
            user={user} 
            onEnterGame={handleEnterGame}
            onLogout={handleLogout}
          />
        );
      case "admin":
        return (
          <AdminDashboard 
            user={user} 
            onEnterGame={handleEnterGame}
            onLogout={handleLogout}
          />
        );
      default:
        return (
          <PlayerDashboard 
            user={user} 
            onEnterGame={handleEnterGame}
            onLogout={handleLogout}
          />
        );
    }
  }

  // Game view (the original D&D interface)
  if (appState === "game" && user) {
    return (
      <div className="min-h-screen bg-background flex flex-col">
        {/* Header */}
        <div className="border-b bg-card">
          <div className="flex items-center justify-between px-4 py-3">
            <div className="flex items-center gap-4">
              <Button variant="ghost" size="sm" onClick={handleExitGame}>
                <Menu className="w-4 h-4" />
              </Button>
              <div>
                <h1 className="font-bold">D&D Campaign</h1>
                <p className="text-sm text-muted-foreground">The Fellowship of the Ring</p>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <Badge variant="outline">Session 12</Badge>
              <Badge variant="secondary">Level 8</Badge>
              <DatabaseStatus variant="badge" />
              <div className="w-3 h-3 bg-green-500 rounded-full" title="Online" />
              <span className="text-sm text-muted-foreground">{user.username}</span>
              <Button 
                variant="ghost" 
                size="sm"
                onClick={() => setActivePanel(activePanel === "settings" ? null : "settings")}
              >
                <Settings className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </div>

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
                    <EnhancedOpenLayersMap />
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
          <AppContent />
        </UserProvider>
      </DatabaseProvider>
    </ErrorBoundary>
  );
}
