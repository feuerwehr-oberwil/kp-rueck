import type { Page } from '@playwright/test';
import { test, expect } from '../../fixtures/auth.fixture';
import { setupBoard } from '../../helpers/api.helper';

/**
 * A failed print has to reach the person walking to the printer.
 *
 * "Druckauftrag gesendet" only ever confirmed that a slip was QUEUED. If the paper
 * was out the agent marked the job `failed` with an `error_message` that lived under
 * Einstellungen → Drucker and nowhere else — so the operator read "gesendet", walked
 * over, and found nothing.
 *
 * There is no printer in CI, and there does not need to be: the behaviour under test
 * is what the operator reads, so this spec plays the agent's part against the real
 * agent API (claim → complete) and asserts the toast on the board changes.
 *
 * Untagged on purpose: nightly, not @smoke.
 */

const BACKEND = 'http://localhost:8000';
// docker-compose.dev.yml: PRINT_AGENT_TOKEN defaults to this for the dev stack.
const AGENT_TOKEN = process.env.PRINT_AGENT_TOKEN || 'dev-print-token';
const AGENT_HEADERS = { 'X-Agent-Token': AGENT_TOKEN };

/**
 * Play the print agent for ONE specific job.
 *
 * Deliberately by id rather than "the oldest pending job": a failed job with attempts
 * left is requeued by the reaper, so the queue in a dev database is rarely empty and
 * draining the wrong slip would make this spec pass or fail for the wrong reason.
 */
async function agentReports(page: Page, jobId: string, status: 'completed' | 'failed', errorMessage?: string) {
  const claim = await page.request.patch(`${BACKEND}/api/print/jobs/${jobId}/claim/`, { headers: AGENT_HEADERS });
  expect(claim.ok(), 'agent could not claim the job').toBeTruthy();

  const complete = await page.request.patch(`${BACKEND}/api/print/jobs/${jobId}/complete/`, {
    headers: AGENT_HEADERS,
    data: { status, error_message: errorMessage ?? null },
  });
  expect(complete.ok(), 'agent could not report the outcome').toBeTruthy();
}

test.describe('Print job outcome reaches the operator', () => {
  test.beforeEach(async ({ authenticatedPage: page }) => {
    // The print endpoints refuse to queue while the printer is off.
    const enable = await page.request.patch(`${BACKEND}/api/settings/printer.enabled`, {
      data: { value: 'true' },
    });
    expect(enable.ok(), 'could not enable the printer').toBeTruthy();

    await setupBoard(page, 'Print Outcome');
  });

  test.afterEach(async ({ authenticatedPage: page }) => {
    await page.request.patch(`${BACKEND}/api/settings/printer.enabled`, { data: { value: 'false' } });
  });

  /** Print via the card context menu; returns the id of the job that was queued. */
  async function printFromCardContextMenu(page: Page): Promise<string> {
    const card = page.locator('[data-testid="incident-card"]').first();
    await card.waitFor({ state: 'visible' });
    await card.click({ button: 'right' });

    const queued = page.waitForResponse(
      (res) => res.url().includes('/api/print/assignment/') && res.request().method() === 'POST'
    );
    await page.getByRole('menuitem', { name: 'Einsatzzettel drucken' }).click();
    const job = await (await queued).json();

    // The queue confirmation is unchanged — it is the start of the story now.
    await expect(page.getByText('Druckauftrag gesendet')).toBeVisible({ timeout: 10000 });
    return job.id;
  }

  test('paper out: the queued toast is replaced by the agent\'s own reason', async ({
    authenticatedPage: page,
  }) => {
    const jobId = await printFromCardContextMenu(page);

    await agentReports(page, jobId, 'failed', 'Papier leer');

    // This is the whole point: the operator learns it at the printer, not afterwards.
    await expect(page.getByText(/Druck fehlgeschlagen/)).toBeVisible({ timeout: 15000 });
    await expect(page.getByText(/Papier leer/)).toBeVisible();
    // And "gesendet" must be gone — the toast was replaced, not stacked next to.
    await expect(page.getByText('Druckauftrag gesendet')).toHaveCount(0);
  });

  test('a printer that is simply unreachable reads differently from paper out', async ({
    authenticatedPage: page,
  }) => {
    const jobId = await printFromCardContextMenu(page);

    await agentReports(page, jobId, 'failed', 'Drucker nicht erreichbar');

    await expect(page.getByText(/Drucker nicht erreichbar/)).toBeVisible({ timeout: 15000 });
  });

  test('no agent at all: the toast stops waiting instead of spinning forever', async ({
    authenticatedPage: page,
  }) => {
    // Nothing plays the agent here — the job is queued and simply never claimed,
    // which is exactly what a station with a dead Raspberry Pi looks like.
    test.setTimeout(90_000);
    await printFromCardContextMenu(page);

    await expect(page.getByText('Druckdienst antwortet nicht')).toBeVisible({ timeout: 45_000 });
    await expect(page.getByText(/wartet in der Warteschlange/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Drucker prüfen' })).toBeVisible();
  });

  // Deliberately NOT "paper came out". A TM-T20III with an empty tray takes a short slip into
  // its buffer, the write closes cleanly and the agent reports `completed` — so the wording was
  // changed to claim only what is actually known. The assertion has to claim the same, or the
  // spec quietly re-asserts the bug.
  test('a completed job says the slip reached the printer, and no more than that', async ({
    authenticatedPage: page,
  }) => {
    const jobId = await printFromCardContextMenu(page);

    await agentReports(page, jobId, 'completed');

    await expect(page.getByText('An Drucker gesendet', { exact: true })).toBeVisible({ timeout: 15000 });
    await expect(page.getByText('Druckauftrag gesendet')).toHaveCount(0);
  });
});
