/**
 * ONE message surface: the same neutral card for every toast, tone only in the
 * glyph, a red trace only on a failure — and a ✕ and buttons that say what they
 * do. Rendered through the real sonner, `unstyled`, so the classes asserted here
 * are the ones that reach the screen.
 */
import { describe, expect, it, vi, beforeAll } from 'vitest'
import { act, render, screen, within } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import { toast } from 'sonner'

import de from '@/messages/de.json'

const mobile = vi.hoisted(() => ({ value: false }))
vi.mock('@/components/ui/use-mobile', () => ({ useIsMobile: () => mobile.value }))
vi.mock('next-themes', () => ({ useTheme: () => ({ theme: 'light' }) }))

import { DismissAllToasts, Toaster, laneFitsAboveSheet, MIN_ROOM_ABOVE_SHEET } from './sonner'

beforeAll(() => {
  if (!window.matchMedia) {
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    })) as typeof window.matchMedia
  }
})

function mount() {
  return render(
    <NextIntlClientProvider locale="de" messages={de}>
      <Toaster />
      <DismissAllToasts />
    </NextIntlClientProvider>,
  )
}

const toastItem = (text: string) => screen.getByText(text).closest('[data-sonner-toast]') as HTMLElement

describe('Toaster', () => {
  it('renders the action and a named ✕ on a failure, and tints only the failure', async () => {
    mount()
    act(() => {
      toast.error('Status konnte nicht geändert werden', {
        action: { label: 'Erneut versuchen', onClick: () => {} },
      })
      toast.success('Einsatz ausgelöst')
    })
    const failure = await screen.findByText('Status konnte nicht geändert werden')
    const failureItem = failure.closest('[data-sonner-toast]') as HTMLElement
    expect(within(failureItem).getByRole('button', { name: 'Erneut versuchen' })).toBeInTheDocument()
    expect(within(failureItem).getByRole('button', { name: 'Meldung schliessen' })).toBeInTheDocument()

    // sonner's own look is off — otherwise it outranks every class below
    expect(failureItem).toHaveAttribute('data-styled', 'false')
    expect(failureItem.className).toMatch(/color-mix\(in_oklab,var\(--destructive\)/)

    const success = toastItem('Einsatz ausgelöst')
    expect(success.className).not.toMatch(/--destructive/)
    expect(success.className).toContain('bg-popover')
    expect(within(success).getByRole('button', { name: 'Meldung schliessen' })).toBeInTheDocument()

    // both go away by themselves, so both carry the running-out line
    expect(failureItem).toHaveClass('toast-timed')
    expect(failureItem.style.getPropertyValue('--toast-life')).toBe('6000ms')
    expect(success.style.getPropertyValue('--toast-life')).toBe('2800ms')

    // two toasts: «Alle schliessen» is there
    expect(screen.getByRole('button', { name: 'Alle schliessen' })).toBeInTheDocument()
    act(() => {
      toast.dismiss()
    })
  })

  it('draws no line under a sticky toast', async () => {
    mount()
    act(() => {
      toast.error('Verbindung verloren', { duration: Infinity })
    })
    const item = (await screen.findByText('Verbindung verloren')).closest('[data-sonner-toast]') as HTMLElement
    expect(item).not.toHaveClass('toast-timed')
    act(() => {
      toast.dismiss()
    })
  })
})

describe('laneFitsAboveSheet', () => {
  it('fits when no sheet is open', () => {
    expect(laneFitsAboveSheet(0, 844)).toBe(true)
  })
  it('fits above a half-height sheet', () => {
    expect(laneFitsAboveSheet(400, 844)).toBe(true)
  })
  it('does not fit above a nearly full-height sheet', () => {
    expect(laneFitsAboveSheet(844 - MIN_ROOM_ABOVE_SHEET + 1, 844)).toBe(false)
  })
  it('goes to the top while a keyboard is up: the sheet fills the visible band then', () => {
    expect(laneFitsAboveSheet(400, 844, true)).toBe(false)
    expect(laneFitsAboveSheet(0, 844, true)).toBe(true)
  })
})
