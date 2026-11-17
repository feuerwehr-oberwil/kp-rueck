import { expect, test } from '@playwright/test'

test('the high-priority pulse changes size and follows the current theme', async ({ page }) => {
  await page.goto('/login')
  const { light, dark } = await page.evaluate(() => {
    const marker = document.createElement('div')
    marker.className = 'priority-high-pulse'
    document.body.append(marker)
    const pulse = marker.getAnimations().find(animation => animation instanceof CSSAnimation)
    if (!pulse?.effect) throw new Error('The loaded stylesheet has no priority animation')
    pulse.pause()
    const midpoint = Number(pulse.effect.getTiming().duration) / 2

    const sample = (isDark: boolean) => {
      document.documentElement.classList.toggle('dark', isDark)
      pulse.currentTime = 0
      const start = getComputedStyle(marker).boxShadow
      pulse.currentTime = midpoint
      const peak = getComputedStyle(marker).boxShadow
      return { start, peak }
    }
    const light = sample(false)
    const dark = sample(true)
    marker.remove()
    return { light, dark }
  })

  for (const theme of [light, dark]) {
    expect(theme.start).toMatch(/ 0px 0px 0px 0px$/)
    expect(theme.peak).not.toBe('none')
    expect(theme.peak).not.toMatch(/ 0px 0px 0px 0px$/)
  }
  expect(dark.peak).not.toBe(light.peak)
})
