"use client"

import { useEffect, useState } from "react"
import { apiClient } from "@/lib/api-client"
import { useAuth } from "@/lib/contexts/auth-context"
import { useOperations } from "@/lib/contexts/operations-context"

const DEFAULT_FUNKRUFNAME = "Omega"

export interface StationCapabilities {
  /** Thermal printer switched on AND an address the agent can reach. */
  printerEnabled: boolean
  /** Divera alarming switched on AND an access key configured. */
  diveraEnabled: boolean
  /** The station's call sign for the radio phrases. */
  funkrufname: string
}

/**
 * What this station can do from the board and the Lagekarte – the print and the
 * Divera send buttons render only when they would work. One copy for both pages
 * (they had diverged: the map showed the print button for a printer without an
 * address).
 *
 * Funkrufname and the Divera switch come from the board sync's settings
 * (`useOperations().settings`); the two status probes run once per sign-in, and
 * the Divera one again when the switch flips.
 */
export function useStationCapabilities(): StationCapabilities {
  const { isAuthenticated } = useAuth()
  const { settings } = useOperations()
  const [printerEnabled, setPrinterEnabled] = useState(false)
  const [diveraConfigured, setDiveraConfigured] = useState(false)
  const diveraSwitchedOn = settings["divera.alarm_enabled"] === "true"

  useEffect(() => {
    if (!isAuthenticated) return
    let cancelled = false
    apiClient
      .getPrinterStatus()
      // On `enabled` alone the print buttons rendered for a station that had never
      // entered an IP — the job was accepted, queued, and never came out.
      .then((status) => !cancelled && setPrinterEnabled(status.enabled && Boolean(status.ip?.trim())))
      // Printer API might not be available (e.g., Railway deployment)
      .catch(() => !cancelled && setPrinterEnabled(false))
    return () => {
      cancelled = true
    }
  }, [isAuthenticated])

  useEffect(() => {
    if (!isAuthenticated || !diveraSwitchedOn) return
    let cancelled = false
    apiClient
      .getDiveraPollingStatus()
      // The send button needs the switch AND a configured access key —
      // otherwise it would render and then 400 on send.
      .then((status) => !cancelled && setDiveraConfigured(status.configured === true))
      // Status endpoint unavailable — trust the switch.
      .catch(() => !cancelled && setDiveraConfigured(true))
    return () => {
      cancelled = true
    }
  }, [isAuthenticated, diveraSwitchedOn])

  return {
    printerEnabled,
    diveraEnabled: diveraSwitchedOn && diveraConfigured,
    funkrufname: settings.funkrufname || DEFAULT_FUNKRUFNAME,
  }
}
