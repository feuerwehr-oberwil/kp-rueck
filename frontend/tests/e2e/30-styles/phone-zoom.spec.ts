import { devices, expect, test } from '@playwright/test'

test.use({ ...devices['iPhone 13'], defaultBrowserType: 'chromium' })

test('a crew member can magnify the attendance form', async ({ page, context }) => {
  await page.route('**/api/personnel/check-in/list?**', route => route.fulfill({
    json: { event_name: 'Übung', personnel: [{ id: 'p', name: 'Muster Robin', checked_in: false, is_assigned: false }] },
  }))
  await page.goto('/check-in?token=fixture')
  await expect(page.getByRole('button', { name: /Robin/ })).toBeVisible()

  const input = await context.newCDPSession(page)
  await input.send('Input.synthesizePinchGesture', { x: 170, y: 240, scaleFactor: 2, gestureSourceType: 'touch' })
  await expect.poll(() => page.evaluate(() => window.visualViewport?.scale)).toBeGreaterThan(1.5)
})
