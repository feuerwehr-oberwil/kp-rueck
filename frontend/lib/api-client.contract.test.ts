import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * The client's contract with the backend, pinned from the outside.
 *
 * About 40 test files mock `@/lib/api-client` by method name, and every page
 * builds on the paths and bodies below. Splitting the 2900-line client (types,
 * transport, domain methods) must change none of it: not a method name, not a
 * trailing slash — `/api/personnel` without one answers 307 and a redirected
 * POST loses its body (CLAUDE.md) — and not the transport's retry, toast and
 * session-expiry rules. Every row states what goes over the wire.
 */

vi.mock('@/lib/env', () => ({
  getApiUrl: () => 'http://test-backend',
}))

const toast = vi.hoisted(() =>
  Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn(), dismiss: vi.fn() }),
)
vi.mock('sonner', () => ({ toast }))

import { apiClient, ApiError, getRestReachable, onRestReachableChange } from './api-client'

const BASE = 'http://test-backend'

// The class's own plumbing. TypeScript `private` is not private at runtime, so
// these show up on the prototype; they are free to move.
const INTERNAL = new Set(['feldQuery', 'getBackoffDelay', 'getBaseUrl', 'request', 'sleep', 'uploadPhotoFile'])

function json(body: unknown = {}, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    ...init,
    headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
  })
}

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  fetchMock = vi.fn(async () => json())
  vi.stubGlobal('fetch', fetchMock)
  toast.error.mockClear()
  toast.dismiss.mockClear()
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

interface Sent {
  method: string
  path: string
  body: unknown
  init: RequestInit
}

function sent(index = -1): Sent {
  const calls = fetchMock.mock.calls
  const [url, init = {}] = calls.at(index) as [string, RequestInit | undefined]
  const raw = init.body
  let body: unknown = undefined
  if (typeof raw === 'string') body = JSON.parse(raw)
  else if (raw instanceof FormData) body = Object.fromEntries([...raw.entries()].map(([k, v]) => [k, typeof v === 'string' ? v : (v as File).name]))
  return { method: init.method ?? 'GET', path: url.startsWith(BASE) ? url.slice(BASE.length) : url, body, init }
}

