import { describe, expect, it, vi } from 'vitest'

import {
  findVehiclesWithoutDriver,
  generateChecklistTasks,
  isTaskComplete,
  type ChecklistTaskState,
} from './checklist-tasks'

function tasks(overrides: Partial<Parameters<typeof generateChecklistTasks>[0]> = {}) {
  const noop = () => {}
  return generateChecklistTasks({
    eventId: 'e1',
    checkedInPersonnel: 0,
    totalVehicles: 3,
    driverAssignments: 0,
    rekoOfficers: 0,
    magazinStaff: 0,
    mapTilesAvailable: false,
    printerEnabled: false,
    printerAgentOnline: false,
    fallbackReady: false,
    onCopyCheckInLink: noop,
    onPrintCheckInLink: noop,
    onCopyRekoLink: noop,
    onPrintRekoLink: noop,
    onCopyAlarmLink: noop,
    onPrintAlarmLink: noop,
    onCopyFeldLink: noop,
    onPrintFeldLink: noop,
    onShowTileSetup: noop,
    onTestPrint: noop,
    onOpenFallbackSettings: noop,
    onOpenVehicles: noop,
    onAssignDrivers: noop,
    vehiclesWithoutDriver: 3,
    onOpenAttendance: noop,
    ...overrides,
  })
}

const byId = (id: string, list: ChecklistTaskState[]) => list.find(task => task.id === id)

describe('the setup checklist links into what it is asking for', () => {
  it('starts a driver run from the driver step, before offering the fleet', () => {
    // The row's promise is that every vehicle has a driver, so the first button
    // walks the ones that don't. Counting the gap and then making the operator go
    // and find each vehicle is the thing being fixed.
    const onAssignDrivers = vi.fn()
    const onOpenVehicles = vi.fn()
    const task = byId('assign-drivers', tasks({ onAssignDrivers, onOpenVehicles }))

    expect(task?.actionButtons).toHaveLength(2)
    task?.actionButtons?.[0].onClick?.()
    expect(onAssignDrivers).toHaveBeenCalledOnce()
    task?.actionButtons?.[1].onClick?.()
    expect(onOpenVehicles).toHaveBeenCalledOnce()
  })

  it('drops the driver run once every vehicle has somebody driving it', () => {
    // Nothing left to walk through, so the button would open an empty run. The
    // Fahrzeuge sheet stays — looking at the fleet is still a reasonable thing to do.
    const onOpenVehicles = vi.fn()
    const task = byId('assign-drivers', tasks({ vehiclesWithoutDriver: 0, onOpenVehicles }))

    expect(task?.actionButtons).toHaveLength(1)
    task?.actionButtons?.[0].onClick?.()
    expect(onOpenVehicles).toHaveBeenCalledOnce()
  })

  it('offers both ways into the check-in step', () => {
    // Hand the crew a link, or tick the names yourself when the phones are not an
    // option. The second button was defined but never drawn — the row renderer only
    // ever painted actionButtons[0].
    const onOpenAttendance = vi.fn()
    const task = byId('personnel-checkin', tasks({ onOpenAttendance }))

    expect(task?.actionButtons).toHaveLength(2)
    task?.actionButtons?.[1].onClick?.()
    expect(onOpenAttendance).toHaveBeenCalledOnce()
  })

  it('links the Reko step into the map’s Reko-Modus', () => {
    // Marking a person as Reko and handing them their first addresses happen in
    // the same panel, so the row goes there rather than describing it.
    expect(byId('assign-reko', tasks())?.actionButtons?.[0].href).toBe('/map?mode=reko')
  })

  it('leaves the Magazin step as plain text', () => {
    // A Magaziner is marked by right-clicking a person in the crew sidebar —
    // not a destination anything can navigate to. A button that opened
    // "somewhere near it" would be worse than the sentence.
    expect(byId('assign-magazin', tasks())?.actionButtons).toBeUndefined()
  })

  it('gives every other row an action or a deliberate reason not to', () => {
    // The WhatsApp row has the component's own two-message picker instead.
    const withoutAction = tasks()
      .filter(task => !task.actionButtons && !task.isWhatsApp)
      .map(task => task.id)
    expect(withoutAction).toEqual(['assign-magazin'])
  })
})

