import { afterEach, describe, expect, it, vi } from 'vitest';

import { AuthErrorType, fetchWsToken, localLogin, microsoftLogin, startMicrosoftLogin } from './auth-client';

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


describe('passwordless local login', () => {
  it('asks the backend once, with cookies, and nothing in the body', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ username: 'station-notebook', role: 'editor' })));
    vi.stubGlobal('fetch', fetch);

    expect(await localLogin()).toMatchObject({ username: 'station-notebook', role: 'editor' });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith('/backend-api/api/auth/local-login', expect.objectContaining({
      method: 'POST', credentials: 'include',
    }));
    // The proof is a header Caddy attaches on the loopback listener; the browser must not
    // send anything it could have been tricked into sending.
    expect(fetch.mock.calls[0][1]).not.toHaveProperty('body');
  });

  // 404 = the deployment never configured it, 403 = this is not the station machine (the
  // public site stripped the header). Both mean «show the ordinary login form».
  it.each([404, 403, 500])('answers null on %i so the login form is shown', async (status) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status })));
    expect(await localLogin()).toBeNull();
  });

  it('answers null when the backend cannot be reached', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    expect(await localLogin()).toBeNull();
  });
});