describe('apiClient — the method names callers (and their mocks) rely on', () => {
  it('keeps every public method, and adds none silently', () => {
    const names = Object.getOwnPropertyNames(Object.getPrototypeOf(apiClient))
      .filter((name) => name !== 'constructor' && !INTERNAL.has(name))
      .sort()
    expect(names).toEqual([
    'addStopsToGroup', 'applyRapportMaterialDecisions', 'archiveDiveraEmergency', 'archiveEvent',
    'archiveMaterialResource', 'archiveVehicle', 'assignGroupResource', 'assignRekoPersonnel',
    'assignResource', 'assignSpecialFunction', 'attachEmergencyToEvent', 'bulkAttachEmergencies',
    'checkInPersonnel', 'checkInPersonnelForEvent', 'checkOutAllPersonnel', 'checkOutPersonnel',
    'checkOutPersonnelForEvent', 'claimFeldPerson', 'claimSetup', 'clearPersonnelAttendance',
    'createAuftragTemplate', 'createDemoSandbox', 'createEvent', 'createFeldIncident', 'createIncident',
    'createIncidentGroup', 'createIntakeAlarm', 'createMaterialGroup', 'createMaterialResource',
    'createPersonnel', 'createRekoReportAsEditor', 'createUser', 'createVehicle', 'deleteAuftragTemplate',
    'deleteEvent', 'deleteFeldPhoto', 'deleteIncident', 'deleteIncidentGroup', 'deleteMaterialGroup',
    'deleteMaterialResource', 'deletePersonnel', 'deletePrintJob', 'deleteRapportPhoto', 'deleteRekoPhoto',
    'deleteRekoPhotoAsEditor', 'deleteReportLogo', 'deleteUser', 'deleteVehicle', 'downloadImportTemplate',
    'executeDiveraSync', 'executeExcelImport', 'exportAllData', 'exportEventAudit', 'exportEventEinsaetze',
    'exportEventLageblatt', 'exportEventReport', 'feldPhotoUrl', 'feldReportArrived', 'feldReportComplete',
    'feldReportPickup', 'feldSendMessage', 'generateAlarmLink', 'generateCheckInLink', 'generateFeldLink',
    'generateRekoLink', 'generateTrainingEmergency', 'generateViewerLink', 'getAlarmWebhookSecret',
    'getAllMaterials', 'getAllPersonnel', 'getAllSettings', 'getAssignmentsByEvent', 'getAuditLogs',
    'getAuftragTemplates', 'getAvailableRekoPersonnel', 'getCheckInList', 'getCheckInStats', 'getDemoStatus',
    'getDeployment', 'getDiveraEmergencies', 'getDiveraEmergency', 'getDiveraGroups', 'getDiveraMembers',
    'getDiveraPollingStatus', 'getDiveraSyncPreview', 'getEmergencyTemplates', 'getEvent',
    'getEventAttendance', 'getEventCheckInList', 'getEventCheckInStats', 'getEventRekoSummaries',
    'getEventRestliste', 'getEventSpecialFunctions', 'getEventStats', 'getEvents', 'getFeldAccess',
    'getFeldAssignments', 'getFeldContext', 'getFeldMaterial', 'getFeldPersonnel', 'getFeldRapport',
    'getGpsSimulations', 'getGroupAssignments', 'getIncident', 'getIncidentAssignments', 'getIncidentGroups',
    'getIncidentParticipants', 'getIncidentRapport', 'getIncidentRekoReports', 'getIncidentStatusHistory',
    'getIncidentTimeline', 'getIncidents', 'getIncidentsWithTotal', 'getIntakeContext', 'getIntegrations',
    'getKpFieldMessages', 'getMaterialById', 'getMaterialGroups', 'getPendingPrintJobs', 'getPersonnelById',
    'getPersonnelSpecialFunctions', 'getPrintJob', 'getPrinterStatus', 'getRapportMaterialReturn',
    'getRekoForm', 'getReportLogoUrl', 'getResourceHistory', 'getSetting', 'getSetupStatus', 'getSyncConfig',
    'getSyncHistory', 'getSyncStatus', 'getSyncVersion', 'getTraccarStatus', 'getTrainingLocations',
    'getUser', 'getUsers', 'getVehicleById', 'getVehiclePositions', 'getVehicleStatus', 'getVehicleTrails',
    'getVehicles', 'getViewerData', 'logoutFeld', 'manualDispatch', 'markRekoArrived', 'mintFeldRekoLink',
    'previewExcelImport', 'queueAbhollistePrint', 'queueAssignmentPrint', 'queueBoardPrint',
    'queueQRCodePrint', 'queueTestPrint', 'recordGroupAnnouncement', 'regenerateFeldCode',
    'releaseAllResources', 'removeStopFromGroup', 'reorderAuftragTemplates', 'reorderGroupStops',
    'reorderIncidentGroups', 'reorderIncidents', 'resetUserPassword', 'restoreIncident',
    'restoreMaterialResource', 'restoreVehicle', 'revokeFeldDevices', 'rotateAlarmWebhookSecret',
    'saveFeldRapport', 'saveIncidentRapport', 'saveRekoDraft', 'sendDiveraMessage', 'sendDiveraTestAlarm',
    'sendIncidentDiveraAlarm', 'sendKpFieldMessage', 'setFeldAttendance', 'setGpsSimulationSpeed',
    'setIncidentFieldReport', 'setRekoArrived', 'simulateCheckin', 'simulateDiveraAlarm',
    'simulateEscalation', 'simulateFieldArrived', 'simulateFieldComplete', 'simulateFieldMessage',
    'simulateFieldReport', 'simulatePickup', 'simulateRapport', 'simulateRapportsBulk',
    'simulateReinforcement', 'simulateReko', 'simulateRekoArrived', 'simulateVehicleBreakdown',
    'startGpsSimulation', 'stopGpsSimulation', 'submitRekoReport', 'transferAssignments',
    'transferRekoAssignments', 'triggerImmediateSync', 'triggerSyncFromRailway', 'triggerSyncToRailway',
    'unarchiveEvent', 'unassignGroupResource', 'unassignRekoPersonnel', 'unassignResource',
    'unassignSpecialFunction', 'unlockFeld', 'updateAssignment', 'updateAuftragTemplate', 'updateEvent',
    'updateFeldReport', 'updateGroupAssignment', 'updateIncident', 'updateIncidentGroup',
    'updateIncidentStatus', 'updateMaterialCategorySortOrder', 'updateMaterialGroup',
    'updateMaterialResource', 'updatePersonnel', 'updatePersonnelCategorySortOrder', 'updateRekoReport',
    'updateSetting', 'updateSyncConfig', 'updateUser', 'updateVehicle', 'uploadFeldPhoto',
    'uploadRapportPhoto', 'uploadRekoPhoto', 'uploadRekoPhotoAsEditor', 'uploadReportLogo',
    ])
  })
})

