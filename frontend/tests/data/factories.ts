/**
 * Test Data Factories
 * Provides factory functions for creating test data
 */

export const EventFactory = {
  /**
   * Create a default test event
   */
  default: () => ({
    name: `Test Event ${Date.now()}`,
    training_flag: false,
    auto_attach_divera: false,
  }),

  /**
   * Create a training event
   */
  training: () => ({
    name: `Übung ${Date.now()}`,
    training_flag: true,
    auto_attach_divera: false,
  }),

  /**
   * Create an event with Divera auto-attach enabled
   */
  withDivera: () => ({
    name: `Divera Event ${Date.now()}`,
    training_flag: false,
    auto_attach_divera: true,
  }),

  /**
   * Create a custom event
   */
  custom: (overrides: Partial<{ name: string; training_flag: boolean; auto_attach_divera: boolean }>) => ({
    ...EventFactory.default(),
    ...overrides,
  }),
};

export const IncidentFactory = {
  /**
   * Create a default incident
   */
  default: (eventId: string) => ({
    event_id: eventId,
    location: 'Hauptstrasse 1, 4410 Liestal',
    address: 'Hauptstrasse 1, 4410 Liestal',
    description: 'Test incident description',
    criticality: 'normal' as const,
    type: 'brandbekaempfung' as const,
    status: 'new' as const,
  }),

  /**
   * Create a critical incident
   */
  critical: (eventId: string) => ({
    ...IncidentFactory.default(eventId),
    criticality: 'critical' as const,
  }),

  /**
   * Create a technical incident
   */
  technical: (eventId: string) => ({
    ...IncidentFactory.default(eventId),
    type: 'strassenrettung' as const,
  }),

  /**
   * Create a custom incident
   */
  custom: (eventId: string, overrides: any) => ({
    ...IncidentFactory.default(eventId),
    ...overrides,
  }),
};

export const PersonnelFactory = {
  /**
   * Create personnel data
   */
  default: (index: number) => ({
    name: `Test Person ${index}`,
    role: 'Feuerwehrmann',
    availability: 'available' as const,
  }),

  /**
   * Create driver personnel
   */
  driver: (index: number) => ({
    name: `Driver ${index}`,
    role: 'Fahrer',
    availability: 'available' as const,
  }),
};

export const VehicleFactory = {
  /**
   * Create vehicle data
   */
  default: (index: number) => ({
    name: `TLF ${index}`,
    type: 'TLF',
    availability: 'available' as const,
  }),
};

export const MaterialFactory = {
  /**
   * Create material data
   */
  default: (index: number) => ({
    name: `Atemschutz ${index}`,
    availability: 'available' as const,
  }),
};
