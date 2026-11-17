import { expect, test, type Locator } from '@playwright/test'

function textLineCount(heading: Locator) {
  return heading.evaluate(element => {
    const range = document.createRange()
    range.selectNodeContents(element)
    return new Set(Array.from(range.getClientRects(), rect => rect.top)).size
  })
}

test('the shared wall sizes the address and status to the open columns', async ({ page }) => {
  const since = '2026-11-17T10:00:00Z'
  // An overdue incident also needs room for the age badge beside «Im Einsatz».
  await page.clock.setFixedTime(new Date('2026-11-17T11:20:00Z'))
  await page.route('**/api/viewer/data?**', route => route.fulfill({
    json: {
      event: { id: 'talbach', name: 'Unwetter Talbach', training_flag: false },
      incidents: [{
        id: 'keller', event_id: 'talbach', title: 'Wasser im Keller', type: 'elementarereignis',
        location_address: 'Talstrasse 11', status: 'active', priority: 'medium',
        created_at: since, updated_at: since, status_changed_at: since,
      }],
      personnel: [], materials: [], vehicles: [], vehicle_positions: [],
    },
  }))
  await page.setViewportSize({ width: 1920, height: 1080 })
  await page.goto('/display/board?token=fixture')
  const address = page.getByRole('heading', { name: 'Talstrasse 11' })
  const status = page.getByRole('heading', { name: 'Im Einsatz', exact: true })
  await expect(address).toHaveCSS('font-size', '25px')
  await page.evaluate(() => document.fonts.ready.then(() => undefined))

  await page.setViewportSize({ width: 1440, height: 900 })
  await expect.poll(() => textLineCount(address)).toBe(1)
  await expect.poll(() => textLineCount(status)).toBe(1)
  await expect(address).toHaveCSS('font-size', '20px')

  // The viewport stays at 1440. Folding empty columns gives the address its large type back.
  for (const name of ['Eingegangen', 'Reko', 'Reko abgeschlossen']) {
    await page.getByRole('heading', { name, exact: true }).click()
  }
  await expect(address).toHaveCSS('font-size', '25px')
})
