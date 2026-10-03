import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'

import { FELD_NO_ZOOM_CLASS, FeldNoZoom } from '@/components/feld/feld-no-zoom'
import { viewport } from '@/app/feld/layout'

describe('/feld zoom guard', () => {
  it('fixes the /feld viewport at scale 1', () => {
    expect(viewport).toMatchObject({ initialScale: 1, maximumScale: 1, userScalable: false })
  })

  it('marks <html> while mounted and cancels the iOS pinch gesture; the board gets it back', () => {
    const { unmount } = render(<FeldNoZoom />)
    expect(document.documentElement).toHaveClass(FELD_NO_ZOOM_CLASS)
    const pinch = new Event('gesturestart', { cancelable: true })
    document.dispatchEvent(pinch)
    expect(pinch.defaultPrevented).toBe(true)

    unmount()
    expect(document.documentElement).not.toHaveClass(FELD_NO_ZOOM_CLASS)
    const later = new Event('gesturestart', { cancelable: true })
    document.dispatchEvent(later)
    expect(later.defaultPrevented).toBe(false)
  })

  it('has the CSS half: pan-only touch and ≥ 16px fields, scoped to the class', () => {
    const css = readFileSync(resolve(__dirname, '../../app/globals.css'), 'utf8')
    expect(css).toMatch(/html\.feld-no-zoom \{\s*touch-action: pan-x pan-y;/)
    expect(css).toMatch(/html\.feld-no-zoom :is\(input, textarea, select\) \{\s*font-size: max\(16px, 1em\);/)
  })
})
