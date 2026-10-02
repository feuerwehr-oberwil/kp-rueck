"use client"

import { useEffect } from "react"
import { usePersistedState } from "@/lib/hooks/use-persisted-state"

/**
 * Per-device layout memory. Folding a sidebar away is a deliberate act; walking
 * to the Karte and back used to undo it, which made the fold worthless. Keys
 * follow the `kp-board-*` family the other board preferences already use.
 */
const LEFT_SIDEBAR_KEY = "kp-board-leftSidebarOpen"
const RIGHT_SIDEBAR_KEY = "kp-board-rightSidebarOpen"
const SIDE_PANEL_MODE_KEY = "kp-board-sidePanelMode"

const isBoolean = (value: unknown): value is boolean => typeof value === "boolean"

export type SidePanelMode = 'detail' | 'collapsed'
const isSidePanelMode = (value: unknown): value is SidePanelMode =>
  value === 'detail' || value === 'collapsed'

/**
 * The board's three remembered layout choices: both sidebars and the detail
 * panel. Moved out of `app/page.tsx` (2026-09-23); the storage, the read-after-
 * mount and the validators are `usePersistedState`'s, unchanged.
 */
export function useBoardLayoutPrefs(isMobile: boolean) {
  // Modal and panel intentionally share one incident identity; only presentation
  // changes at the external-monitor breakpoint.
  const [sidePanelMode, setSidePanelMode] = usePersistedState<SidePanelMode>(
    SIDE_PANEL_MODE_KEY,
    'collapsed',
    isSidePanelMode,
  )
  const [showLeftSidebar, setShowLeftSidebar] = usePersistedState(LEFT_SIDEBAR_KEY, true, isBoolean)
  const [showRightSidebar, setShowRightSidebar] = usePersistedState(RIGHT_SIDEBAR_KEY, true, isBoolean)

  // Hide sidebars on mobile by default. Runs after the persisted state has been
  // restored (`isMobile` only turns true once its own mount effect has measured
  // the window), so a remembered «offen» never survives on a phone — mobile wins.
  useEffect(() => {
    if (isMobile) {
      setShowLeftSidebar(false)
      setShowRightSidebar(false)
    }
  }, [isMobile, setShowLeftSidebar, setShowRightSidebar])

  return {
    sidePanelMode,
    setSidePanelMode,
    showLeftSidebar,
    setShowLeftSidebar,
    showRightSidebar,
    setShowRightSidebar,
  }
}
