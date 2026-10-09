import { test, expect, settle, variableParts, API_BASE, PHONE } from './visual.fixture';

/**
 * `/feld` — the one page of KP Rück made for a phone in the rain. The crew's view of
 * their Schadenplatz: Müller Hans, Einsatzleiter at the featured fire.
 *
 * Walked through the real door (link → Feld-Code → name) in a context WITHOUT the board's
 * session: a field phone has none. The walk writes a device claim; nothing on the other
 * screens shows one, so the order the specs run in does not matter.
 */
test.use({ viewport: PHONE, colorScheme: 'light', signedIn: false });

test('feld, Schadenplatz', async ({ page, adminRequest, seededEventId }) => {
  const linkRes = await adminRequest.post(`${API_BASE}/api/feld/generate-link?event_id=${seededEventId}`);
  expect(linkRes.ok()).toBeTruthy();
  const { link } = await linkRes.json();
  const accessRes = await adminRequest.get(`${API_BASE}/api/feld/access?event_id=${seededEventId}`);
  const { code } = await accessRes.json();

  await page.goto(link);
  await page.getByRole('textbox').first().fill(code);
  await page.getByPlaceholder('Name suchen …').fill('Müller Hans');
  await page.locator('button').filter({ hasText: 'Müller Hans' }).first().click();
  await page.getByRole('button').filter({ hasText: 'Langegasse 28' }).first().click();
  await settle(page, page.getByText('Rauch aus dem Dachstock').first());
  await expect(page).toHaveScreenshot('feld-phone.png', { mask: variableParts(page) });
});
