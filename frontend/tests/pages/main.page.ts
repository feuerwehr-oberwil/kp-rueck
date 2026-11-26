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

  /** Create an incident through the "Neuer Einsatz" modal. */
  async createIncident(location: string, notes?: string) {
    await this.openIncidentModal();
    await this.setLocation(location);
    if (notes) {
      await this.modalNotesInput.fill(notes);
    }
    await this.modalCreateButton.click();

    // A successful create shows no toast (new-emergency-modal.tsx raises one only for
    // validation errors). The modal closing is the post-condition the callers depend on.
    await this.incidentModal.waitFor({ state: 'hidden', timeout: 15000 });
  }

  /**
   * Enter the address in the modal's LocationInput.
   *
   * Typing is NOT enough: LocationInput is a combobox, and its search box only holds a local
   * query. The value reaches the form — and so enables the create button, which is disabled
   * on `!formData.location` — only when the address is *committed*, either by picking a
   * geocoder result or via the "«…» übernehmen" freetext option that appears when the
   * geocoder returns nothing. Until then the create button stays disabled.
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
    // ⚠️ Only the option list, not "any button in the popover": the search box's clear («X»)
    // button sits above the results and exists as soon as there is text, so clicking it would
    // wipe the query and the wait would pass at once.
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
}
