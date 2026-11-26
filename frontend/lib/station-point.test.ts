import { describe, expect, it } from "vitest"
import { stationPoint } from "./station-point"

describe("stationPoint", () => {
  it("takes a complete legacy GPS pair over the Allgemein pair, and never mixes the two", () => {
    const allgemein = { firestation_latitude: "47.5", firestation_longitude: "7.5" }
    expect(stationPoint({ ...allgemein, "gps.station_lat": "47.6", "gps.station_lng": "7.6" })).toEqual([47.6, 7.6])
    // Half a legacy pair (an unset key is stored as "") is no pair: the Allgemein one stands.
    expect(stationPoint({ ...allgemein, "gps.station_lat": "47.6", "gps.station_lng": "" })).toEqual([47.5, 7.5])
    expect(stationPoint({ firestation_latitude: "47.5" })).toBeNull()
  })
})
