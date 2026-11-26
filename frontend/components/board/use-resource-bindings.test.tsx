import { describe, expect, it, vi } from "vitest"
import { renderHook } from "@testing-library/react"
import { NextIntlClientProvider } from "next-intl"
import type { ReactNode } from "react"
import de from "@/messages/de.json"

import { useResourceBindings, type UseResourceBindingsInput } from "@/components/board/use-resource-bindings"
import { crewMember, makeOperation } from "@/test-utils/operation-fixtures"

const operation = makeOperation({ id: "op-12", number: 12, location: "Ringstrasse 11", crew: [crewMember("Koch", "p-koch")] })

// The board contexts the hook reads.
vi.mock("@/lib/contexts/operations-context", () => ({ useOperations: () => ({ operations: [operation] }) }))
vi.mock("@/lib/contexts/groups-context", () => ({
  useGroups: () => ({ groups: [], getGroupResources: () => ({ personnel: [], vehicles: [], materials: [] }) }),
}))

const wrapper = ({ children }: { children: ReactNode }) => (
  <NextIntlClientProvider locale="de" messages={de} timeZone="Europe/Zurich">
    {children}
  </NextIntlClientProvider>
)

// Owner pick A (24.11.2026): a person row's click always opens the popover, even with one place.
describe("useResourceBindings handlePersonClick", () => {
  it("opens the popover for a person on exactly one Einsatz instead of jumping to the card", () => {
    const input = {
      selection: { scrollToCard: vi.fn(), openIncidentDetail: vi.fn() },
      sheets: { setActiveFooterSheet: vi.fn(), setAuftraegeFocusGroupId: vi.fn() },
      filteredOperations: [operation],
      setSearchQuery: vi.fn(),
      setBindingsPopover: vi.fn(),
    } satisfies UseResourceBindingsInput
    const { result } = renderHook(() => useResourceBindings(input), { wrapper })

    // The precondition the old shortcut jumped on: one place to go.
    expect(result.current.collectPersonPlaces({ id: "p-koch" })).toHaveLength(1)
    result.current.handlePersonClick({ id: "p-koch" })

    expect(input.setBindingsPopover).toHaveBeenCalledExactlyOnceWith({ kind: "person", id: "p-koch" })
    expect(input.selection.scrollToCard).not.toHaveBeenCalled()
    expect(input.selection.openIncidentDetail).not.toHaveBeenCalled()
  })
})
