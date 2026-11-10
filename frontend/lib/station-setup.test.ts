import { describe, expect, it } from "vitest"
import { stationSetupState } from "./station-setup"

const fresh = { firestation_latitude: "47.5596", firestation_longitude: "7.5886", home_city: "Musterstadt, BL" }
const oberwil = { firestation_latitude: "47.516377", firestation_longitude: "7.561800", home_city: "Oberwil, BL" }

describe("stationSetupState", () => {
  it("a freshly claimed production install has both steps open", () => {
    expect(stationSetupState({ settings: fresh, personnelCount: 0, vehicleCount: 0 })).toEqual({
      locationSet: false,
      inventorySet: false,
      done: false,
    })
  })

  it("the location counts only when coordinates AND Einsatzgebiet left the placeholder", () => {
    const state = (settings: Record<string, string>) =>
      stationSetupState({ settings, personnelCount: 1, vehicleCount: 1 }).locationSet
    expect(state({ ...oberwil, home_city: "Musterstadt, BL" })).toBe(false)
    expect(state({ ...fresh, home_city: "Oberwil, BL" })).toBe(false)
    expect(state(oberwil)).toBe(true)
  })

  it("the inventory needs somebody and something to send", () => {
    const state = (personnelCount: number, vehicleCount: number) =>
      stationSetupState({ settings: oberwil, personnelCount, vehicleCount })
    expect(state(12, 0).inventorySet).toBe(false)
    expect(state(0, 3).inventorySet).toBe(false)
    expect(state(12, 3)).toEqual({ locationSet: true, inventorySet: true, done: true })
  })
})
