import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, test } from '@playwright/test'

test('the high-priority pulse uses its dark-theme keyframes', async ({ page }) => {
  const css = readFileSync(resolve(process.cwd(), 'app/globals.css'), 'utf8')
  const start = css.indexOf('/* High-priority incident pulse animation */')
  const end = css.indexOf('/* --- Spotlight', start)
  expect(start).toBeGreaterThanOrEqual(0)
  expect(end).toBeGreaterThan(start)

  await page.setContent('<div class="priority-high-pulse">High priority</div>')
  await page.addStyleTag({ content: css.slice(start, end) })
  const marker = page.locator('.priority-high-pulse')
  const frames = () => marker.evaluate((element) => {
    const effect = element.getAnimations()[0]?.effect
    if (!(effect instanceof KeyframeEffect)) throw new Error('Priority animation is missing')
    return effect.getKeyframes().map((frame) => frame.boxShadow)
  })
  const light = await frames()
  await page.locator('html').evaluate((element) => element.classList.add('dark'))
  const dark = await frames()

  expect(light).toHaveLength(3)
  expect(dark).toHaveLength(3)
  expect(dark).not.toEqual(light)
})
