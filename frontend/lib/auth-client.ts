/**
 * Authentication API client
 * Handles login, logout, and user session management
 */

import { getApiUrl } from './env';
import { translateOutsideReact } from './i18n-messages';

export interface User {
  id: string;
  username: string;
  role: 'admin' | 'editor' | 'viewer';
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
      // NETWORK_ERROR is deliberately silent: "backend not reachable" is the
      // ordinary dev case and ProtectedRoute already shows it on screen.
      if (error.type === AuthErrorType.TIMEOUT) {
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
 * Fetch a short-lived Socket.IO connect token (sweep 27 §P3.4).
 *
 * Same-origin on purpose: the request goes through the frontend's own proxy, so
 * the session cookie rides along — which it never does on the socket itself on
 * a split-origin deployment (Railway staging, kp.fwo.li → kp-api.fwo.li). The
 * token goes into the Socket.IO `auth` payload; the backend connect handler
 * accepts either it or the cookie.
 *
 * Returns null when there is no session (viewer/display pages) or on any
 * error — the socket then connects without a token, exactly as before.
 */
export async function fetchWsToken(): Promise<string | null> {
  try {
    let response = await fetchWithTimeout(`${getApiUrl()}/api/auth/ws-token`, {
      credentials: 'include',
    }, 5000);
    // Upgrade a pre-family session once, without forcing an interactive login.
    if (response.status === 409 && await refreshToken()) {
      response = await fetchWithTimeout(`${getApiUrl()}/api/auth/ws-token`, {
        credentials: 'include',
      }, 5000);
    }
    if (!response.ok) return null;
    const data: unknown = await response.json();
    const token = (data as { token?: unknown }).token;
    return typeof token === 'string' ? token : null;
  } catch {
    return null;
  }
}

/**
 * Microsoft auth configuration from backend
 */
export interface MicrosoftAuthConfig {
  enabled: boolean;
  client_id: string;
  tenant_id: string;
  redirect_uri: string;
}

/**
 * Get Microsoft auth configuration from backend
 * Returns null if not configured or on error
 */
export async function getMicrosoftAuthConfig(): Promise<MicrosoftAuthConfig | null> {
  try {
    const response = await fetchWithTimeout(`${getApiUrl()}/api/auth/microsoft-config`, {
      credentials: 'include',
    }, 5000);

    if (!response.ok) return null;

    const config = await response.json();
    return config.enabled ? config : null;
  } catch {
    return null;
  }
}

/**
 * Login with Microsoft authorization code
 * Exchanges the code with the backend, which handles token exchange with Microsoft
 */
export async function startMicrosoftLogin(): Promise<string> {
  const response = await fetchWithTimeout(`${getApiUrl()}/api/auth/microsoft-start`, {
    method: 'POST',
    credentials: 'include',
  });
  if (!response.ok) {
    throw new AuthError(translateOutsideReact('errors.microsoftLoginFailed'), AuthErrorType.SERVER_ERROR, response.status);
  }
  const data: { authorization_url: string } = await response.json();
  return data.authorization_url;
}

/** Redeem the code together with its one-use browser transaction state. */
export async function microsoftLogin(code: string, state: string): Promise<User> {
  try {
    const response = await fetchWithTimeout(`${getApiUrl()}/api/auth/microsoft-login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, state }),
      credentials: 'include',
    });

    if (!response.ok) {
      let detail = translateOutsideReact('errors.microsoftLoginFailed');
      try {
        const errorData = await response.json();
        detail = errorData.detail || detail;
      } catch { /* not JSON */ }
      throw new AuthError(
        detail,
        response.status === 401 ? AuthErrorType.UNAUTHORIZED : AuthErrorType.SERVER_ERROR,
        response.status
      );
    }

    return await response.json();
  } catch (error) {
    if (error instanceof AuthError) throw error;
    throw new AuthError(
      'Verbindung zum Server fehlgeschlagen',
      AuthErrorType.NETWORK_ERROR
    );
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
