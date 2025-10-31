'use client';

/**
 * Authentication context provider
 * Manages user authentication state and provides auth methods
 */

import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { getCurrentUser, login as apiLogin, logout as apiLogout, refreshToken, User } from '../auth-client';

interface AuthContextType {
  user: User | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  isEditor: boolean;
  isAuthenticated: boolean;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const refreshIntervalRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    // Check authentication status on mount
    getCurrentUser()
      .then(setUser)
      .finally(() => setLoading(false));
  }, []); // Only run once on mount

  useEffect(() => {
    // Set up token refresh interval when user is logged in
    if (user) {
      console.log('[Auth] Setting up auto-refresh (13 minutes interval)');

      // Clear any existing interval
      if (refreshIntervalRef.current) {
        clearInterval(refreshIntervalRef.current);
      }

      // Set up token refresh interval (13 minutes - before 15 min expiration)
      refreshIntervalRef.current = setInterval(async () => {
        console.log('[Auth] Auto-refreshing token...');
        try {
          const refreshedUser = await refreshToken();
          if (refreshedUser) {
            setUser(refreshedUser);
          } else {
            // Refresh failed, user is logged out
            console.log('[Auth] Auto-refresh failed - logging out');
            setUser(null);
          }
        } catch (error) {
          console.error('[Auth] Token refresh error:', error);
          setUser(null);
        }
      }, 13 * 60 * 1000); // 13 minutes (2 min before 15 min expiration)
    } else {
      // User logged out - clear refresh interval
      if (refreshIntervalRef.current) {
        console.log('[Auth] Clearing auto-refresh interval');
        clearInterval(refreshIntervalRef.current);
        refreshIntervalRef.current = null;
      }
    }

    // Cleanup on unmount
    return () => {
      if (refreshIntervalRef.current) {
        clearInterval(refreshIntervalRef.current);
        refreshIntervalRef.current = null;
      }
    };
  }, [user]); // Re-run when user changes (login/logout)

  const login = async (username: string, password: string) => {
    const loggedInUser = await apiLogin(username, password);
    setUser(loggedInUser);
  };

  const logout = async () => {
    await apiLogout();
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{
      user,
      loading,
      login,
      logout,
      isEditor: user?.role === 'editor',
      isAuthenticated: !!user,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
}
