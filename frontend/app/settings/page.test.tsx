/**
 * Einstellungen — die drei Abschnitte, die schreiben oder filtern.
 *
 * Allgemein: ein Koordinatenwert ausserhalb des Bereichs wird NICHT gespeichert
 * und bleibt zum Korrigieren stehen; ein Komma wird zum Punkt. Import: Vorschau
 * im gewählten Modus, «Ersetzen» fragt vorher und nennt, was verloren geht.
 * Audit: die Filter gehen als Query an den Server, die Suche filtert lokal.
 *
 * Geschrieben als Sicherheitsnetz, bevor Import und Audit aus der 2100-Zeilen-
 * Seite in eigene Hooks und Komponenten wandern (2026-09-23).
 */

import { describe, expect, it, vi, beforeEach } from 'vitest'
import { screen, waitFor, within, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { renderWithIntl } from '@/test-utils/render-with-intl'

const params = vi.hoisted(() => ({ current: new URLSearchParams() }))
const push = vi.hoisted(() => vi.fn())
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: vi.fn() }),
  useSearchParams: () => params.current,
  usePathname: () => '/settings',
}))

vi.mock('@/lib/contexts/auth-context', () => ({
  useAuth: () => ({ isEditor: true, isAdmin: true, isAuthenticated: true }),
}))
vi.mock('@/lib/contexts/event-context', () => ({
  useEvent: () => ({
    events: [
      { id: 'evt-1', name: 'Sturm Ost', training_flag: false, archived_at: null },
    ],
    isLoading: false,
  }),
}))

const api = vi.hoisted(() => ({
  getDemoStatus: vi.fn(),
  getAllSettings: vi.fn(),
  updateSetting: vi.fn(),
  getAuditLogs: vi.fn(),
  getAllPersonnel: vi.fn(),
  getVehicles: vi.fn(),
  getAllMaterials: vi.fn(),
  previewExcelImport: vi.fn(),
  executeExcelImport: vi.fn(),
  exportEventAudit: vi.fn(),
}))
vi.mock('@/lib/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api-client')>()),
  apiClient: api,
}))

vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn(), info: vi.fn() }) }))

