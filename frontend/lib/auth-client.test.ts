import { afterEach, describe, expect, it, vi } from 'vitest';

import { AuthErrorType, fetchWsToken, microsoftLogin, startMicrosoftLogin } from './auth-client';

vi.mock('./env', () => ({ getApiUrl: () => '/backend-api' }));
vi.mock('./i18n-messages', () => ({ translateOutsideReact: () => 'Anmeldung fehlgeschlagen' }));

afterEach(() => vi.unstubAllGlobals());

describe('legacy session upgrade for sockets', () => {
  it('refreshes once and retries when a session needs a family binding', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response('', { status: 409 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ role: 'editor' })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ token: 'family-bound-ws' })));
    vi.stubGlobal('fetch', fetch);
    expect(await fetchWsToken()).toBe('family-bound-ws');
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      '/backend-api/api/auth/ws-token', '/backend-api/api/auth/refresh', '/backend-api/api/auth/ws-token',
    ]);
  });

  it('does not loop when the retry still fails', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response('', { status: 409 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ role: 'editor' })))
      .mockResolvedValueOnce(new Response('', { status: 409 }));
    vi.stubGlobal('fetch', fetch);
    expect(await fetchWsToken()).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(3);
  });
});

describe('Microsoft browser transaction', () => {
  it('starts through the backend so the browser receives its HttpOnly proof', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ authorization_url: 'https://login.microsoftonline.com/authorize?state=one-use' })));
    vi.stubGlobal('fetch', fetch);
    expect(await startMicrosoftLogin()).toContain('state=one-use');
    expect(fetch).toHaveBeenCalledWith('/backend-api/api/auth/microsoft-start', expect.objectContaining({
      method: 'POST', credentials: 'include',
    }));
  });

  it('redeems both callback values with the browser cookie', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ role: 'viewer' })));
    vi.stubGlobal('fetch', fetch);
    await microsoftLogin('authorization-code', 'transaction-state');
    expect(fetch).toHaveBeenCalledWith('/backend-api/api/auth/microsoft-login', expect.objectContaining({
      method: 'POST', credentials: 'include',
      body: JSON.stringify({ code: 'authorization-code', state: 'transaction-state' }),
    }));
  });
});


it.each([
  'not JSON',
  JSON.stringify({}),
  JSON.stringify({ authorization_url: 7 }),
  JSON.stringify({ authorization_url: 'javascript:alert(1)' }),
  JSON.stringify({ authorization_url: 'https://other.example/authorize' }),
])('normalizes an invalid Microsoft start response without returning a redirect', async (body) => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body)));
  await expect(startMicrosoftLogin()).rejects.toMatchObject({
    name: 'AuthError', type: AuthErrorType.SERVER_ERROR, statusCode: 200,
  });
});
