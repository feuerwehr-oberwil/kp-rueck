import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { LoadingStatus, SHELL_TRAIL_PATH, ShellLoader } from './shell-loader'

describe('ShellLoader', () => {
  it('draws the faint spiral and the trail along the same path, hidden from assistive tech', () => {
    const { container } = render(<ShellLoader />)
    const svg = container.querySelector('svg')!
    expect(svg).toHaveAttribute('aria-hidden', 'true')
    expect(svg).toHaveAttribute('stroke', 'currentColor')
    expect(svg).toHaveAttribute('stroke-width', '14')
    expect(svg).toHaveAttribute('stroke-linecap', 'round')
    expect(svg).toHaveAttribute('width', '20')
    const paths = svg.querySelectorAll('path')
    expect(paths).toHaveLength(2)
    paths.forEach((path) => expect(path).toHaveAttribute('d', SHELL_TRAIL_PATH))
    expect(paths[0]).toHaveAttribute('opacity', '.12')
    expect(paths[1]).toHaveAttribute('pathLength', '100')
  })

  it('is 48px as a surface loader', () => {
    const { container } = render(<ShellLoader size="surface" />)
    expect(container.querySelector('svg')).toHaveAttribute('width', '48')
  })

  // The in-repo half of the drift check: the inlined path is the one in OUR copy of the
  // snail. The `snail-drift` CI job compares that copy with kp-front's.
  it('uses exactly the fs-shell-trail path of the shared snail SVG', () => {
    const svg = readFileSync(resolve(__dirname, '../../public/firefighter-snail-loader.svg'), 'utf8')
    const path = svg.match(/<path id="fs-shell-trail" d="([^"]+)"/)?.[1]
    expect(path).toBe(SHELL_TRAIL_PATH)
  })
})

describe('LoadingStatus', () => {
  it('announces its words as a status, with the trail beside them', () => {
    render(<LoadingStatus>Wird geladen …</LoadingStatus>)
    const status = screen.getByRole('status')
    expect(status).toHaveTextContent('Wird geladen …')
    expect(status.querySelector('svg')).toHaveAttribute('width', '20')
  })

  it('stacks a 48px trail above the words as a surface', () => {
    render(<LoadingStatus size="surface">Karte wird geladen …</LoadingStatus>)
    const status = screen.getByRole('status')
    expect(status.querySelector('svg')).toHaveAttribute('width', '48')
    expect(status.className).toContain('flex-col')
  })
})
