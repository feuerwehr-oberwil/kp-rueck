// Incident types mapping - matches database constraint
export const incidentTypeLabels: Record<string, string> = {
  brandbekaempfung: 'Brandbekämpfung',
  elementarereignis: 'Elementarereignis',
  strassenrettung: 'Strassenrettung',
  technische_hilfeleistung: 'Technische Hilfeleistung',
  oelwehr: 'Ölwehr',
  chemiewehr: 'Chemiewehr',
  strahlenwehr: 'Strahlenwehr',
  einsatz_bahnanlagen: 'Einsatz Bahnanlagen',
  bma_unechte_alarme: 'BMA / Unechte Alarme',
  dienstleistungen: 'Dienstleistungen',
  diverse_einsaetze: 'Diverse Einsätze',
  gerettete_menschen: 'Gerettete Menschen',
  gerettete_tiere: 'Gerettete Tiere',
}

// Get all incident type keys for dropdowns
export const incidentTypeKeys = Object.keys(incidentTypeLabels)

// Helper function to format incident types to German labels
export function getIncidentTypeLabel(type: string): string {
  return incidentTypeLabels[type] || type
}
