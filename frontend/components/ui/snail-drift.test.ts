import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

// The CI job «Snail loader matches KP Front» runs this script against a kp-front checkout.
// Here it runs against a fake kp-front built from our own copy, so both outcomes are
// exercised without the sibling repository.
const ROOT = resolve(__dirname, '../../..')
const SCRIPT = join(ROOT, 'scripts/check-snail-drift.mjs')
const OUR_SVG = join(ROOT, 'frontend/public/firefighter-snail-loader.svg')

const dirs: string[] = []
afterEach(() => {
  dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true }))
})

function fakeFront(svg?: string) {
  const dir = mkdtempSync(join(tmpdir(), 'kp-front-'))
  dirs.push(dir)
  mkdirSync(join(dir, 'public'))
  const target = join(dir, 'public/firefighter-snail-loader.svg')
  if (svg === undefined) copyFileSync(OUR_SVG, target)
  else writeFileSync(target, svg)
  return dir
}

function run(front: string) {
  try {
    const out = execFileSync('node', [SCRIPT, front, ROOT], { encoding: 'utf8', stdio: 'pipe' })
    return { code: 0, out }
  } catch (error) {
    const e = error as { status: number; stderr: string }
    return { code: e.status, out: e.stderr }
  }
}

describe('scripts/check-snail-drift.mjs', () => {
  it('passes when the SVG is identical and the shell trail path matches', () => {
    expect(run(fakeFront())).toMatchObject({ code: 0 })
  })

  it('fails when kp-front changed the shell trail', () => {
    const svg = readFileSync(OUR_SVG, 'utf8').replace('d="M534 550', 'd="M534 551')
    const { code, out } = run(fakeFront(svg))
    expect(code).toBe(1)
    expect(out).toContain('differs from kp-front')
    expect(out).toContain('SHELL_TRAIL_PATH')
  })

  it('fails when kp-front changed the drawing but not the trail', () => {
    const svg = readFileSync(OUR_SVG, 'utf8').replace('#ffe76c', '#ffe76d')
    const { code, out } = run(fakeFront(svg))
    expect(code).toBe(1)
    expect(out).toContain('firefighter-snail-loader.svg differs')
    expect(out).not.toContain('SHELL_TRAIL_PATH')
  })

  it('fails when kp-front no longer has the snail', () => {
    const dir = mkdtempSync(join(tmpdir(), 'kp-front-'))
    dirs.push(dir)
    expect(run(dir)).toMatchObject({ code: 1 })
  })
})
