import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import manifest from './manifest'

const FRONTEND = resolve(__dirname, '..')
const ROOT = resolve(FRONTEND, '..')

/** Width and height from a PNG's IHDR chunk; throws if the file is not a PNG. */
function pngSize(path: string) {
  const buf = readFileSync(path)
  expect(buf.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a')
  expect(buf.subarray(12, 16).toString('ascii')).toBe('IHDR')
  return `${buf.readUInt32BE(16)}x${buf.readUInt32BE(20)}`
}

describe('web app manifest', () => {
  const m = manifest()

  it('names the app «KP Rück» and opens it standalone on the ink tile colour', () => {
    expect(m.name).toBe('KP Rück')
    expect(m.short_name).toBe('KP Rück')
    expect(m.display).toBe('standalone')
    expect(m.start_url).toBe('/')
    expect(m.theme_color).toBe('#1b2330')
    expect(m.background_color).toBe('#1b2330')
  })

  it('offers an «any» 192 + 512 and a maskable 512, and every file exists at its declared size', () => {
    const icons = m.icons ?? []
    expect(icons.map((i) => `${i.purpose}:${i.sizes}`).sort()).toEqual(
      ['any:192x192', 'any:512x512', 'maskable:512x512'],
    )
    for (const icon of icons) {
      const path = join(FRONTEND, 'public', icon.src)
      expect(existsSync(path), icon.src).toBe(true)
      expect(pngSize(path), icon.src).toBe(icon.sizes)
    }
  })
})

describe('home-screen icon', () => {
  it('is a 180px PNG, because iOS ignores an SVG apple-touch-icon', () => {
    expect(pngSize(join(FRONTEND, 'public/icons/apple-touch-icon.png'))).toBe('180x180')
    const layout = readFileSync(join(FRONTEND, 'app/layout.tsx'), 'utf8')
    expect(layout).toContain("'/icons/apple-touch-icon.png'")
    expect(layout).not.toContain('apple-icon.svg')
    expect(existsSync(join(FRONTEND, 'app/apple-icon.svg'))).toBe(false)
  })

  it('favicon and PNGs are exactly what scripts/build-icons.mjs draws (no drift, no hand edits)', () => {
    const out = execFileSync('node', [join(ROOT, 'scripts/build-icons.mjs'), '--check'], {
      encoding: 'utf8',
      stdio: 'pipe',
    })
    expect(out).toContain('app icons match')
  })

  it('the check fails when the artwork or a PNG changes without a re-render', () => {
    const dir = mkdtempSync(join(tmpdir(), 'kp-rueck-icons-'))
    try {
      for (const rel of ['scripts/build-icons.lock.json', 'frontend/app/icon.svg', 'frontend/public/icons']) {
        cpSync(join(ROOT, rel), join(dir, rel), { recursive: true })
      }
      writeFileSync(join(dir, 'frontend/app/icon.svg'), '<svg/>')
      writeFileSync(join(dir, 'frontend/public/icons/icon-192.png'), 'not the render')
      let stderr = ''
      try {
        execFileSync('node', [join(ROOT, 'scripts/build-icons.mjs'), '--check', dir], { stdio: 'pipe' })
      } catch (error) {
        stderr = String((error as { stderr: Buffer }).stderr)
      }
      expect(stderr).toContain('frontend/app/icon.svg is not what scripts/build-icons.mjs generates')
      expect(stderr).toContain('frontend/public/icons/icon-192.png was changed by hand')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
