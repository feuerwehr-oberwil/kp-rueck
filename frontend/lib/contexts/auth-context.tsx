'use client';

/**
 * Authentication context provider
 * Manages user authentication state and provides auth methods
 */

import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { translateOutsideReact } from '../i18n-messages';
import { getCurrentUser, login as apiLogin, microsoftLogin as apiMicrosoftLogin, logout as apiLogout, refreshToken, User } from '../auth-client';

interface AuthContextType {
  user: User | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<User>;
  microsoftLogin: (code: string) => Promise<void>;
  logout: () => Promise<void>;
  isAdmin: boolean;
  isEditor: boolean;  // true for both editor and admin roles
  isViewer: boolean;  // read-only viewer role
  isAuthenticated: boolean;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const refreshIntervalRef = useRef<NodeJS.Timeout | null>(null);
  // Mirror of `user` for the session-expired listener (registered once).
  const userRef = useRef<User | null>(null);
  userRef.current = user;

  useEffect(() => {
    // Check authentication status on mount
    getCurrentUser()
      .then(setUser)
      .finally(() => setLoading(false));
  }, []); // Only run once on mount

  useEffect(() => {
    // The api-client fires this when any request comes back 401 — the cookie
    // session expired underneath us (e.g. laptop asleep past token expiry).
    // Without it, every mutation fails silently and optimistic UI reverts
    // with no explanation until the user happens to reload.
    const handleSessionExpired = () => {
      if (!userRef.current) return; // already logged out / public token page
      userRef.current = null;
      setUser(null);
      toast.error(translateOutsideReact('notifications.auth.sessionExpiredTitle'), {
        description: translateOutsideReact('notifications.auth.sessionExpiredDescription'),
      });
    };
    window.addEventListener('kp:session-expired', handleSessionExpired);
    return () => window.removeEventListener('kp:session-expired', handleSessionExpired);
  }, []);

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
    return loggedInUser;
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
      isViewer: user?.role === 'viewer',
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
