import { act, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { renderWithIntl } from '@/test-utils/render-with-intl'
import { bootGates, launchCover, useBootGate } from '@/lib/boot-cover'

const nav = vi.hoisted(() => ({ pathname: '/' }))
vi.mock('next/navigation', () => ({ usePathname: () => nav.pathname }))

import { BOOT_COVER_FADE_MS, BOOT_COVER_MAX_MS, BootCover } from './boot-cover'

function Gate({ id, ready, label, rank }: { id: string; ready: boolean; label?: string; rank?: number }) {
  useBootGate(id, ready, label, rank)
  return null
}

const cover = () => document.querySelector<HTMLElement>('[data-boot-cover]')

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame', 'performance', 'Date'] })
  nav.pathname = '/'
  bootGates.reset()
})

afterEach(() => {
  vi.useRealTimers()
})

function App({ session = true, board = false }: { session?: boolean; board?: boolean }) {
  return (
    <>
      <BootCover />
      <Gate id="session" ready={session} label="Anmeldung wird vorbereitet …" rank={0} />
      <Gate id="board" ready={board} label="Einsätze werden geladen …" />
    </>
  )
}

describe('BootCover', () => {
  it('covers a launch onto the board with the snail and the phase, and nothing else', () => {
    renderWithIntl(<App session={false} />)
    expect(cover()).toHaveAttribute('data-boot-cover', 'on')
    expect(cover()!.querySelector('.snail-loader svg')).not.toBeNull()
    expect(screen.getByText('Anmeldung wird vorbereitet …')).toBeInTheDocument()
  })

  it('holds while the session is decided but the board is still loading, then names that', () => {
    renderWithIntl(<App session board={false} />)
    act(() => vi.advanceTimersByTime(3_000))
    expect(cover()).toHaveAttribute('data-boot-cover', 'on')
    expect(screen.getByText('Einsätze werden geladen …')).toBeInTheDocument()
  })

  it('lifts once every gate is ready: one frame, a fade, gone', () => {
    const { rerender } = renderWithIntl(<App session board={false} />)
    act(() => vi.advanceTimersByTime(500))
    rerender(<App session board />)
    act(() => vi.advanceTimersByTime(20)) // the frame
    expect(cover()).toHaveAttribute('data-boot-cover', 'leaving')
    expect(cover()!.className).toContain('opacity-0')
    expect(launchCover.isUp()).toBe(true)
    act(() => vi.advanceTimersByTime(BOOT_COVER_FADE_MS))
    expect(cover()).toBeNull()
    // …and the boot stages below may show their own boot screen again (session expiry later).
    expect(launchCover.isUp()).toBe(false)
  })

  it('does not lift before any gate registered', () => {
    renderWithIntl(<BootCover />)
    act(() => vi.advanceTimersByTime(2_000))
    expect(cover()).toHaveAttribute('data-boot-cover', 'on')
  })

  it('gives up at the cap, below the 9 s stuck hint, and reveals whatever is there', () => {
    renderWithIntl(<App session board={false} />)
    act(() => vi.advanceTimersByTime(BOOT_COVER_MAX_MS - 100))
    expect(cover()).toHaveAttribute('data-boot-cover', 'on')
    act(() => vi.advanceTimersByTime(100))
    act(() => vi.advanceTimersByTime(20)) // the frame
    expect(cover()).toHaveAttribute('data-boot-cover', 'leaving')
    expect(screen.queryByText('Start dauert länger als gewöhnlich')).toBeNull()
  })

  it('lifts when the launch leaves the workspace (a viewer → /display/board)', () => {
    const { rerender } = renderWithIntl(<App session={false} />)
    nav.pathname = '/display/board'
    rerender(<App session={false} />)
    act(() => vi.advanceTimersByTime(20))
    act(() => vi.advanceTimersByTime(BOOT_COVER_FADE_MS))
    expect(cover()).toBeNull()
  })

  it('never covers a route that brings its own first screen', () => {
    nav.pathname = '/display/board'
    renderWithIntl(<App session={false} />)
    expect(cover()).toBeNull()
    expect(launchCover.isUp()).toBe(false)
  })

  it('stays gone for the rest of the visit: in-app switching keeps its own loaders', () => {
    const { rerender } = renderWithIntl(<App session board />)
    act(() => vi.advanceTimersByTime(20))
    act(() => vi.advanceTimersByTime(BOOT_COVER_FADE_MS))
    expect(cover()).toBeNull()
    nav.pathname = '/map'
    rerender(<App session board={false} />) // the next page loads — not behind the snail
    act(() => vi.advanceTimersByTime(1_000))
    expect(cover()).toBeNull()
  })
})

