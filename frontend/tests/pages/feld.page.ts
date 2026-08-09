import { Page, Locator, expect } from '@playwright/test';
import { BasePage } from './base.page';

/**
 * `/feld` — the login-less field surface (plan 25).
 *
 * Three views behind one URL: the person picker, "meine Einsatzstellen", and the
 * Schadenplatz detail with the four field actions and the Rapport form. They are
 * one page component with a `viewMode` (`frontend/app/feld/page.tsx`), so the
 * page object mirrors that rather than pretending there are three routes.
 *
 * Selectors are German copy on purpose. The field page carries no `data-testid`
 * anywhere, and the copy IS the contract here — every string below comes from
 * `frontend/messages/de.json` under `feld.*`, so a reworded button that the
 * crew would have to re-learn fails this suite instead of passing it silently.
 */
export class FeldPage extends BasePage {
  readonly title: Locator;
  readonly personSearch: Locator;
  readonly notMeButton: Locator;

  // --- the four field actions (components/feld/feld-actions.tsx) ---
  readonly arrivedButton: Locator;
  readonly completeButton: Locator;
  readonly pickupButton: Locator;

  // --- the Abholung follow-up that "Einsatz beendet" opens (decision 24) ---
  readonly pickupFollowupQuestion: Locator;
  readonly needPickupButton: Locator;
  readonly selfReturnButton: Locator;
  readonly pickupBadge: Locator;

  // --- the Rapport form (components/feld/feld-rapport-form.tsx) ---
  readonly kurzberichtField: Locator;
  readonly submitRapportButton: Locator;
  readonly submittedBadge: Locator;

  constructor(page: Page) {
    super(page);

    this.title = page.getByRole('heading', { name: 'Schadenplatz-Rapport' }).first();
    this.personSearch = page.getByPlaceholder('Name suchen...');
    this.notMeButton = page.getByRole('button', { name: 'Nicht ich' });

    this.arrivedButton = page.getByRole('button', { name: /^Angekommen/ });
    this.completeButton = page.getByRole('button', { name: /^(Einsatz beendet|Beendet gemeldet)$/ });
    // One label, always. "Abgeholt" was removed from the field after the first
    // real use (§18.9) — the crew asks, the KP clears.
    this.pickupButton = page.getByRole('button', { name: /^Abholung$/ });

    this.pickupFollowupQuestion = page.getByText('Kommt ihr selbst zurück?');
    this.needPickupButton = page.getByRole('button', { name: 'Wir müssen abgeholt werden' });
    this.selfReturnButton = page.getByRole('button', { name: 'Wir fahren selbst' });
    this.pickupBadge = page.getByText('Abholung', { exact: false });

    this.kurzberichtField = page.getByPlaceholder('Lage, Tätigkeit, Geräte');
    // `exact` matters: the KP mount of the SAME component reads
    // "Rapport abschliessen (Funkmeldung)".
    this.submitRapportButton = page.getByRole('button', { name: 'Rapport abschliessen', exact: true });
    this.submittedBadge = page.getByText(/^Abgeschlossen /);
  }

  /** Open the poster link. `link` is the relative `/feld?token=…` the API hands out. */
  async open(link: string) {
    await this.page.goto(link);
    await expect(this.title).toBeVisible({ timeout: 15_000 });
  }

  /** One row of the person picker. */
  person(name: string): Locator {
    return this.page.locator('button').filter({ hasText: name }).first();
  }

  async pickPerson(name: string) {
    // Narrow first: the picker lists everyone with an assignment in the
    // Ereignis, and on a station roster that is a long scroll.
    await this.personSearch.fill(name);
    await this.person(name).click();
    await expect(this.page.getByRole('heading', { name: 'Meine Einsatzstellen' })).toBeVisible({
      timeout: 15_000,
    });
  }

  /** One row of "meine Einsatzstellen". */
  assignmentRow(incidentTitle: string): Locator {
    return this.page.locator('button').filter({ hasText: incidentTitle }).first();
  }

  async openAssignment(incidentTitle: string) {
    await this.assignmentRow(incidentTitle).click();
    await expect(this.page.getByRole('button', { name: 'Zurück' })).toBeVisible({ timeout: 15_000 });
  }

  /**
   * The EL briefing line (decision 22) — "EL: <name>", "kein EL erfasst", or the
   * self variant. It is rendered on the list AND in the detail header, so the
   * caller says which one it means by scoping to a row where that matters.
   */
  leaderLine(name: string): Locator {
    return this.page.getByText(`EL: ${name}`);
  }

  /** The Rapport state chip: "kein Rapport" · "Entwurf" · "Rapport erfasst". */
  rapportStateChip(state: 'kein Rapport' | 'Entwurf' | 'Rapport erfasst'): Locator {
    return this.page.getByText(state, { exact: true });
  }

  /** Type the Kurzbericht and file it. Nothing on this form is required. */
  async fileRapport(kurzbericht: string) {
    await this.kurzberichtField.fill(kurzbericht);
    await this.submitRapportButton.click();
    await expect(this.submittedBadge).toBeVisible({ timeout: 15_000 });
  }

  /** "Einsatz beendet" and the follow-up it opens by itself. */
  async reportComplete() {
    await this.completeButton.click();
    await expect(this.pickupFollowupQuestion).toBeVisible({ timeout: 15_000 });
  }
}
