import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/env', () => ({
  getApiUrl: () => 'http://test-backend',
}))

vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn(), dismiss: vi.fn() }),
}))

import { apiClient } from '@/lib/api-client'
import { ApiError } from './types'
import { errorCodeOf, messageForErrorCode } from './error-codes'

const setLocale = (locale: string) => {
  document.cookie = `NEXT_LOCALE=${locale}; path=/`
}

afterEach(() => {
  document.cookie = 'NEXT_LOCALE=; path=/; max-age=0'
  vi.unstubAllGlobals()
})

describe('messageForErrorCode', () => {
  const body = { detail: 'Bitte den Code neu eingeben.', code: 'feld_code_reenter' }

  it('says a known code in the device language', () => {
    expect(messageForErrorCode(body)).toBe('Bitte den Code neu eingeben.')
    setLocale('fr')
    expect(messageForErrorCode(body)).toBe('Saisis à nouveau le code.')
  })

  it('fills the numbers a sentence needs from `params`', () => {
    setLocale('fr')
    expect(messageForErrorCode({ detail: 'File too large…', code: 'photo_too_large', params: { max_mb: 10 } })).toBe(
      'Fichier trop volumineux – 10 Mo au maximum.',
    )
  })

  it('knows nothing about a code from a newer backend, a plain detail or junk — the caller keeps `detail`', () => {
    expect(messageForErrorCode({ detail: 'Neu', code: 'feld_from_the_future' })).toBeNull()
    expect(messageForErrorCode({ detail: 'Einsatz nicht gefunden' })).toBeNull()
    expect(messageForErrorCode({ code: 'errors.api.title' })).toBeNull()
    expect(messageForErrorCode(null)).toBeNull()
    expect(errorCodeOf({ code: 'x' })).toBe('x')
  })

  it('Italian (an empty overlay) gets the German sentence, not a key path', () => {
    setLocale('it')
    expect(messageForErrorCode(body)).toBe('Bitte den Code neu eingeben.')
  })
})

describe('a /feld request that fails with a code', () => {
  const answer = (body: object, status: number) =>
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }),
      ),
    )

  it('rejects with the sentence in the crew’s language and the code on the ApiError', async () => {
    setLocale('fr')
    answer({ detail: 'Diese Einsatzstelle ist dir nicht zugeteilt.', code: 'feld_incident_not_assigned' }, 403)

    const error = await apiClient.feldReportArrived('incident', 'person', 'token').catch((e: unknown) => e)

    expect(error).toBeInstanceOf(ApiError)
    expect((error as ApiError).message).toBe('Ce lieu d’intervention ne t’est pas attribué.')
    expect((error as ApiError).code).toBe('feld_incident_not_assigned')
    expect((error as ApiError).status).toBe(403)
  })

  it('keeps the German detail when the code is unknown to this build', async () => {
    setLocale('fr')
    answer({ detail: 'Etwas Neues ging schief.', code: 'feld_from_the_future' }, 403)

    const error = await apiClient.feldReportArrived('incident', 'person', 'token').catch((e: unknown) => e)

    expect((error as ApiError).message).toBe('Etwas Neues ging schief.')
  })
})