// [method name, call, expected method, expected path + query, expected JSON body]
// A payload the client passes through untouched is typed `as never`: the row
// asserts the pass-through, not the schema.
type Row = [string, () => Promise<unknown>, string, string, unknown?]

const rows: Row[] = [
  // Settings / events
  ['getAllSettings', () => apiClient.getAllSettings(), 'GET', '/api/settings/'],
  ['updateSetting', () => apiClient.updateSetting('home_city', 'Oberwil'), 'PATCH', '/api/settings/home_city', { value: 'Oberwil' }],
  ['getEvents', () => apiClient.getEvents(), 'GET', '/api/events/'],
  ['getEvents(archived)', () => apiClient.getEvents(true), 'GET', '/api/events/?include_archived=true'],
  ['archiveEvent', () => apiClient.archiveEvent('e1', { checkoutAttendees: true }), 'POST', '/api/events/e1/archive?checkout_attendees=true'],
  ['unassignSpecialFunction', () => apiClient.unassignSpecialFunction('e1', { personnel_id: 'p1', function_type: 'driver' } as never), 'DELETE', '/api/events/e1/special-functions/', { personnel_id: 'p1', function_type: 'driver' }],
  // Incidents
  ['getIncidents', () => apiClient.getIncidents('e1', { status: 'active', skip: 0, limit: 50 }), 'GET', '/api/incidents/?event_id=e1&status=active&skip=0&limit=50'],
  ['updateIncident', () => apiClient.updateIncident('i1', { priority: 'high' }, '2026-09-23T08:00:00+00:00'), 'PATCH', '/api/incidents/i1?expected_updated_at=2026-09-23T08%3A00%3A00%2B00%3A00', { priority: 'high' }],
  ['reorderIncidents', () => apiClient.reorderIncidents('e1', ['a', 'b']), 'POST', '/api/incidents/reorder', { event_id: 'e1', ordered_ids: ['a', 'b'] }],
  ['updateIncidentStatus', () => apiClient.updateIncidentStatus('i1', 'incoming', 'enroute', 'Funk'), 'POST', '/api/incidents/i1/status', { from_status: 'incoming', to_status: 'enroute', notes: 'Funk' }],
  ['transferAssignments', () => apiClient.transferAssignments('i1', 'i2'), 'POST', '/api/incidents/i1/transfer', { target_incident_id: 'i2' }],
  ['updateAssignment', () => apiClient.updateAssignment('i1', 'a1', { driver_stay: true }), 'PATCH', '/api/incidents/i1/assignments/a1', { driver_stay: true }],
  ['getSyncVersion', () => apiClient.getSyncVersion('e 1'), 'GET', '/api/incidents/sync-version?event_id=e%201'],
  ['setRekoArrived(now)', () => apiClient.setRekoArrived('i1'), 'POST', '/api/incidents/i1/reko-arrived', {}],
  ['setRekoArrived(clear)', () => apiClient.setRekoArrived('i1', null), 'POST', '/api/incidents/i1/reko-arrived', { arrived_at: null }],
  // Aufträge
  ['getIncidentGroups', () => apiClient.getIncidentGroups('e 1'), 'GET', '/api/incident-groups/?event_id=e%201'],
  ['reorderIncidentGroups', () => apiClient.reorderIncidentGroups('e1', ['g2', 'g1']), 'POST', '/api/incident-groups/reorder', { event_id: 'e1', ordered_ids: ['g2', 'g1'] }],
  ['reorderGroupStops', () => apiClient.reorderGroupStops('g1', ['i2', 'i1']), 'POST', '/api/incident-groups/g1/stops/reorder', { ordered_ids: ['i2', 'i1'] }],
  ['addStopsToGroup', () => apiClient.addStopsToGroup('g1', ['i1']), 'POST', '/api/incident-groups/g1/stops', { incident_ids: ['i1'] }],
  ['removeStopFromGroup', () => apiClient.removeStopFromGroup('g1', 'i1'), 'DELETE', '/api/incident-groups/g1/stops/i1'],
  ['assignGroupResource', () => apiClient.assignGroupResource('g1', { resource_type: 'vehicle', resource_id: 'v1' } as never), 'POST', '/api/incident-groups/g1/assign', { resource_type: 'vehicle', resource_id: 'v1' }],
  ['unassignGroupResource', () => apiClient.unassignGroupResource('g1', 'a1'), 'POST', '/api/incident-groups/g1/unassign/a1'],
  ['reorderAuftragTemplates', () => apiClient.reorderAuftragTemplates(['t1', 't2']), 'POST', '/api/auftrag-templates/reorder', { template_ids: ['t1', 't2'] }],
  // Resources — the trailing slash on the collections is load-bearing.
  ['getAllPersonnel', () => apiClient.getAllPersonnel({ checked_in_only: true, event_id: 'e1' }), 'GET', '/api/personnel/?checked_in_only=true&event_id=e1'],
  ['getEventAttendance', () => apiClient.getEventAttendance('e1'), 'GET', '/api/personnel/?event_id=e1'],
  ['createPersonnel', () => apiClient.createPersonnel({ name: 'Muster' } as never), 'POST', '/api/personnel/', { name: 'Muster' }],
  ['getVehicles(archived)', () => apiClient.getVehicles({ includeArchived: true }), 'GET', '/api/vehicles/?include_archived=true'],
  ['deleteVehicle(permanent)', () => apiClient.deleteVehicle('v1', { permanent: true }), 'DELETE', '/api/vehicles/v1?permanent=true'],
  ['getVehicleStatus', () => apiClient.getVehicleStatus('v1', 'e1'), 'GET', '/api/vehicles/v1/status?event_id=e1'],
  ['updateMaterialResource', () => apiClient.updateMaterialResource('m1', { out_of_service: true } as never), 'PUT', '/api/materials/m1', { out_of_service: true }],
  ['assignResource', () => apiClient.assignResource('i1', { resource_type: 'personnel', resource_id: 'p1' } as never), 'POST', '/api/incidents/i1/assign', { resource_type: 'personnel', resource_id: 'p1' }],
  ['unassignResource', () => apiClient.unassignResource('i1', 'a1'), 'POST', '/api/incidents/i1/unassign/a1'],
  ['getAssignmentsByEvent', () => apiClient.getAssignmentsByEvent('e1'), 'GET', '/api/assignments/by-event/e1'],
  // Check-in
  ['generateCheckInLink', () => apiClient.generateCheckInLink('e1'), 'POST', '/api/personnel/check-in/generate-link?event_id=e1'],
  ['getCheckInList', () => apiClient.getCheckInList('t/1', true), 'GET', '/api/personnel/check-in/list?token=t%2F1&checked_in_only=true'],
  ['checkOutPersonnelForEvent', () => apiClient.checkOutPersonnelForEvent('p1', 'e1'), 'POST', '/api/personnel/check-in/p1/out?event_id=e1'],
  ['clearPersonnelAttendance', () => apiClient.clearPersonnelAttendance('p1', 'e1'), 'DELETE', '/api/personnel/check-in/p1?event_id=e1'],
  ['checkOutAllPersonnel', () => apiClient.checkOutAllPersonnel('e1'), 'POST', '/api/personnel/check-in/event/e1/out-all'],
  // Reko
  ['generateRekoLink', () => apiClient.generateRekoLink('i1', 'p1'), 'POST', '/api/reko/generate-link?incident_id=i1&personnel_id=p1'],
  ['getRekoForm', () => apiClient.getRekoForm('i1', 'tok', 'p1'), 'GET', '/api/reko/form?incident_id=i1&token=tok&personnel_id=p1'],
  ['submitRekoReport', () => apiClient.submitRekoReport('i1', 'tok', { is_relevant: true } as never), 'POST', '/api/reko/?submit=true', { is_relevant: true, incident_id: 'i1', token: 'tok' }],
  ['saveRekoDraft', () => apiClient.saveRekoDraft('i1', 'tok', { is_relevant: true } as never), 'POST', '/api/reko/?submit=false', { is_relevant: true, incident_id: 'i1', token: 'tok' }],
  ['updateRekoReport', () => apiClient.updateRekoReport('r1', { summary_text: 'x' } as never, { submit: true, token: 'tok' }), 'PATCH', '/api/reko/r1?submit=true', { summary_text: 'x' }],
  ['deleteRekoPhoto', () => apiClient.deleteRekoPhoto('i1', 'tok', 'a.jpg'), 'DELETE', '/api/reko/i1/photos/a.jpg'],
  // Audit
  ['getAuditLogs', () => apiClient.getAuditLogs({ resource_type: 'incident', limit: 100 }), 'GET', '/api/audit?resource_type=incident&limit=100'],
  ['getAuditLogs(none)', () => apiClient.getAuditLogs(), 'GET', '/api/audit'],
  // Feld — the token is always URL-encoded, and so is the personnel id in `feldQuery`.
  ['claimFeldPerson', () => apiClient.claimFeldPerson('t/x', 'p1'), 'POST', '/api/feld/claim?token=t%2Fx', { personnel_id: 'p1' }],
  ['createFeldIncident', () => apiClient.createFeldIncident('p1', 't', { title: 'Keller' } as never), 'POST', '/api/feld/incidents?token=t&personnel_id=p1', { title: 'Keller' }],
  ['setFeldAttendance', () => apiClient.setFeldAttendance('p1', 't', false), 'POST', '/api/feld/attendance/p1?token=t&present=false'],
  ['getFeldAssignments', () => apiClient.getFeldAssignments('p1', 't/x'), 'GET', '/api/feld/assignments/p1?token=t%2Fx'],
  ['feldReportArrived', () => apiClient.feldReportArrived('i1', 'p 1', 't/x'), 'POST', '/api/feld/incidents/i1/arrived?token=t%2Fx&personnel_id=p%201'],
  ['feldReportPickup', () => apiClient.feldReportPickup('i1', 'p1', 't', true), 'POST', '/api/feld/incidents/i1/pickup?token=t&personnel_id=p1', { needed: true, note: null }],
  ['saveFeldRapport', () => apiClient.saveFeldRapport('i1', 'p1', 't', { summary: 'ok' } as never), 'PUT', '/api/feld/incidents/i1/rapport?token=t&personnel_id=p1', { summary: 'ok' }],
  ['deleteFeldPhoto', () => apiClient.deleteFeldPhoto('i1', 'p1', 't', 'a b.jpg'), 'DELETE', '/api/feld/incidents/i1/photos/a%20b.jpg?token=t&personnel_id=p1'],
  ['setIncidentFieldReport', () => apiClient.setIncidentFieldReport('i1', { kind: 'arrived' } as never), 'POST', '/api/incidents/i1/field-report', { kind: 'arrived' }],
  // Print / users / setup
  ['queueBoardPrint', () => apiClient.queueBoardPrint('e1', { include_incidents: true }), 'POST', '/api/print/board/', { event_id: 'e1', include_incidents: true }],
  ['deletePrintJob', () => apiClient.deletePrintJob('j1'), 'DELETE', '/api/print/jobs/j1/'],
  ['resetUserPassword', () => apiClient.resetUserPassword('u1', 'geheim'), 'POST', '/api/users/u1/reset-password', { new_password: 'geheim' }],
  ['deleteUser(permanent)', () => apiClient.deleteUser('u1', true), 'DELETE', '/api/users/u1?permanent=true'],
  ['createDemoSandbox', () => apiClient.createDemoSandbox(), 'POST', '/api/demo/sandbox'],
  ['claimSetup', () => apiClient.claimSetup({ username: 'admin' } as never), 'POST', '/api/setup', { username: 'admin' }],
]

