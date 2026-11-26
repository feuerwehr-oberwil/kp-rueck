/**
 * Authentication API client
 * Handles login, logout, and user session management
 */

import { getApiUrl } from './env';
import type { ApiUser } from './api/types';
import type { Out } from './api/wire';
import { detailOf } from './api/error-codes';
import { isRecord } from './utils/safe-storage';
import { translateOutsideReact } from './i18n-messages';

/** The signed-in account, as every auth route answers it (backend `User`). */
export type User = ApiUser;

/** The answer of an auth route that signs somebody in: a `User`, or a contract error. */
async function readUser(response: Response): Promise<User> {
  const body: unknown = await response.json();
  // The transport does not validate bodies (`lib/api/http.ts`); an account without an id
  // and a username is not one this board can sign in.
  if (!isRecord(body) || typeof body.id !== 'string' || typeof body.username !== 'string') {
    throw new AuthError('Ungültige Antwort des Servers', AuthErrorType.SERVER_ERROR, response.status);
  }
  return body as User;
}

/** A refusal's German `detail`, or `fallback` when the body says nothing usable. */
async function refusalDetail(response: Response, fallback: string): Promise<string> {
  try {
    const body: unknown = await response.json();
    return detailOf(body) ?? fallback;
  } catch {
    return fallback;
  }
}

/**
 * Auth error types for better error handling
 */
export enum AuthErrorType {
  UNAUTHORIZED = 'UNAUTHORIZED',
  NETWORK_ERROR = 'NETWORK_ERROR',
  TIMEOUT = 'TIMEOUT',
  SERVER_ERROR = 'SERVER_ERROR',
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
      throw new AuthError(
        await refusalDetail(response, 'Login fehlgeschlagen'),
        response.status === 401 ? AuthErrorType.UNAUTHORIZED : AuthErrorType.SERVER_ERROR,
        response.status
      );
    }

    return await readUser(response);
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
 * One silent attempt at the station machine's passwordless local login.
 *
 * The board runs on a notebook that stands in the command post; whoever is on duty opens a
 * shortcut and has to be on the board, not at a password prompt. Only Caddy's loopback-only
 * listener on that same machine stamps the shared secret this needs onto the request
 * (`deploy/Caddyfile`, `backend/app/auth/local_autologin.py`), so from a LAN or VPN client
 * the backend answers 403 — and on a deployment that never configured it, 404.
 *
 * Nothing is sent from here: the proof is a header the browser never sees and cannot forge.
 * `null` for every answer but success, which means «show the ordinary login form».
 *
 * Called exactly once per page load, from AuthProvider. Deliberately NOT retried: a signed-in
 * operator who signs out must get the form, not be signed back in before they let go of the
 * mouse. Reloading the page is what asks again.
 */
export async function localLogin(): Promise<User | null> {
  try {
    const response = await fetchWithTimeout(`${getApiUrl()}/api/auth/local-login`, {
      method: 'POST',
      credentials: 'include',
    }, 5000);

    // 404 = not configured, 403 = not this machine. Both are the normal answer almost
    // everywhere, so neither is logged.
    if (!response.ok) return null;

    return await readUser(response);
  } catch {
    // Network error/timeout: ProtectedRoute's own backend probe reports that on screen.
    return null;
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

    return await readUser(response);
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
    return isRecord(data) && typeof data.token === 'string' ? data.token : null;
  } catch {
    return null;
  }
}

/** Microsoft auth configuration from the backend (`MicrosoftAuthConfig`). */
export type MicrosoftAuthConfig = Out<'MicrosoftAuthConfig'>;

function isEnabledMicrosoftConfig(value: unknown): value is MicrosoftAuthConfig {
  return isRecord(value) && value.enabled === true && typeof value.client_id === 'string'
    && typeof value.tenant_id === 'string' && typeof value.redirect_uri === 'string';
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

    const config: unknown = await response.json();
    return isEnabledMicrosoftConfig(config) ? config : null;
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
  try {
    const data: unknown = await response.json();
    if (!data || typeof data !== 'object' || !('authorization_url' in data)
      || typeof data.authorization_url !== 'string') throw new Error('Invalid login response');
    const url = new URL(data.authorization_url);
    if (url.protocol !== 'https:' || url.hostname !== 'login.microsoftonline.com'
      || url.username || url.password) throw new Error('Invalid Microsoft authorization URL');
    return url.href;
  } catch {
    throw new AuthError(translateOutsideReact('errors.microsoftLoginFailed'), AuthErrorType.SERVER_ERROR, response.status);
  }
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
      throw new AuthError(
        await refusalDetail(response, translateOutsideReact('errors.microsoftLoginFailed')),
        response.status === 401 ? AuthErrorType.UNAUTHORIZED : AuthErrorType.SERVER_ERROR,
        response.status
      );
    }

    return await readUser(response);
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

    return await readUser(response);
  } catch {
    // Token refresh failed - user will need to log in again
    return null;
  }
}
