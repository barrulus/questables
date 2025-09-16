import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { User } from '../utils/database/data-structures';
import { userHelpers } from '../utils/database/production-helpers';
import { databaseClient } from '../utils/database/client';

interface UserContextType {
  user: User | null;
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Initialize user from localStorage on app startup
  useEffect(() => {
    initializeUser();
  }, []);

  const initializeUser = async () => {
    try {
      setLoading(true);
      setError(null);
      
      // Check localStorage for stored user session
      const storedUser = localStorage.getItem('dnd-user');
      if (storedUser) {
        const userData = JSON.parse(storedUser);
        
        // Validate user session with database
        const currentUser = await userHelpers.getCurrentUser(userData.id);
        if (currentUser) {
          setUser(currentUser);
          // Update localStorage with fresh data
          localStorage.setItem('dnd-user', JSON.stringify(currentUser));
        } else {
          // Invalid session, clear storage
          localStorage.removeItem('dnd-user');
        }
      }
    } catch (error) {
      console.error('Error initializing user:', error);
      setError('Failed to initialize user session');
      localStorage.removeItem('dnd-user');
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
      
      if (!data?.user) {
        throw new Error('Invalid login credentials');
      }

      const loggedInUser = data.user;
      setUser(loggedInUser);
      
      // Store user in localStorage for session persistence
      localStorage.setItem('dnd-user', JSON.stringify(loggedInUser));
      
      return loggedInUser;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Login failed';
      setError(errorMessage);
      throw error;
    } finally {
      setLoading(false);
    }
  };

  const logout = () => {
    setUser(null);
    setError(null);
    localStorage.removeItem('dnd-user');
    localStorage.removeItem('dnd-active-campaign');
  };

  const updateProfile = async (updates: Partial<User>): Promise<void> => {
    if (!user) {
      throw new Error('No user logged in');
    }

    try {
      setLoading(true);
      setError(null);

      const updatedUser = await userHelpers.updateUserProfile(user.id, updates);
      if (updatedUser) {
        setUser(updatedUser);
        localStorage.setItem('dnd-user', JSON.stringify(updatedUser));
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Profile update failed';
      setError(errorMessage);
      throw error;
    } finally {
      setLoading(false);
    }
  };

  const value: UserContextType = {
    user,
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