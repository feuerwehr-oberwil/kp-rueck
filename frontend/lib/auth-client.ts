/**
 * Authentication API client
 * Handles login, logout, and user session management
 */

import { getApiUrl } from './env';

export interface User {
  id: string;
  username: string;
  role: 'admin' | 'editor';
  display_name: string;
  is_active: boolean;
  created_at: string;
  last_login: string | null;
}

/**
 * Auth error types for better error handling
 */
export enum AuthErrorType {
  UNAUTHORIZED = 'UNAUTHORIZED',
  NETWORK_ERROR = 'NETWORK_ERROR',
  TIMEOUT = 'TIMEOUT',
  SERVER_ERROR = 'SERVER_ERROR',
  UNKNOWN = 'UNKNOWN',
}

export class AuthError extends Error {
  constructor(
    message: string,
    public type: AuthErrorType,
    public statusCode?: number
  ) {
    super(message);
    this.name = 'AuthError';
  }
}

/**
 * Fetch with timeout support
 */
async function fetchWithTimeout(
  url: string,
  options?: RequestInit,
  timeoutMs: number = 10000
): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    clearTimeout(id);
    return response;
  } catch (error) {
    clearTimeout(id);
    if ((error as Error).name === 'AbortError') {
      throw new AuthError(
        'Anfrage hat zu lange gedauert (Timeout)',
        AuthErrorType.TIMEOUT
      );
    }
    // Wrap network errors in AuthError for consistent handling
    throw new AuthError(
      'Verbindung zum Server fehlgeschlagen',
      AuthErrorType.NETWORK_ERROR
    );
  }
}

/**
 * Check if backend is available
 */
export async function checkBackendHealth(): Promise<boolean> {
  try {
    const response = await fetchWithTimeout(`${getApiUrl()}/health`, {}, 5000);
    return response.ok;
  } catch {
    // Silently fail - this is expected when backend is unavailable
    return false;
  }
}

/**
 * Login with username and password
 * Sets httpOnly cookies with access/refresh tokens
 */
export async function login(username: string, password: string): Promise<User> {
  const formData = new FormData();
  formData.append('username', username);
  formData.append('password', password);

  try {
    const response = await fetchWithTimeout(`${getApiUrl()}/api/auth/login`, {
      method: 'POST',
      body: formData,
      credentials: 'include',  // Send/receive cookies
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ detail: 'Login fehlgeschlagen' }));
      throw new AuthError(
        errorData.detail || 'Login fehlgeschlagen',
        response.status === 401 ? AuthErrorType.UNAUTHORIZED : AuthErrorType.SERVER_ERROR,
        response.status
      );
    }

    const user = await response.json();
    return user;
  } catch (error) {
    if (error instanceof AuthError) {
      throw error;
    }
    console.error('[Auth] Login error:', error);
    throw new AuthError(
      'Verbindung zum Server fehlgeschlagen',
      AuthErrorType.NETWORK_ERROR
    );
  }
}

/**
 * Get current authenticated user
 * Returns null if not authenticated or on network error
 *
 * Error handling:
 * - 401 Unauthorized: Not logged in → returns null
 * - Network error: Backend unavailable → returns null (logs error)
 * - Timeout: Request took too long → returns null (logs error)
 */
export async function getCurrentUser(): Promise<User | null> {
  try {
    const response = await fetchWithTimeout(`${getApiUrl()}/api/auth/me`, {
      credentials: 'include',
    }, 10000);

    if (!response.ok) {
      if (response.status === 401) {
        // Not authenticated - this is expected, don't log
        return null;
      }
      // Server error - log for debugging
      console.error(`[Auth] getCurrentUser failed with status ${response.status}`);
      return null;
    }

    const user = await response.json();
    return user;
  } catch (error) {
    // Silently handle expected network errors during development
    // (backend not running, network unavailable, etc.)
    if (error instanceof AuthError) {
      if (error.type === AuthErrorType.NETWORK_ERROR) {
        // Don't spam console for network errors - common during dev
        console.debug('[Auth] Backend not reachable');
      } else if (error.type === AuthErrorType.TIMEOUT) {
        console.warn('[Auth] Request timeout - backend may be slow');
      }
    } else {
      // Only log unexpected errors
      console.error('[Auth] Unexpected error:', error);
    }
    return null;
  }
}

/**
 * Logout and clear authentication cookies
 */
export async function logout(): Promise<void> {
  try {
    await fetchWithTimeout(`${getApiUrl()}/api/auth/logout`, {
      method: 'POST',
      credentials: 'include',
    }, 5000);
  } catch {
    // Logout failed, but we'll clear local state anyway - no need to log
  }
}

/**
 * Refresh access token using refresh token
 * Called automatically when access token expires
 *
 * Returns null if refresh fails (user needs to log in again)
 */
export async function refreshToken(): Promise<User | null> {
  try {
    const response = await fetchWithTimeout(`${getApiUrl()}/api/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
    }, 10000);

    if (!response.ok) {
      return null;
    }

    const user = await response.json();
    return user;
  } catch {
    // Token refresh failed - user will need to log in again
    return null;
  }
}
