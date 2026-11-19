import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { act, fireEvent, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { renderWithIntl } from '@/test-utils/render-with-intl'

import { topLoading } from '@/components/ui/top-loading-bar'

import { rememberStationName } from '@/lib/station-name'

import { BOOT_STUCK_MS, BootScreen } from './boot-screen'

const location = { reload: vi.fn(), assign: vi.fn() }

beforeEach(() => {
  vi.useFakeTimers()
  location.reload.mockReset()
  location.assign.mockReset()
  vi.stubGlobal('location', location)
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('BootScreen', () => {
  it('shows the snail, the wordmark and the phase — and no percentage', () => {
    const { container } = renderWithIntl(<BootScreen phase="Anmeldung wird vorbereitet …" />)
    const status = screen.getByRole('status')
    expect(status).toHaveTextContent('KP Rück')
    expect(status).toHaveTextContent('Anmeldung wird vorbereitet …')
    expect(container.querySelector('.snail-loader svg')).not.toBeNull()
    // The old screen showed a progress bar that crept up at random to 85 %.
    expect(screen.queryByRole('progressbar')).toBeNull()
    expect(screen.queryByText(/\d\s*%/)).toBeNull()
    act(() => vi.advanceTimersByTime(5_000))
    expect(screen.queryByRole('progressbar')).toBeNull()
    expect(screen.queryByText(/\d\s*%/)).toBeNull()
  })

  // Which app AND which station (XAPP-15 B) – once this device has loaded a board.
  it('names the station under the wordmark when this device knows it', () => {
    rememberStationName('Feuerwehr Oberwil')
    try {
      renderWithIntl(<BootScreen phase="Anmeldung wird vorbereitet …" />)
      expect(screen.getByRole('status')).toHaveTextContent(/KP Rück\s*Feuerwehr Oberwil/)
    } finally {
      rememberStationName('')
    }
  })

  it('uses KP Front’s default shell colour in each theme', () => {
    const style = document.createElement('style')
    style.textContent = readFileSync(resolve(__dirname, './snail-loader.css'), 'utf8')
    document.head.append(style)
    try {
      const { container } = renderWithIntl(<BootScreen phase="…" />)
      const loader = container.querySelector<HTMLElement>('.snail-loader')!
      expect(getComputedStyle(loader).getPropertyValue('--accent').trim()).toBe('#e8392b')
      container.classList.add('dark')
      expect(getComputedStyle(loader).getPropertyValue('--accent').trim()).toBe('#ff5a4d')
    } finally {
      style.remove()
    }
  })

  it('offers «Neu starten» only once the start has taken 9 s, and reloads', () => {
    renderWithIntl(<BootScreen phase="Anmeldung wird vorbereitet …" />)
    act(() => vi.advanceTimersByTime(BOOT_STUCK_MS - 1))
    expect(screen.queryByRole('button', { name: 'Neu starten' })).toBeNull()
    act(() => vi.advanceTimersByTime(1))
    expect(screen.getByText('Start dauert länger als gewöhnlich')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Neu starten' }))
    expect(location.reload).toHaveBeenCalledTimes(1)
  })

  it('keeps counting when only the phase changes', () => {
    const { rerender } = renderWithIntl(<BootScreen phase="Anmeldung wird vorbereitet …" />)
    act(() => vi.advanceTimersByTime(6_000))
    rerender(<BootScreen phase="Serververbindung wird geprüft …" />)
    act(() => vi.advanceTimersByTime(3_000))
    expect(screen.getByRole('button', { name: 'Neu starten' })).toBeInTheDocument()
  })

  it('starts the sign-in over instead of reloading where a reload cannot help', () => {
    renderWithIntl(<BootScreen phase="Anmeldung wird verarbeitet …" restartHref="/login" />)
    act(() => vi.advanceTimersByTime(BOOT_STUCK_MS))
    fireEvent.click(screen.getByRole('button', { name: 'Neu starten' }))
    expect(location.assign).toHaveBeenCalledWith('/login')
    expect(location.reload).not.toHaveBeenCalled()
  })

  it('hides the route bar while it is up, and gives it back afterwards', () => {
    expect(topLoading.isSuppressed()).toBe(false)
    const { unmount } = renderWithIntl(<BootScreen phase="Anmeldung wird vorbereitet …" />)
    expect(topLoading.isSuppressed()).toBe(true)
    unmount()
    expect(topLoading.isSuppressed()).toBe(false)
  })
})