describe('apiClient — what each method sends', () => {
  it.each(rows)('%s', async (_name, call, method, path, body) => {
    await call()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const request = sent()
    expect(request.method).toBe(method)
    expect(request.path).toBe(path)
    expect(request.body).toEqual(body)
    // Every call carries the session cookie and a timeout.
    expect(request.init.credentials).toBe('include')
    expect(request.init.signal).toBeInstanceOf(AbortSignal)
    expect((request.init.headers as Record<string, string>)['Content-Type']).toBe('application/json')
  })

  it('board edits are keepalive, so a PATCH flushed on pagehide outlives the tab', async () => {
    await apiClient.updateIncident('i1', { priority: 'low' })
    expect(sent().path).toBe('/api/incidents/i1')
    expect(sent().init.keepalive).toBe(true)
  })

  it('the Reko token travels as a header, never in the body', async () => {
    await apiClient.updateRekoReport('r1', {} as never, { token: 'tok' })
    expect(sent().path).toBe('/api/reko/r1?submit=false')
    expect((sent().init.headers as Record<string, string>)['X-Reko-Token']).toBe('tok')
    await apiClient.deleteRekoPhoto('i1', 'tok', 'a.jpg')
    expect((sent().init.headers as Record<string, string>)['X-Reko-Token']).toBe('tok')
  })

  it('the Feld-Code goes to /unlock as JSON, outside the retrying transport', async () => {
    await apiClient.unlockFeld('t/x', '1234')
    const request = sent()
    expect(request.method).toBe('POST')
    expect(request.path).toBe('/api/feld/unlock?token=t%2Fx')
    expect(request.body).toEqual({ code: '1234' })
    expect(request.init.credentials).toBe('include')
  })

  it('the Excel preview posts the file and the mode as multipart', async () => {
    await apiClient.previewExcelImport(new File(['x'], 'roster.xlsx'), 'append')
    const request = sent()
    expect(request.method).toBe('POST')
    expect(request.path).toBe('/api/admin/import/preview')
    expect(request.body).toEqual({ file: 'roster.xlsx', mode: 'append' })
  })

  it('URL builders fetch nothing and name the same paths', () => {
    expect(apiClient.getReportLogoUrl()).toBe(`${BASE}/api/settings/branding/logo`)
    expect(apiClient.getReportLogoUrl(7)).toBe(`${BASE}/api/settings/branding/logo?v=7`)
    expect(apiClient.feldPhotoUrl('i1', 'p1', 't/x', 'a b.jpg')).toBe(
      `${BASE}/api/feld/incidents/i1/photos/a%20b.jpg?token=t%2Fx&personnel_id=p1`,
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('reads the total the board needs off X-Total-Count', async () => {
    fetchMock.mockResolvedValueOnce(json([], { headers: { 'X-Total-Count': '42' } }))
    await expect(apiClient.getIncidentsWithTotal('e1')).resolves.toEqual({ incidents: [], total: 42 })
    expect(sent().path).toBe('/api/incidents/?event_id=e1')
  })
})

describe('apiClient — the transport rules every method inherits', () => {
  it('retries a GET three times on a 5xx, then throws the server detail', async () => {
    vi.useFakeTimers()
    fetchMock.mockImplementation(async () => json({ detail: 'kaputt' }, { status: 503 }))
    const promise = apiClient.getAllSettings()
    const assertion = expect(promise).rejects.toMatchObject({ status: 503, message: 'kaputt' })
    await vi.runAllTimersAsync()
    await assertion
    expect(fetchMock).toHaveBeenCalledTimes(4)
    expect(toast.error).toHaveBeenCalledTimes(1)
  })

  it('retries a mutation once, not three times', async () => {
    vi.useFakeTimers()
    fetchMock.mockImplementation(async () => json({}, { status: 502 }))
    const promise = apiClient.reorderIncidents('e1', [])
    const assertion = expect(promise).rejects.toBeInstanceOf(ApiError)
    await vi.runAllTimersAsync()
    await assertion
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('does not retry a 4xx', async () => {
    fetchMock.mockImplementation(async () => json({ detail: 'weg' }, { status: 404 }))
    await expect(apiClient.getIncident('i1')).rejects.toMatchObject({ status: 404, message: 'weg' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('a 409 is the caller\'s to explain: no generic toast', async () => {
    fetchMock.mockImplementation(async () => json({ detail: 'veraltet' }, { status: 409 }))
    await expect(apiClient.updateIncident('i1', {})).rejects.toMatchObject({ status: 409, isConflict: true })
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('a 401 announces the expired session instead of toasting', async () => {
    const dispatch = vi.spyOn(window, 'dispatchEvent')
    fetchMock.mockImplementation(async () => json({ detail: 'nope' }, { status: 401 }))
    await expect(apiClient.getUsers()).rejects.toMatchObject({ status: 401 })
    expect(dispatch.mock.calls.some(([event]) => event.type === 'kp:session-expired')).toBe(true)
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('skipToast keeps a failure quiet', async () => {
    fetchMock.mockImplementation(async () => json({ detail: 'x' }, { status: 400 }))
    await expect(apiClient.rotateAlarmWebhookSecret()).rejects.toBeInstanceOf(ApiError)
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('a 204 or a non-JSON answer resolves to undefined', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }))
    await expect(apiClient.deleteIncident('i1')).resolves.toBeUndefined()
    fetchMock.mockResolvedValueOnce(new Response('ok', { status: 200, headers: { 'content-type': 'text/plain' } }))
    await expect(apiClient.getIncident('i1')).resolves.toBeUndefined()
  })

  it('an outage raises ONE persistent toast and flips reachability; the next answer clears both', async () => {
    vi.useFakeTimers()
    const seen: boolean[] = []
    const unsubscribe = onRestReachableChange((reachable) => seen.push(reachable))
    fetchMock.mockImplementation(async () => {
      throw new TypeError('Failed to fetch')
    })
    const first = apiClient.getAllSettings()
    const second = apiClient.getAllSettings()
    await vi.runAllTimersAsync()
    await expect(first).resolves.toBeUndefined()
    await expect(second).resolves.toBeUndefined()
    expect(getRestReachable()).toBe(false)
    expect(toast.error).toHaveBeenCalledTimes(1)
    expect(toast.error.mock.calls[0][1]).toMatchObject({ id: 'api-connection-lost', duration: Infinity })

    fetchMock.mockImplementation(async () => json())
    await apiClient.getAllSettings()
    expect(getRestReachable()).toBe(true)
    expect(toast.dismiss).toHaveBeenCalledWith('api-connection-lost')
    expect(seen).toEqual([false, true])
    unsubscribe()
  })
})
