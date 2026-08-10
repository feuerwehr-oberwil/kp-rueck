import { describe, expect, it, vi } from 'vitest'

import { generateChecklistTasks, isTaskComplete, type ChecklistTaskState } from './checklist-tasks'

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
    onShowTileSetup: noop,
    onTestPrint: noop,
    onOpenFallbackSettings: noop,
    onOpenVehicles: noop,
    ...overrides,
  })
}

const byId = (id: string, list: ChecklistTaskState[]) => list.find(task => task.id === id)

describe('the setup checklist links into what it is asking for', () => {
  it('opens the Fahrzeuge sheet from the driver step', () => {
    // The one place a driver is set is per vehicle in that sheet. Counting the
    // gap and then making the operator go and find it is the thing being fixed.
    const onOpenVehicles = vi.fn()
    const task = byId('assign-drivers', tasks({ onOpenVehicles }))

    const action = task?.actionButtons?.[0]
    expect(action).toBeDefined()
    action?.onClick?.()
    expect(onOpenVehicles).toHaveBeenCalledOnce()
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