describe('the driver run covers exactly the vehicles nobody is driving', () => {
  const vehicles = [
    { id: 'v1', name: 'TLF 1' },
    { id: 'v2', name: 'DLK 2' },
    { id: 'v3', name: 'MTW 3' },
  ]

  it('keeps the listed order and skips the ones already driven', () => {
    const driven = [{ function_type: 'driver', vehicle_id: 'v2' }]
    expect(findVehiclesWithoutDriver(vehicles, driven)).toEqual([
      { vehicleId: 'v1', vehicleName: 'TLF 1' },
      { vehicleId: 'v3', vehicleName: 'MTW 3' },
    ])
  })

  it('ignores Reko and Magazin functions, which are not driving anything', () => {
    // They carry no vehicle_id, and counting them would hide a vehicle that still
    // needs a driver.
    const functions = [
      { function_type: 'reko', vehicle_id: null },
      { function_type: 'magazin', vehicle_id: null },
    ]
    expect(findVehiclesWithoutDriver(vehicles, functions)).toHaveLength(3)
  })

  it('returns nothing once every vehicle has a driver', () => {
    const driven = vehicles.map(v => ({ function_type: 'driver', vehicle_id: v.id }))
    expect(findVehiclesWithoutDriver(vehicles, driven)).toEqual([])
  })
})

describe('the four login-less links are all on the list', () => {
  // The Feld poster is the one a crew carries out of the door, and it was the one
  // missing here — the station's paper checklist said «Check-In, Telefonist und
  // Reko» because this list did. A crew that drove off without it has no way to
  // file a Schadenplatz-Rapport at all, which is what replaced the paper one.
  it('offers every link a crew or a caller needs, Feld included', () => {
    const ids = tasks().map(task => task.id)
    expect(ids).toEqual(
      expect.arrayContaining(['personnel-checkin', 'share-reko-link', 'share-alarm-link', 'share-feld-link'])
    )
  })

  it('names the Feld row from the catalogue, not from its own key', () => {
    // The row is built through `translateOutsideReact`, so a key that exists in
    // the code but not in messages/de.json renders the dotted path on the board.
    const task = byId('share-feld-link', tasks())
    expect(task?.title).toBe('Feld-Link teilen')
    expect(task?.description).not.toContain('checklist.tasks')
  })

  it('prints the Feld QR when a printer is reachable, and copies the link when it is not', () => {
    const onPrintFeldLink = vi.fn()
    const onCopyFeldLink = vi.fn()
    const args = { onPrintFeldLink, onCopyFeldLink }

    byId('share-feld-link', tasks({ ...args, printerEnabled: true, printerAgentOnline: true }))
      ?.actionButtons?.[0].onClick?.()
    expect(onPrintFeldLink).toHaveBeenCalledOnce()
    expect(onCopyFeldLink).not.toHaveBeenCalled()

    // Agent down: the row must still hand over the link rather than going dead.
    byId('share-feld-link', tasks({ ...args, printerEnabled: true, printerAgentOnline: false }))
      ?.actionButtons?.[0].onClick?.()
    expect(onCopyFeldLink).toHaveBeenCalledOnce()
  })
})

describe('completion still comes from live state, overrides winning', () => {
  it('ticks the driver row only once every vehicle has one', () => {
    expect(byId('assign-drivers', tasks({ driverAssignments: 2 }))?.completed).toBe(false)
    expect(byId('assign-drivers', tasks({ driverAssignments: 3 }))?.completed).toBe(true)
  })

  it('lets the operator override either way', () => {
    const task = byId('assign-drivers', tasks({ driverAssignments: 3 }))!
    expect(isTaskComplete(task, {})).toBe(true)
    expect(isTaskComplete(task, { 'assign-drivers': false })).toBe(false)
  })
})
