import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'

import { LINK_PAGE_NO_ZOOM_CLASS, LinkPageHeader, LinkPageNoZoom } from '@/components/link-page/link-page'
import LinkPageLayout from '@/components/link-page/link-page-layout'
import { LINK_PAGE_VIEWPORT } from '@/lib/link-page-viewport'
import * as alarmLayout from '@/app/alarm/layout'
import * as checkInLayout from '@/app/check-in/layout'
import * as feldLayout from '@/app/feld/layout'
import * as rekoLayout from '@/app/reko/layout'

const FRONTEND = resolve(__dirname, '../..')
const ROUTES = { feld: feldLayout, 'check-in': checkInLayout, reko: rekoLayout, alarm: alarmLayout }

describe('«Links & QR» pages: no zoom', () => {
  it('fixes the viewport at scale 1, on every link route and only there', () => {
    expect(LINK_PAGE_VIEWPORT).toMatchObject({ initialScale: 1, maximumScale: 1, userScalable: false })
    for (const [route, layout] of Object.entries(ROUTES)) {
      expect(layout.viewport, route).toBe(LINK_PAGE_VIEWPORT)
      expect(layout.default, route).toBe(LinkPageLayout)
    }
    // the root layout imports fonts jsdom cannot load, so this one stays a presence check
    expect(readFileSync(resolve(FRONTEND, 'app/layout.tsx'), 'utf8')).not.toContain('maximumScale')
  })

  it('marks <html> while mounted and cancels the iOS pinch gesture; the board gets it back', () => {
    const { unmount } = render(<LinkPageNoZoom />)
    expect(document.documentElement).toHaveClass(LINK_PAGE_NO_ZOOM_CLASS)
    const pinch = new Event('gesturestart', { cancelable: true })
    document.dispatchEvent(pinch)
    expect(pinch.defaultPrevented).toBe(true)

    unmount()
    expect(document.documentElement).not.toHaveClass(LINK_PAGE_NO_ZOOM_CLASS)
    const later = new Event('gesturestart', { cancelable: true })
    document.dispatchEvent(later)
    expect(later.defaultPrevented).toBe(false)
  })

  // The CSS half (pan-only touch, ≥ 16px fields) is a stylesheet jsdom does not apply; what can
  // drift apart is the class name, so only that is checked.
  it('has a CSS half keyed on the same class', () => {
    const css = readFileSync(resolve(FRONTEND, 'app/globals.css'), 'utf8')
    expect(css).toContain(`html.${LINK_PAGE_NO_ZOOM_CLASS}`)
  })
})

describe('LinkPageHeader', () => {
  it('is one opaque sticky bar with the title as the page heading', () => {
    render(<LinkPageHeader title="Personal-Check-in" subtitle="Unwetter Oberwil" />)
    const header = document.querySelector('[data-slot="link-page-header"]')!
    expect(header).toHaveClass('sticky', 'top-0', 'bg-background')
    expect(header.className).not.toMatch(/backdrop-blur|\/\d+/)
    expect(screen.getByRole('heading', { name: 'Personal-Check-in' })).toBeInTheDocument()
    expect(screen.getByText('Unwetter Oberwil')).toBeInTheDocument()
  })
})
