'use client';

/**
 * Authentication context provider
 * Manages user authentication state and provides auth methods
 */

import { createContext, useContext, useEffect, useState } from 'react';
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

  useEffect(() => {
    // Check authentication status on mount
    getCurrentUser()
      .then(setUser)
      .finally(() => setLoading(false));

    // Set up token refresh interval (110 minutes - before 120 min expiration)
    // Only runs once on mount, checks user state inside the callback
    const refreshInterval = setInterval(async () => {
      try {
        const refreshedUser = await refreshToken();
        if (refreshedUser) {
          setUser(refreshedUser);
        } else {
          // Refresh failed, user is logged out
          setUser(null);
        }
      } catch (error) {
        console.error('Token refresh failed:', error);
      }
    }, 110 * 60 * 1000); // 110 minutes (10 min before 2h expiration)

    return () => clearInterval(refreshInterval);
  }, []); // Empty dependency array - only run once on mount

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
