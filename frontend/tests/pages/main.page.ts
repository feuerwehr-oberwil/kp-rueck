import { Page, Locator } from '@playwright/test';
import { BasePage } from './base.page';

/**
 * Main Page Object Model: the board at `/` and its quick incident creation modal.
 */
export class MainPage extends BasePage {
  // Incident Creation Elements
  readonly newIncidentButton: Locator;
  readonly incidentModal: Locator;

  // Modal Elements
  readonly modalLocationInput: Locator;
  readonly modalNotesInput: Locator;
  readonly modalCreateButton: Locator;

  constructor(page: Page) {
    super(page);

      // Incident Creation Elements
    this.newIncidentButton = page.locator('button:has-text("Neuer Einsatz")');
    // Radix gives BOTH dialogs and popovers `role="dialog"`, and a combobox popover inside the
    // modal is open at the same time as the modal — so `[role="dialog"][data-state="open"]`
    // matched two elements and every use died on a strict-mode violation. `data-slot` is what
    // actually distinguishes them: dialog-content vs popover-content.
    this.incidentModal = page.locator('[role="dialog"][data-slot="dialog-content"][data-state="open"]');

    // Modal Elements
    this.modalLocationInput = page.locator('[role="dialog"] input[placeholder*="Adresse"]');
    this.modalNotesInput = page.locator('[role="dialog"] textarea[placeholder*="Notizen"]');
    this.modalCreateButton = page.locator('[role="dialog"] button:has-text("erstellen")');
  }

  /**
   * Navigate to main page
   */
  async goto() {
    await super.goto('/');
  }

  /**
   * Open the incident creation modal.
   */
  async openIncidentModal() {
    await this.newIncidentButton.click();
    await this.incidentModal.waitFor({ state: 'visible', timeout: 5000 });
  }

  /**
   * Create an incident through the "Neuer Einsatz" modal.
   *
   * Was `createFullIncident`, next to a `createQuickIncident` that clicked a "Schnell" button.
   * That quick-mode UI no longer exists anywhere in the app, so there is no longer a "full" to
   * distinguish from — one modal, one method. Callers of the old quick helper now come here.
   */
  async createIncident(location: string, notes?: string) {
    await this.openIncidentModal();
    await this.setLocation(location);
    if (notes) {
      await this.modalNotesInput.fill(notes);
    }
    await this.modalCreateButton.click();

    // NOT waitForToast(): new-emergency-modal.tsx raises a toast only for validation errors —
    // a successful create shows none at all, so waiting for one always timed out. The modal
    // closing is the real post-condition, and it is what the callers actually depend on.
    await this.incidentModal.waitFor({ state: 'hidden', timeout: 15000 });
  }

  /**
   * Enter the address in the modal's LocationInput.
   *
   * Typing is NOT enough: LocationInput is a combobox, and its search box only holds a local
   * query. The value reaches the form — and so enables the create button, which is disabled
   * on `!formData.location` — only when the address is *committed*, either by picking a
   * geocoder result or via the "«…» übernehmen" freetext option that appears when the
   * geocoder returns nothing. Filling the box and clicking Create just timed out on a
   * permanently disabled button.
   *
   * Both paths are handled because CI's network to the geocoder is not something a test
   * should depend on: whichever of the two appears first is taken.
   */
  async setLocation(address: string) {
    await this.modalLocationInput.fill(address);

    // Options live in the combobox popover — which Radix also gives role="dialog", hence the
    // data-slot discriminator. An option is either a geocoded result row or the "«…» übernehmen"
    // freetext fallback shown when the geocoder returns nothing; clicking either commits the
    // address. Which one appears depends on whether CI could reach the geocoder, so this does
    // not assume either way.
    //
    // ⚠️ NOT "any button in the popover". The popover's search box renders a clear («X») button
    // as soon as there is text, and it sits ABOVE the result list — so `getByRole('button').first()`
    // resolved to *that*, and clicking it wiped the query instead of committing an address. The
    // create button then stayed `disabled` and the click timed out after 30 s. Worse, the clear
    // button exists the moment you type, so the `waitFor` passed instantly and this never actually
    // waited for results. That failed the nightly every night from 2026-08-05: in CI the geocoder
    // IS reachable, so the freetext branch never ran and the wrong branch always did.
    const popover = this.page.locator(
      '[role="dialog"][data-slot="popover-content"][data-state="open"]'
    );
    const options = popover.getByTestId('location-options').getByRole('button');
    await options.first().waitFor({ state: 'visible', timeout: 15000 });

    const freetext = options.filter({ hasText: /übernehmen/ });
    if ((await freetext.count()) > 0) {
      await freetext.first().click();
    } else {
      await options.first().click();
    }
  }

  // The role-badge helpers that used to sit here were dead and broken: nothing
  // called them, and their `[class*="badge"]` locator matched nothing at all
  // (the shadcn Badge emits utility classes, none containing "badge"). The
  // badge now lives inside the UserMenu dropdown; 06-role-badge locates it
  // there via `data-slot="badge"`.

  /**
   * Sprint 2 Helper Methods
   */

  // `openResourceAssignmentDialog`, `getResourceBadgeCount` and
  // `resourceBadgeHasCheckmark` used to live here. All three were dead (nothing
  // called them) and all three were also broken: they looked for a "Crew (n)"
  // badge and a [+] button on the kanban card, which stopped rendering them when
  // the counted resource sections moved into the detail view — and the label is
  // "Mannschaft", not "Crew", so `text=Crew` matched nothing in any version of
  // the app they outlived. 09-resource-badges asserts the sections where they
  // now are.

  /**
   * Sprint 3 Helper Methods - Drag-Drop Visual Affordances
   */

  /**
   * Sprint 3 Helper Methods - Priority Visual Hierarchy
   */

  /**
   * Sprint 3 Helper Methods - Time-Based Indicators
   */

  /**
   * Sprint 3 Helper Methods - Combined Features
   */
}
