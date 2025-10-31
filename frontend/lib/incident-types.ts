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

// Get all incident type keys for dropdowns, sorted alphabetically with Elementarereignis first
export const incidentTypeKeys = (() => {
  const keys = Object.keys(incidentTypeLabels)

  // Sort alphabetically by German label
  const sorted = keys.sort((a, b) =>
    incidentTypeLabels[a].localeCompare(incidentTypeLabels[b], 'de')
  )

  // Move Elementarereignis to the front
  const elementarIndex = sorted.indexOf('elementarereignis')
  if (elementarIndex > -1) {
    sorted.splice(elementarIndex, 1)
    sorted.unshift('elementarereignis')
  }

  return sorted
})()

// Helper function to format incident types to German labels
export function getIncidentTypeLabel(type: string): string {
  return incidentTypeLabels[type] || type
}