// Chrome and neighbours — not what this test is about.
vi.mock('@/components/protected-route', () => ({
  ProtectedRoute: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))
vi.mock('@/components/ui/use-mobile', () => ({ useIsMobile: () => false }))
vi.mock('@/components/page-navigation', () => ({ PageNavigation: () => null }))
vi.mock('@/components/mobile-bottom-navigation', () => ({ MobileBottomNavigation: () => null }))
vi.mock('@/components/settings/branding-settings', () => ({ BrandingSettings: () => null }))
vi.mock('@/lib/hooks/use-sync-status', () => ({
  useSyncStatus: () => ({ status: null, isLoading: false, error: null, isStale: false }),
}))
vi.mock('@/lib/hooks/use-railway-recovery', () => ({ useRailwayRecovery: () => {} }))
vi.mock('@/lib/hooks/use-tile-availability', () => ({
  useTileAvailability: () => ({ availability: { status: 'checking' }, recheck: vi.fn() }),
}))

import SettingsPage from '@/app/settings/page'

function openSection(section: string) {
  params.current = new URLSearchParams({ section })
  return renderWithIntl(<SettingsPage />)
}

beforeEach(() => {
  params.current = new URLSearchParams()
  push.mockReset()
  api.getDemoStatus.mockReset().mockResolvedValue(null)
  api.getAllSettings.mockReset().mockResolvedValue({ home_city: 'Oberwil', firestation_latitude: '47.5' })
  api.updateSetting.mockReset().mockImplementation(async (key: string, value: string) => ({ key, value }))
  api.getAuditLogs.mockReset().mockResolvedValue([])
  api.getAllPersonnel.mockReset().mockResolvedValue(new Array(18).fill({}))
  api.getVehicles.mockReset().mockResolvedValue(new Array(4).fill({}))
  api.getAllMaterials.mockReset().mockResolvedValue(new Array(30).fill({}))
  api.previewExcelImport.mockReset()
  api.executeExcelImport.mockReset()
  api.exportEventAudit.mockReset()
})

describe('Einstellungen › Allgemein — speichern', () => {
  it('stores a changed text value on blur, and nothing when it did not change', async () => {
    const user = userEvent.setup()
    openSection('general')
    const field = await screen.findByLabelText('Einsatzgebiet (Ort)')
    expect(field).toHaveValue('Oberwil')

    fireEvent.blur(field)
    expect(api.updateSetting).not.toHaveBeenCalled()

    await user.clear(field)
    await user.type(field, 'Therwil')
    fireEvent.blur(field)
    await waitFor(() => expect(api.updateSetting).toHaveBeenCalledWith('home_city', 'Therwil'))
    expect(api.updateSetting).toHaveBeenCalledTimes(1)
  })

  it('refuses an out-of-range coordinate, keeps it for correcting, and saves the fixed one with a dot', async () => {
    const user = userEvent.setup()
    openSection('general')
    const field = await screen.findByLabelText('Magazin – Breitengrad')

    await user.clear(field)
    await user.type(field, '95')
    fireEvent.blur(field)
    expect(await screen.findByText('Muss zwischen -90 und 90 liegen.')).toBeInTheDocument()
    expect(field).toHaveAttribute('aria-invalid', 'true')
    expect(field).toHaveValue('95')
    expect(api.updateSetting).not.toHaveBeenCalled()

    await user.clear(field)
    await user.type(field, 'abc')
    fireEvent.blur(field)
    expect(await screen.findByText('Keine gültige Zahl.')).toBeInTheDocument()
    expect(api.updateSetting).not.toHaveBeenCalled()

    // Typing clears the error; a comma decimal is saved as a dot.
    await user.clear(field)
    expect(screen.queryByText('Keine gültige Zahl.')).not.toBeInTheDocument()
    await user.type(field, '47,5164')
    fireEvent.blur(field)
    await waitFor(() => expect(api.updateSetting).toHaveBeenCalledWith('firestation_latitude', '47.5164'))
    expect(field).toHaveValue('47.5164')
  })
})

const PREVIEW = {
  mode: 'replace',
  personnel_total: 2,
  vehicles_total: 0,
  materials_total: 0,
  personnel_preview: [
    { name: 'Neu Eins', role: 'AdF', status: 'available' },
    { name: 'Neu Zwei', role: null, status: 'available' },
  ],
  vehicles_preview: [],
  materials_preview: [],
  deletions: {
    personnel: 18,
    vehicles: 4,
    materials: 30,
    incident_assignments: 5,
    active_incident_assignments: 0,
  },
}

async function chooseFile(user: ReturnType<typeof userEvent.setup>) {
  const input = document.getElementById('file-upload') as HTMLInputElement
  await user.upload(input, new File(['x'], 'roster.xlsx'))
  expect(await screen.findByText('roster.xlsx')).toBeInTheDocument()
}

describe('Einstellungen › Import — Vorschau, dann Ersetzen mit Rückfrage', () => {
  it('previews in the chosen mode and asks before replacing, naming what is lost', async () => {
    const user = userEvent.setup()
    api.previewExcelImport.mockResolvedValue(PREVIEW)
    api.executeExcelImport.mockResolvedValue({ counts: { personnel: 2, vehicles: 0, materials: 0 } })
    openSection('import')

    // The stock is counted on open, so the mode buttons can state their price.
    await waitFor(() => expect(api.getAllPersonnel).toHaveBeenCalled())
    // `append` is the default.
    expect(screen.getByRole('button', { name: /Anhängen/, pressed: true })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Ersetzen/, pressed: false }))
    expect(screen.getByText('Import – Modus «Ersetzen»')).toBeInTheDocument()

    await chooseFile(user)
    await user.click(screen.getByRole('button', { name: 'Vorschau anzeigen' }))
    expect(api.previewExcelImport).toHaveBeenCalledWith(expect.objectContaining({ name: 'roster.xlsx' }), 'replace')
    expect(await screen.findByText('Neu Eins')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Bestand löschen und ersetzen' }))
    const dialog = await screen.findByRole('alertdialog')
    expect(within(dialog).getByText('Datenimport ersetzen?')).toBeInTheDocument()
    // Both halves of the trade: what arrives, and what leaves.
    expect(dialog).toHaveTextContent('Importiert werden 2 Personal, 0 Fahrzeuge, 0 Material.')
    expect(dialog).toHaveTextContent('Gelöscht werden 18 Personal, 4 Fahrzeuge, 30 Material – und 5 Zuteilungen zeigen danach ins Leere.')
    expect(api.executeExcelImport).not.toHaveBeenCalled()

    await user.click(within(dialog).getByRole('button', { name: 'Daten ersetzen' }))
    await waitFor(() =>
      expect(api.executeExcelImport).toHaveBeenCalledWith(expect.objectContaining({ name: 'roster.xlsx' }), 'replace'),
    )
    expect(await screen.findByText('Import erfolgreich! 2 Personal, 0 Fahrzeuge, 0 Material importiert.')).toBeInTheDocument()
  })

  it('cancelling the question imports nothing; «Stattdessen anhängen» switches the mode and drops the preview', async () => {
    const user = userEvent.setup()
    api.previewExcelImport.mockResolvedValue(PREVIEW)
    openSection('import')
    await user.click(await screen.findByRole('button', { name: /Ersetzen/, pressed: false }))
    await chooseFile(user)
    await user.click(screen.getByRole('button', { name: 'Vorschau anzeigen' }))
    await screen.findByText('Neu Eins')

    await user.click(screen.getByRole('button', { name: 'Bestand löschen und ersetzen' }))
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Abbrechen' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    expect(api.executeExcelImport).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Bestand löschen und ersetzen' }))
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Stattdessen anhängen' }))
    expect(await screen.findByText('Import – Modus «Anhängen»')).toBeInTheDocument()
    // A preview carries mode-specific deletion figures; it cannot outlive its mode.
    expect(screen.queryByText('Neu Eins')).not.toBeInTheDocument()
    expect(api.executeExcelImport).not.toHaveBeenCalled()
  })

  it('refuses «Ersetzen» outright while live incidents hold assignments', async () => {
    const user = userEvent.setup()
    api.previewExcelImport.mockResolvedValue({
      ...PREVIEW,
      deletions: { ...PREVIEW.deletions, active_incident_assignments: 3 },
    })
    openSection('import')
    await user.click(await screen.findByRole('button', { name: /Ersetzen/, pressed: false }))
    await chooseFile(user)
    await user.click(screen.getByRole('button', { name: 'Vorschau anzeigen' }))
    await screen.findByText('Neu Eins')

    const blocked = screen.getByRole('button', { name: 'Bestand löschen und ersetzen' })
    expect(blocked).toBeDisabled()
    expect(blocked).toHaveAttribute('title', '3 aktive Zuteilungen auf laufenden Einsätzen – «Ersetzen» wird abgelehnt.')
  })

  it('appends without asking', async () => {
    const user = userEvent.setup()
    api.previewExcelImport.mockResolvedValue({ ...PREVIEW, mode: 'append' })
    api.executeExcelImport.mockResolvedValue({ counts: { personnel: 2, vehicles: 0, materials: 0 } })
    openSection('import')
    await chooseFile(user)
    await user.click(screen.getByRole('button', { name: 'Vorschau anzeigen' }))
    expect(api.previewExcelImport).toHaveBeenCalledWith(expect.anything(), 'append')
    await user.click(await screen.findByRole('button', { name: 'Jetzt importieren' }))
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    await waitFor(() => expect(api.executeExcelImport).toHaveBeenCalledWith(expect.anything(), 'append'))
  })
})

