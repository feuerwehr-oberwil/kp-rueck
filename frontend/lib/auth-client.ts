/**
 * Authentication API client
 * Handles login, logout, and user session management
 */

import { API_URL } from './env';

export interface User {
  id: string;
  username: string;
  role: 'editor' | 'viewer';
  created_at: string;
  last_login: string | null;
}

/**
 * Login with username and password
 * Sets httpOnly cookies with access/refresh tokens
 */
export async function login(username: string, password: string): Promise<User> {
  const formData = new FormData();
  formData.append('username', username);
  formData.append('password', password);

  const response = await fetch(`${API_URL}/api/auth/login`, {
    method: 'POST',
    body: formData,
    credentials: 'include',  // Send/receive cookies
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({ detail: 'Login failed' }));
    throw new Error(errorData.detail || 'Login failed');
  }

  return response.json();
}

/**
 * Get current authenticated user
 * Returns null if not authenticated
 */
export async function getCurrentUser(): Promise<User | null> {
  try {
    const response = await fetch(`${API_URL}/api/auth/me`, {
      credentials: 'include',
    });

    if (!response.ok) return null;
    return response.json();
  } catch {
    return null;
  }
}

/**
 * Logout and clear authentication cookies
 */
export async function logout(): Promise<void> {
  await fetch(`${API_URL}/api/auth/logout`, {
    method: 'POST',
    credentials: 'include',
  });
}

/**
 * Refresh access token using refresh token
 * Called automatically when access token expires
 */
export async function refreshToken(): Promise<User | null> {
  try {
    const response = await fetch(`${API_URL}/api/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
    });

    if (!response.ok) return null;
    return response.json();
  } catch {
    return null;
  }
}
