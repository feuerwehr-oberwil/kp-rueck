import { describe, expect, it, vi } from "vitest"
import { renderHook } from "@testing-library/react"
import { NextIntlClientProvider } from "next-intl"
import type { ReactNode } from "react"
import de from "@/messages/de.json"
import type { Operation } from "@/lib/contexts/operations-context"

import { useResourceBindings, type UseResourceBindingsInput } from "@/components/board/use-resource-bindings"

const wrapper = ({ children }: { children: ReactNode }) => (
  <NextIntlClientProvider locale="de" messages={de} timeZone="Europe/Zurich">
    {children}
  </NextIntlClientProvider>
)

// Owner pick A (24.11.2026): a person row's click always opens the popover, even with one place.
describe("useResourceBindings handlePersonClick", () => {
  it("opens the popover for a person on exactly one Einsatz instead of jumping to the card", () => {
    const operation = { id: "op-12", number: 12, location: "Ringstrasse 11", crew: [{ personnelId: "p-koch" }] } as unknown as Operation
    const input: UseResourceBindingsInput = {
      operations: [operation],
      filteredOperations: [operation],
      groups: [],
      getGroupResources: () => ({ personnel: [], vehicles: [], materials: [] }),
      groupNames: new Map(),
      scrollToCard: vi.fn(),
      setSearchQuery: vi.fn(),
      openIncidentDetail: vi.fn(),
      setActiveFooterSheet: vi.fn(),
      setAuftraegeFocusGroupId: vi.fn(),
      setBindingsPopover: vi.fn(),
    }
    const { result } = renderHook(() => useResourceBindings(input), { wrapper })

    // The precondition the old shortcut jumped on: one place to go.
    expect(result.current.collectPersonPlaces({ id: "p-koch" })).toHaveLength(1)
    result.current.handlePersonClick({ id: "p-koch" })

    expect(input.setBindingsPopover).toHaveBeenCalledExactlyOnceWith({ kind: "person", id: "p-koch" })
    expect(input.scrollToCard).not.toHaveBeenCalled()
    expect(input.openIncidentDetail).not.toHaveBeenCalled()
  })
})
