import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'

import { LINK_PAGE_NO_ZOOM_CLASS, LinkPageHeader, LinkPageNoZoom } from '@/components/link-page/link-page'
import { LINK_PAGE_VIEWPORT } from '@/lib/link-page-viewport'

const FRONTEND = resolve(__dirname, '../..')
const ROUTES = ['feld', 'check-in', 'reko', 'alarm']

describe('«Links & QR» pages: no zoom', () => {
  it('fixes the viewport at scale 1, on every link route and only there', () => {
    expect(LINK_PAGE_VIEWPORT).toMatchObject({ initialScale: 1, maximumScale: 1, userScalable: false })
    for (const route of ROUTES) {
      const layout = readFileSync(resolve(FRONTEND, `app/${route}/layout.tsx`), 'utf8')
      expect(layout, route).toContain('export { LINK_PAGE_VIEWPORT as viewport }')
      expect(layout, route).toContain("export { default } from '@/components/link-page/link-page-layout'")
    }
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

  it('has the CSS half: pan-only touch and ≥ 16px fields, scoped to the class', () => {
    const css = readFileSync(resolve(FRONTEND, 'app/globals.css'), 'utf8')
    expect(css).toMatch(/html\.link-page-no-zoom \{\s*touch-action: pan-x pan-y;/)
    expect(css).toMatch(/html\.link-page-no-zoom :is\(input, textarea, select\) \{\s*font-size: max\(16px, 1em\);/)
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
