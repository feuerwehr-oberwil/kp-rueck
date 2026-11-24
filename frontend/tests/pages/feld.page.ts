import { Page, Locator, expect } from '@playwright/test';
import { BasePage } from './base.page';

/**
 * `/feld` — the login-less field surface (plan 25).
 *
 * Three views behind one URL: the person picker, "meine Schadenplätze", and the
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
  /** The name in the header: a menu with tonight's role and «Nicht ich» (owner pick 1A). */
  readonly nameMenu: Locator;

  // --- the door: Feld-Code → picker → bound device (plan 26). The fourth
  // digit submits by itself since the door redesign — there is no button. ---
  readonly codeInput: Locator;
  readonly codeError: Locator;

  // --- the four field actions (components/feld/feld-actions.tsx) ---
  readonly arrivedButton: Locator;
  readonly completeButton: Locator;
  readonly pickupButton: Locator;

  // --- the confirmation both irreversible reports ask for (§18.18) ---
  readonly confirmArrivedButton: Locator;
  readonly confirmCompleteButton: Locator;

  // --- the Abholung follow-up that "Einsatz beendet" opens (decision 24) ---
  readonly pickupFollowupQuestion: Locator;
  readonly needPickupButton: Locator;
  readonly selfReturnButton: Locator;
  readonly pickupBadge: Locator;

  // --- the Rapport form (components/feld/feld-rapport-form.tsx) ---
  readonly kurzberichtField: Locator;
  readonly submitRapportButton: Locator;
  readonly confirmGapsButton: Locator;
  readonly submittedBadge: Locator;

  constructor(page: Page) {
    super(page);

    this.title = page.getByRole('heading', { name: 'Schadenplatz-Rapport' }).first();
    this.personSearch = page.getByPlaceholder('Name suchen …');
    // The trigger's name is the person's own, so it is found by what it opens,
    // inside the header — the rows below are buttons that can carry names too.
    this.nameMenu = page.getByRole('banner').locator('button[aria-haspopup="menu"]');

    // The door (plan 26): four digits before anything at all. The fourth
    // digit submits by itself.
    this.codeInput = page.getByRole('textbox').first();
    this.codeError = page.getByText('Falscher Code');

    // The journey: the pending step's button («… melden») is in the fixed status
    // footer (6C), a done step is a quiet text line in the chain.
    this.arrivedButton = page.getByRole('button', { name: /^Angekommen melden$/ });
    // Amber primary when it is the current step, the quiet inline «melden»
    // link while «Angekommen» is still owed — the same ask-first behind both.
    this.completeButton = page.getByRole('button', { name: /^(Einsatz beendet melden|melden)$/ });
    // One label, always. "Abgeholt" was removed from the field after the first
    // real use (§18.9) — the crew asks, the KP clears.
    this.pickupButton = page.getByRole('button', { name: /^Abholung anfordern$/ });

    this.confirmArrivedButton = page.getByRole('button', { name: 'Angekommen melden' });
    this.confirmCompleteButton = page.getByRole('button', { name: 'Beendet melden' });

    this.pickupFollowupQuestion = page.getByText('Kommt ihr selbst zurück?');
    this.needPickupButton = page.getByRole('button', { name: 'Wir müssen abgeholt werden' });
    this.selfReturnButton = page.getByRole('button', { name: 'Wir fahren selbst' });
    this.pickupBadge = page.getByText('Abholung', { exact: false });

    this.kurzberichtField = page.getByPlaceholder('Lage, Tätigkeit, Material');
    // The `/feld` mount is the ONLY one with this button since §18.17 — the KP
    // has no submit at all and files what it autosaves.
    this.submitRapportButton = page.getByRole('button', { name: 'Rapport abschliessen', exact: true });
    // The one question filing asks, when Kurzbericht or Mannschaft is still
    // empty. Its quiet answer names what it files without.
    this.confirmGapsButton = page.getByRole('button', { name: /^Ohne .+ abschliessen$/ });
    this.submittedBadge = page.getByText(/^Abgeschlossen /);
  }

  /**
   * Open the poster link and walk the door (plan 26).
   *
   * The link alone opens nothing since decision 13: it buys the right to be
   * asked for the Feld-Code. Every field test therefore starts with four
   * digits, which is also the honest simulation of a crew scanning the poster.
   */
  async open(link: string, code: string) {
    await this.page.goto(link);
    await expect(this.codeInput).toBeVisible({ timeout: 15_000 });
    // The fourth digit submits by itself — no button to click.
    await this.codeInput.fill(code);
    // The picker is what the code buys.
    await expect(this.personSearch).toBeVisible({ timeout: 15_000 });
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
    // The heading "Meine Schadenplätze" was removed as noise; the identity bar
    // naming the person is what says the claim landed and the list is theirs.
    await expect(this.page.getByText(name).first()).toBeVisible({ timeout: 15_000 });
  }

  /**
   * One row of the field list.
   *
   * Identify it by its **address**, not its title: since plan 26 a row leads
   * with `address || incident_title` (the street is what a crew standing on it
   * matches), so on any incident that has an address the title is nowhere in
   * the row's DOM.
   */
  assignmentRow(label: string): Locator {
    return this.page.locator('button').filter({ hasText: label }).first();
  }

  /** `label` is the row's address — see `assignmentRow`. */
  async openAssignment(label: string) {
    await this.assignmentRow(label).click();
    await expect(this.page.getByRole('button', { name: 'Zurück' })).toBeVisible({ timeout: 15_000 });
  }

  /**
   * The EL briefing line (decision 22) — the «EL» sign and the leader's name,
   * "kein EL erfasst", or the self variant. It is rendered on the list, and in
   * the detail header only when «Mannschaft» does not mark the EL (6C), so the
   * caller says which one it means by scoping to a row where that matters.
   */
  leaderLine(name: string): Locator {
    return this.page.locator('[data-slot="feld-leader-line"]', { hasText: name });
  }

  /** The Rapport state chip: "kein Rapport" · "Entwurf" · "Rapport erfasst". */
  rapportStateChip(state: 'kein Rapport' | 'Entwurf' | 'Rapport erfasst'): Locator {
    return this.page.getByText(state, { exact: true });
  }

  /**
   * Type the Kurzbericht and file it. Nothing on this form is required.
   *
   * The `/feld` rapport is one open card (owner pick 1B, 24.11.2026), so
   * there is nothing to unfold first.
   *
   * Filing asks only while Kurzbericht or Mannschaft is empty (UX-PHONE-05);
   * empty optional blocks never ask. This helper types the Kurzbericht, so the
   * question comes only when the board sent nobody – then its quiet
   * «Ohne Mannschaft abschliessen» is part of filing.
   */
  async fileRapport(kurzbericht: string) {
    await this.kurzberichtField.fill(kurzbericht);
    await this.submitRapportButton.click();
    await expect(this.submittedBadge.or(this.confirmGapsButton)).toBeVisible({ timeout: 15_000 });
    if (await this.confirmGapsButton.isVisible()) await this.confirmGapsButton.click();
    await expect(this.submittedBadge).toBeVisible({ timeout: 15_000 });
  }

  /**
   * «Nicht ich»: behind the name in the header since the header went meta-only
   * (owner pick 1A, 14.11.2026). Opens the menu and picks it; the confirmation
   * it asks for is the caller's to answer.
   */
  async notMe() {
    await this.nameMenu.click();
    await this.page.getByRole('menuitem', { name: 'Nicht ich' }).click();
  }

  /** "Angekommen", through the confirmation it asks for first (§18.18). */
  async reportArrived() {
    await this.arrivedButton.click();
    await this.confirmArrivedButton.click();
  }

  /** "Einsatz beendet", its confirmation, and the follow-up it opens by itself. */
  async reportComplete() {
    await this.completeButton.click();
    await this.confirmCompleteButton.click();
    await expect(this.pickupFollowupQuestion).toBeVisible({ timeout: 15_000 });
  }
}
