import { StrictMode } from "react"
import { describe, expect, it, vi } from "vitest"
import { waitFor } from "@testing-library/react"
import { renderWithIntl } from "@/test-utils/render-with-intl"

const geocodeAddress = vi.hoisted(() => vi.fn().mockResolvedValue(null))
const getAllSettings = vi.hoisted(() => vi.fn().mockResolvedValue({}))

vi.mock("@/lib/geocoding", () => ({
  geocodeAddress,
  searchAddress: vi.fn().mockResolvedValue([]),
}))
vi.mock("@/lib/api-client", () => ({ apiClient: { getAllSettings } }))
vi.mock("next/dynamic", () => ({ default: () => () => null }))

import { LocationInput } from "@/components/location/location-input"

describe("LocationInput", () => {
  it("skips initial geocoding in Strict Mode but geocodes a later address change", async () => {
    const props = {
      latitude: null,
      longitude: null,
      onAddressChange: vi.fn(),
      onCoordinatesChange: vi.fn(),
      geocodeInitialAddress: false,
    }
    const { rerender } = renderWithIntl(
      <StrictMode>
        <LocationInput {...props} address="Hauptstrasse 1" />
      </StrictMode>,
    )

    await waitFor(() => expect(getAllSettings).toHaveBeenCalled())
    expect(geocodeAddress).not.toHaveBeenCalled()

    rerender(
      <StrictMode>
        <LocationInput {...props} address="Nebenstrasse 2" />
      </StrictMode>,
    )

    await waitFor(() => expect(geocodeAddress).toHaveBeenCalledWith("Nebenstrasse 2"))
  })
})
