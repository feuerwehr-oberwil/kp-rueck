import { devices, expect, test } from '@playwright/test'

test.use({ ...devices['iPhone 13'], defaultBrowserType: 'chromium' })

test('a crew member can magnify the attendance form', async ({ page, context }) => {
  await page.route('**/api/personnel/check-in/list?**', route => route.fulfill({
    json: { event_name: 'Übung', personnel: [{ id: 'p', name: 'Muster Robin', checked_in: false, is_assigned: false }] },
  }))
  await page.goto('/check-in?token=fixture')
  await expect(page.getByRole('button', { name: /Robin/ })).toBeVisible()

  const input = await context.newCDPSession(page)
  // Dispatch both fingers: synthesizePinchGesture on a headless touch device can leave even
  // an unrestricted document at 1×.
  const points = (offset: number) => [
    { x: 150 - offset, y: 240, id: 1 },
    { x: 200 + offset, y: 240, id: 2 },
  ]
  await input.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: points(0) })
  for (let offset = 5; offset <= 110; offset += 5) {
    await input.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: points(offset) })
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())))
  }
  await input.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await expect.poll(() => page.evaluate(() => window.visualViewport?.scale)).toBeGreaterThan(1.5)
})
