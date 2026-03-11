'use client';

/**
 * Authentication context provider
 * Manages user authentication state and provides auth methods
 */

import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { getCurrentUser, login as apiLogin, microsoftLogin as apiMicrosoftLogin, logout as apiLogout, refreshToken, User } from '../auth-client';

interface AuthContextType {
  user: User | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  microsoftLogin: (code: string) => Promise<void>;
  logout: () => Promise<void>;
  isAdmin: boolean;
  isEditor: boolean;  // true for both editor and admin roles
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
      console.log('[Auth] Setting up auto-refresh (7.5 hours interval)');

      // Clear any existing interval
      if (refreshIntervalRef.current) {
        clearInterval(refreshIntervalRef.current);
      }

      // Set up token refresh interval (7.5 hours - 30 min before 8 hour expiration)
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
      }, 450 * 60 * 1000); // 7.5 hours (450 minutes - 30 min before 8 hour expiration)
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

  const microsoftLogin = async (code: string) => {
    const loggedInUser = await apiMicrosoftLogin(code);
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
      microsoftLogin,
      logout,
      isAdmin: user?.role === 'admin',
      isEditor: user?.role === 'editor' || user?.role === 'admin',  // admin has editor privileges
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
