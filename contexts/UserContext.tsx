import React, { createContext, useContext, useState, useEffect, ReactNode, useCallback } from 'react';
import { User } from '../utils/database/data-structures';
import { userHelpers } from '../utils/database/production-helpers';
import { databaseClient } from '../utils/database/client';
import { AUTH_LOGOUT_EVENT } from '../utils/api-client';

const USER_STORAGE_KEY = 'dnd-user';
const TOKEN_STORAGE_KEY = 'dnd-auth-token';
const ALLOWED_ROLES = ['player', 'dm', 'admin'] as const;
const ROLE_PRIORITY: AllowedRole[] = ['admin', 'dm', 'player'];
type AllowedRole = typeof ALLOWED_ROLES[number];

type RawUser = Partial<User> & {
  roles?: unknown;
  role?: unknown;
};

const normalizeUser = (rawUser: RawUser): User => {
  if (!rawUser) {
    throw new Error('Invalid user payload');
  }

  const collected = new Set<AllowedRole>();

  const registerRole = (value: unknown) => {
    if (!value) {
      return;
    }

    if (Array.isArray(value)) {
      value.forEach(registerRole);
      return;
    }

    if (typeof value === 'string') {
      const normalized = value.toLowerCase();
      if (ALLOWED_ROLES.includes(normalized as AllowedRole)) {
        collected.add(normalized as AllowedRole);
      }
    }
  };

  registerRole(rawUser.roles);
  registerRole(rawUser.role);
  collected.add('player');

  const normalizedRoles = ROLE_PRIORITY.filter((role) => collected.has(role));
  const roles = normalizedRoles.length > 0 ? normalizedRoles : ['player'];
  const primaryRole = roles.find((role) => role !== 'player') ?? 'player';

  return {
    ...rawUser,
    roles,
    role: primaryRole,
  } as User;
};

interface UserContextType {
  user: User | null;
  authToken: string | null;
  login: (email: string, password?: string) => Promise<User>;
  logout: () => void;
  loading: boolean;
  error: string | null;
  updateProfile: (updates: Partial<User>) => Promise<void>;
}

const UserContext = createContext<UserContextType | undefined>(undefined);

export function useUser() {
  const context = useContext(UserContext);
  if (context === undefined) {
    throw new Error('useUser must be used within a UserProvider');
  }
  return context;
}

interface UserProviderProps {
  children: ReactNode;
}

export function UserProvider({ children }: UserProviderProps) {
  const [user, setUser] = useState<User | null>(null);
  const [authToken, setAuthToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Initialize user from localStorage on app startup
  useEffect(() => {
    initializeUser();
  }, []);

  const initializeUser = async () => {
    try {
      if (typeof window === 'undefined') {
        return;
      }
      setLoading(true);
      setError(null);
      
      // Check localStorage for stored user session
      const storedUser = localStorage.getItem(USER_STORAGE_KEY);
      const storedToken = localStorage.getItem(TOKEN_STORAGE_KEY);

      if (storedUser && storedToken) {
        const userData = JSON.parse(storedUser);
        
        // Validate user session with database
        const currentUser = await userHelpers.getCurrentUser(userData.id);
        if (currentUser) {
          const normalizedUser = normalizeUser(currentUser);
          setUser(normalizedUser);
          setAuthToken(storedToken);
          // Update localStorage with fresh data
          localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(normalizedUser));
        } else {
          // Invalid session, clear storage
          localStorage.removeItem(USER_STORAGE_KEY);
          localStorage.removeItem(TOKEN_STORAGE_KEY);
          setError('Session expired. Please sign in again.');
        }
      } else if (typeof window !== 'undefined') {
        localStorage.removeItem(USER_STORAGE_KEY);
        localStorage.removeItem(TOKEN_STORAGE_KEY);
      }
    } catch (error) {
      console.error('Error initializing user:', error);
      setError('Unable to validate user session. Please sign in again.');
      localStorage.removeItem(USER_STORAGE_KEY);
      localStorage.removeItem(TOKEN_STORAGE_KEY);
    } finally {
      setLoading(false);
    }
  };

  const login = async (email: string, password?: string): Promise<User> => {
    try {
      setLoading(true);
      setError(null);

      // Call authentication endpoint
      const { data, error: authError } = await databaseClient.auth.login(email, password);
      if (authError) {
        throw new Error(authError.message || 'Login failed');
      }
      
      if (!data?.user || !data.token) {
        throw new Error('Invalid login credentials');
      }

      const loggedInUser = normalizeUser(data.user);
      setUser(loggedInUser);
      setAuthToken(data.token);
      
      // Store user in localStorage for session persistence
      if (typeof window !== 'undefined') {
        localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(loggedInUser));
        localStorage.setItem(TOKEN_STORAGE_KEY, data.token);
      }
      
      return loggedInUser;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Login failed';
      setError(errorMessage);
      throw error;
    } finally {
      setLoading(false);
    }
  };

  const logout = useCallback(() => {
    setUser(null);
    setAuthToken(null);
    setError(null);
    if (typeof window !== 'undefined') {
      localStorage.removeItem(USER_STORAGE_KEY);
      localStorage.removeItem(TOKEN_STORAGE_KEY);
      localStorage.removeItem('dnd-active-campaign');
    }
  }, [setAuthToken, setError, setUser]);

  const updateProfile = useCallback(async (updates: Partial<User>): Promise<void> => {
    if (!user) {
      throw new Error('No user logged in');
    }

    try {
      setLoading(true);
      setError(null);

      const updatedUser = await userHelpers.updateUserProfile(user.id, updates);
      if (updatedUser) {
        const normalizedUser = normalizeUser(updatedUser);
        setUser(normalizedUser);
        if (typeof window !== 'undefined') {
          localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(normalizedUser));
        }
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Profile update failed';
      setError(errorMessage);
      throw error;
    } finally {
      setLoading(false);
    }
  }, [setError, setLoading, setUser, user]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined;
    }

    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ message?: string }>).detail;
      const message = detail?.message ?? 'Session expired. Please sign in again.';
      logout();
      setError(message);
    };

    window.addEventListener(AUTH_LOGOUT_EVENT, handler as EventListener);
    return () => window.removeEventListener(AUTH_LOGOUT_EVENT, handler as EventListener);
  }, [logout, setError]);

  const value: UserContextType = {
    user,
    authToken,
    login,
    logout,
    loading,
    error,
    updateProfile,
  };

  return (
    <UserContext.Provider value={value}>
      {children}
    </UserContext.Provider>
  );
}

export default UserContext;
