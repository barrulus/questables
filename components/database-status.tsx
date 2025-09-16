import { useState } from 'react';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { 
  Database, 
  Wifi, 
  WifiOff, 
  AlertTriangle, 
  CheckCircle,
  Clock,
  Loader2
} from 'lucide-react';
import { useDatabaseHealth } from '../utils/database-health';

interface DatabaseStatusProps {
  variant?: 'badge' | 'card' | 'indicator';
  showDetails?: boolean;
}

export function DatabaseStatus({ variant = 'badge', showDetails = false }: DatabaseStatusProps) {
  const health = useDatabaseHealth();
  const [showDetailsView, setShowDetailsView] = useState(showDetails);

  const getStatusColor = () => {
    switch (health.status) {
      case 'connected': return 'bg-green-500';
      case 'connecting': return 'bg-yellow-500';
      case 'disconnected': return 'bg-gray-500';
      case 'error': return 'bg-red-500';
      default: return 'bg-gray-500';
    }
  };

  const getStatusIcon = () => {
    switch (health.status) {
      case 'connected': return <CheckCircle className="w-4 h-4" />;
      case 'connecting': return <Loader2 className="w-4 h-4 animate-spin" />;
      case 'disconnected': return <WifiOff className="w-4 h-4" />;
      case 'error': return <AlertTriangle className="w-4 h-4" />;
      default: return <Database className="w-4 h-4" />;
    }
  };

  const getStatusText = () => {
    switch (health.status) {
      case 'connected': return 'Connected';
      case 'connecting': return 'Connecting...';
      case 'disconnected': return 'Disconnected';
      case 'error': return 'Error';
      default: return 'Unknown';
    }
  };

  const getBadgeVariant = () => {
    switch (health.status) {
      case 'connected': return 'default' as const;
      case 'connecting': return 'secondary' as const;
      case 'disconnected': return 'outline' as const;
      case 'error': return 'destructive' as const;
      default: return 'outline' as const;
    }
  };

  if (variant === 'indicator') {
    return (
      <div className="flex items-center gap-2">
        <div className={`w-2 h-2 rounded-full ${getStatusColor()}`} />
        <span className="text-xs text-muted-foreground">Database</span>
      </div>
    );
  }

  if (variant === 'badge') {
    return (
      <Badge 
        variant={getBadgeVariant()}
        className="cursor-pointer flex items-center gap-1"
        onClick={() => setShowDetailsView(!showDetailsView)}
      >
        {getStatusIcon()}
        {getStatusText()}
        {health.latency && health.status === 'connected' && (
          <span className="text-xs opacity-75">({health.latency}ms)</span>
        )}
      </Badge>
    );
  }

  if (variant === 'card') {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Database className="w-5 h-5" />
            Database Status
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">Connection</span>
            <div className="flex items-center gap-2">
              {getStatusIcon()}
              <span className="text-sm">{getStatusText()}</span>
            </div>
          </div>
          
          {health.latency && health.status === 'connected' && (
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Latency</span>
              <span className="text-sm text-muted-foreground">{health.latency}ms</span>
            </div>
          )}
          
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">Last Check</span>
            <span className="text-sm text-muted-foreground">
              {health.lastCheck.toLocaleTimeString()}
            </span>
          </div>
          
          {health.error && (
            <div className="p-2 bg-red-50 border border-red-200 rounded">
              <p className="text-sm text-red-800 font-medium">Error</p>
              <p className="text-xs text-red-600">{health.error}</p>
            </div>
          )}
        </CardContent>
      </Card>
    );
  }

  return null;
}

// Connection status context for graceful degradation
import { createContext, useContext, ReactNode } from 'react';

interface DatabaseContextType {
  health: ReturnType<typeof useDatabaseHealth>;
  isOfflineMode: boolean;
}

const DatabaseContext = createContext<DatabaseContextType | null>(null);

interface DatabaseProviderProps {
  children: ReactNode;
}

export function DatabaseProvider({ children }: DatabaseProviderProps) {
  const health = useDatabaseHealth();
  const isOfflineMode = !health.isConnected;

  return (
    <DatabaseContext.Provider value={{ health, isOfflineMode }}>
      {children}
    </DatabaseContext.Provider>
  );
}

export function useDatabaseContext() {
  const context = useContext(DatabaseContext);
  if (!context) {
    throw new Error('useDatabaseContext must be used within a DatabaseProvider');
  }
  return context;
}

// Offline mode wrapper component
interface OfflineModeWrapperProps {
  children: ReactNode;
  fallback?: ReactNode;
}

export function OfflineModeWrapper({ children, fallback }: OfflineModeWrapperProps) {
  const { isOfflineMode } = useDatabaseContext();

  if (isOfflineMode && fallback) {
    return <>{fallback}</>;
  }

  if (isOfflineMode) {
    return (
      <Card>
        <CardContent className="p-6 text-center">
          <WifiOff className="w-8 h-8 mx-auto mb-4 text-muted-foreground" />
          <h3 className="font-medium mb-2">Offline Mode</h3>
          <p className="text-sm text-muted-foreground">
            This feature requires a database connection. Please check your connection and try again.
          </p>
        </CardContent>
      </Card>
    );
  }

  return <>{children}</>;
}