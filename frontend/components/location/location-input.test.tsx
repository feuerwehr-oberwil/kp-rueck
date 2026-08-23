import { StrictMode } from "react"
import { describe, expect, it, vi } from "vitest"
import { screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { renderWithIntl } from "@/test-utils/render-with-intl"

const geocodeAddress = vi.hoisted(() => vi.fn().mockResolvedValue(null))
const searchAddress = vi.hoisted(() => vi.fn().mockResolvedValue([]))
const getAllSettings = vi.hoisted(() => vi.fn().mockResolvedValue({}))

vi.mock("@/lib/geocoding", () => ({ geocodeAddress, searchAddress }))
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

  // A CHANGED freetext is a new answer to "where": the pin that belonged to
  // the previous address must not ride along — downstream consumers (the map,
  // the /alarm correction PUT) trust the pin over the text.
  it("clears the pin when a different freetext address is committed", async () => {
    const onCoordinatesChange = vi.fn()
    const user = userEvent.setup()
    searchAddress.mockResolvedValue([])

    renderWithIntl(
      <LocationInput
        address="Hauptstrasse 1"
        latitude={47.5}
        longitude={7.55}
        onAddressChange={vi.fn()}
        onCoordinatesChange={onCoordinatesChange}
        geocodeInitialAddress={false}
      />,
    )

    const field = screen.getByRole("combobox")
    await user.clear(field)
    await user.type(field, "Hinter dem Schulhaus{Enter}")

    expect(onCoordinatesChange).toHaveBeenCalledWith(null, null)
  })

  it("keeps the pin when the unchanged address is re-committed (a stray Enter)", async () => {
    const onCoordinatesChange = vi.fn()
    const user = userEvent.setup()
    searchAddress.mockResolvedValue([])

    renderWithIntl(
      <LocationInput
        address="Hauptstrasse 1"
        latitude={47.5}
        longitude={7.55}
        onAddressChange={vi.fn()}
        onCoordinatesChange={onCoordinatesChange}
        geocodeInitialAddress={false}
      />,
    )

    await user.click(screen.getByRole("combobox"))
    await user.keyboard("{Enter}")

    // Same text, same pin — a map-picked pin must survive a re-commit.
    expect(onCoordinatesChange).not.toHaveBeenCalled()
  })

  /**
   * The regression: clicking a suggestion did nothing at all.
   *
   * mousedown blurred the input → `editing` went false → the committed address
   * (empty) went back into the query → the search effect saw fewer than three
   * characters and cleared the results → the row unmounted before mouseup, so
   * its onClick never ran. The operator watched the list vanish and the field
   * keep their half-typed text.
   */
  it("applies the suggestion that was clicked", async () => {
    const onAddressChange = vi.fn()
    const onCoordinatesChange = vi.fn()
    const user = userEvent.setup()
    searchAddress.mockResolvedValue([
      { id: "1", formattedAddress: "Löchlimattstrasse, 4104 Oberwil", lat: 47.516659, lon: 7.56234 },
    ])

    renderWithIntl(
      <LocationInput
        address={null}
        latitude={null}
        longitude={null}
        onAddressChange={onAddressChange}
        onCoordinatesChange={onCoordinatesChange}
        geocodeInitialAddress={false}
      />,
    )

    await user.type(screen.getByRole("combobox"), "löchlimatt")
    const option = await screen.findByText("Löchlimattstrasse, 4104 Oberwil")
    await user.click(option)

    expect(onAddressChange).toHaveBeenCalledWith("Löchlimattstrasse, 4104 Oberwil")
    expect(onCoordinatesChange).toHaveBeenCalledWith(47.516659, 7.56234)
  })
})