describe('BootCover after a sign-in on the login page', () => {
  function Login({ ready = true }: { ready?: boolean }) {
    useBootGate('login', ready)
    return null
  }

  function launchOntoLogin() {
    nav.pathname = '/login'
    const view = renderWithIntl(<><BootCover /><Login /></>)
    act(() => vi.advanceTimersByTime(20))
    act(() => vi.advanceTimersByTime(BOOT_COVER_FADE_MS))
    return view
  }

  it('covers a launch onto /login only until its sign-in options are known', () => {
    nav.pathname = '/login'
    const { rerender } = renderWithIntl(<><BootCover /><Login ready={false} /></>)
    act(() => vi.advanceTimersByTime(1_000))
    expect(cover()).toHaveAttribute('data-boot-cover', 'on')
    rerender(<><BootCover /><Login ready /></>)
    act(() => vi.advanceTimersByTime(20))
    act(() => vi.advanceTimersByTime(BOOT_COVER_FADE_MS))
    expect(cover()).toBeNull()
  })

  it('comes back over the form when the sign-in succeeds and holds until the board is in', () => {
    const { rerender } = launchOntoLogin()
    expect(cover()).toBeNull()
    act(() => launchCover.arm('/login'))
    expect(cover()).toHaveAttribute('data-boot-cover', 'on')
    expect(launchCover.isUp()).toBe(true)
    // Still on /login, whose own gate is open: not the workspace, the cover stays.
    act(() => vi.advanceTimersByTime(500))
    expect(cover()).toHaveAttribute('data-boot-cover', 'on')
    // The app moves on; the board mounts and loads under the cover.
    nav.pathname = '/'
    rerender(<><BootCover /><Gate id="session" ready rank={0} /><Gate id="board" ready={false} /></>)
    act(() => vi.advanceTimersByTime(2_000))
    expect(cover()).toHaveAttribute('data-boot-cover', 'on')
    rerender(<><BootCover /><Gate id="session" ready rank={0} /><Gate id="board" ready /></>)
    act(() => vi.advanceTimersByTime(20))
    expect(cover()).toHaveAttribute('data-boot-cover', 'leaving')
    act(() => vi.advanceTimersByTime(BOOT_COVER_FADE_MS))
    expect(cover()).toBeNull()
  })

  it('caps an armed launch from the sign-in, not from the page load', () => {
    launchOntoLogin()
    act(() => vi.advanceTimersByTime(20_000)) // the form sat there for a while
    act(() => launchCover.arm('/login'))
    act(() => vi.advanceTimersByTime(BOOT_COVER_MAX_MS - 100))
    expect(cover()).toHaveAttribute('data-boot-cover', 'on')
    act(() => vi.advanceTimersByTime(100))
    act(() => vi.advanceTimersByTime(20))
    expect(cover()).toHaveAttribute('data-boot-cover', 'leaving')
  })
})

describe('ProtectedRoute under the launch cover', () => {
  it('shows no second boot screen while the cover is up, and its own once the cover is gone', async () => {
    vi.doMock('@/lib/contexts/auth-context', () => ({ useAuth: () => ({ user: null, loading: true }) }))
    vi.doMock('next/navigation', () => ({ usePathname: () => nav.pathname, useRouter: () => ({ push: vi.fn() }) }))
    vi.resetModules()
    const { ProtectedRoute } = await import('./protected-route')
    const lib = await import('@/lib/boot-cover')
    const view = renderWithIntl(<ProtectedRoute><p>board</p></ProtectedRoute>)
    expect(view.container.querySelector('.snail-loader')).toBeNull()
    act(() => lib.launchCover.set(false))
    expect(view.container.querySelector('.snail-loader')).not.toBeNull()
    vi.doUnmock('@/lib/contexts/auth-context')
  })
})