const AUDIT = [
  { id: 'a1', timestamp: '2026-09-23T08:00:00Z', action_type: 'create', resource_type: 'incident', resource_id: 'inc-12345678', user_id: 'user-aaaaaaaa', ip_address: '10.0.0.1', changes_json: null },
  { id: 'a2', timestamp: '2026-09-23T08:01:00Z', action_type: 'delete', resource_type: 'vehicle', resource_id: 'veh-1', user_id: null, ip_address: '10.0.0.2', changes_json: null },
  // Read noise never shows.
  { id: 'a3', timestamp: '2026-09-23T08:02:00Z', action_type: 'get_request', resource_type: 'api', resource_id: null, user_id: null, ip_address: null, changes_json: null },
]

describe('Einstellungen › Audit — Filter gehen an den Server, die Suche nicht', () => {
  it('asks for the last 100 rows, then narrows by resource on the server', async () => {
    const user = userEvent.setup()
    api.getAuditLogs.mockResolvedValue(AUDIT)
    openSection('audit')
    await waitFor(() => expect(api.getAuditLogs).toHaveBeenCalledWith({ limit: 100 }))
    expect(await screen.findByText('2 Einträge')).toBeInTheDocument()

    const [resourceSelect] = screen.getAllByRole('combobox').filter((el) => el.textContent === 'Alle Ressourcen')
    await user.click(resourceSelect)
    await user.click(await screen.findByRole('option', { name: 'incident' }))
    await waitFor(() => expect(api.getAuditLogs).toHaveBeenLastCalledWith({ limit: 100, resource_type: 'incident' }))

    await user.click(screen.getByRole('button', { name: 'Filter zurücksetzen' }))
    await waitFor(() => expect(api.getAuditLogs).toHaveBeenLastCalledWith({ limit: 100 }))
  })

  it('narrows by action on the server too', async () => {
    const user = userEvent.setup()
    api.getAuditLogs.mockResolvedValue(AUDIT)
    openSection('audit')
    await screen.findByText('2 Einträge')
    const [actionSelect] = screen.getAllByRole('combobox').filter((el) => el.textContent === 'Alle Aktionen')
    await user.click(actionSelect)
    await user.click(await screen.findByRole('option', { name: 'delete' }))
    await waitFor(() => expect(api.getAuditLogs).toHaveBeenLastCalledWith({ limit: 100, action_type: 'delete' }))
  })

  it('searches the loaded rows locally, without a request', async () => {
    const user = userEvent.setup()
    api.getAuditLogs.mockResolvedValue(AUDIT)
    openSection('audit')
    await screen.findByText('2 Einträge')
    const calls = api.getAuditLogs.mock.calls.length

    await user.type(screen.getByPlaceholderText('Suche nach Aktion, Ressource, ID, Benutzer oder IP …'), '10.0.0.2')
    expect(await screen.findByText('1 Eintrag')).toBeInTheDocument()
    await user.clear(screen.getByPlaceholderText('Suche nach Aktion, Ressource, ID, Benutzer oder IP …'))
    await user.type(screen.getByPlaceholderText('Suche nach Aktion, Ressource, ID, Benutzer oder IP …'), 'nothing-matches')
    expect(await screen.findByText('Keine Einträge gefunden.')).toBeInTheDocument()
    expect(api.getAuditLogs).toHaveBeenCalledTimes(calls)
  })
})
