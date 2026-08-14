import { StrictMode } from "react"
import { describe, expect, it, vi } from "vitest"
import { screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
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

  // The field the operator aims at is the field they type into, and it shows
  // what is committed. Enter takes the typed text when the geocoder has nothing
  // — that is the Flurname / Baustellenzufahrt case, and it must not need a
  // mouse trip to a fallback row.
  it("is a single field: it shows the committed address and commits what is typed", async () => {
    const onAddressChange = vi.fn()
    const user = userEvent.setup()

    renderWithIntl(
      <LocationInput
        address="Hauptstrasse 1"
        latitude={null}
        longitude={null}
        onAddressChange={onAddressChange}
        onCoordinatesChange={vi.fn()}
        geocodeInitialAddress={false}
      />,
    )

    const field = screen.getByRole("combobox")
    expect(field).toHaveValue("Hauptstrasse 1")

    await user.clear(field)
    await user.type(field, "Hinter dem Schulhaus{Enter}")

    expect(onAddressChange).toHaveBeenCalledWith("Hinter dem Schulhaus")
  })
})
