import { renderHook } from "@testing-library/react"
import { NextIntlClientProvider, useTranslations } from "next-intl"
import { describe, expect, it } from "vitest"
import de from "@/messages/de.json"
import { pillTexts } from "./vehicle-marker"

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <NextIntlClientProvider locale="de" messages={de} timeZone="Europe/Zurich">
    {children}
  </NextIntlClientProvider>
)
const depot = { kind: "cluster", count: 6, online: 2, offline: 4 } as const

describe("pillTexts", () => {
  it("abbreviates a group on the phone map (owner pick r28f 1B), and only a group", () => {
    const t = renderHook(() => useTranslations("map"), { wrapper }).result.current
    expect(pillTexts(t, depot, 0)).toMatchObject({ label: "6 Fahrzeuge", offlinePart: "4 offline" })
    expect(pillTexts(t, depot, 0, true)).toMatchObject({ label: "6 Fz.", offlinePart: "4 off" })
    const single = { kind: "single", name: "TLF", online: true, staleAt: null } as const
    expect(pillTexts(t, single, 0, true).label).toBe("TLF")
  })
})
