'use client'

import { useEffect, useState } from 'react'
import { apiClient } from '@/lib/api-client'
import type { ApiIntegrations, ApiProviderCapability } from '@/lib/api/types'

/**
 * Welcher Anbieter für einen Bereich eingerichtet ist – aus der Fähigkeiten-Registratur
 * des Backends (`GET /api/integrations`, `backend/app/api/integrations.py`).
 *
 * Zweck hier: Bedienelemente, die ohne Anbieter nichts bewirken, sperren und den Grund
 * nennen (`<SettingUnavailableNote>`). Die Antwort leitet das Backend aus der
 * Server-Konfiguration ab, also aus Werten, die sich zur Laufzeit einer Sitzung nicht
 * ändern – darum eine Antwort pro Seitenaufruf, geteilt von allen Aufrufern, wie bei
 * `useDeployment`. Wer einen Schlüssel neu einträgt, lädt danach ohnehin neu.
 *
 * Bis die Antwort da ist: `null`. Das heisst «wir wissen es noch nicht» und darf NICHT
 * als «nicht eingerichtet» gelesen werden – ein Schalter, der kurz nach dem Laden von
 * selbst sperrt, ist schlimmer als einer, der eine halbe Sekunde später sperrt.
 */
export type IntegrationDomain = 'alarms' | 'alerting' | 'personnel' | 'vehicles'

let cached: ApiIntegrations | null = null
let inflight: Promise<ApiIntegrations> | null = null

/** Test-Naht: den Modul-Zwischenspeicher leeren. */
export function resetIntegrationsCache() {
  cached = null
  inflight = null
}

export function useIntegrationCapability(domain: IntegrationDomain): ApiProviderCapability | null {
  const [capability, setCapability] = useState<ApiProviderCapability | null>(
    cached ? cached[domain] : null,
  )

  useEffect(() => {
    if (cached) {
      setCapability(cached[domain])
      return
    }
    let cancelled = false
    const request = (inflight ??= apiClient.getIntegrations())
    request
      .then((result) => {
        cached = result
        if (!cancelled) setCapability(result[domain])
      })
      .catch(() => {
        // Keine Antwort heisst «unbekannt», nicht «nicht eingerichtet» – siehe oben.
      })
      .finally(() => {
        inflight = null
      })
    return () => {
      cancelled = true
    }
  }, [domain])

  return capability
}
