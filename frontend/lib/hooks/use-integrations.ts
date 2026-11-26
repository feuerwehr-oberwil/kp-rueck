'use client'

import { useQuery } from '@tanstack/react-query'
import { apiClient } from '@/lib/api-client'
import type { ApiProviderCapability } from '@/lib/api/types'
import { queryKeys } from '@/lib/query/keys'
import { useReader } from '@/lib/query/reader'

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

export function useIntegrationCapability(domain: IntegrationDomain): ApiProviderCapability | null {
  // Keine Antwort heisst «unbekannt», nicht «nicht eingerichtet» – siehe oben.
  const reader = useReader()
  const query = useQuery({
    queryKey: queryKeys.integrations.for(reader),
    queryFn: () => apiClient.getIntegrations(),
    staleTime: Infinity,
    select: (integrations) => integrations[domain],
  })
  return query.data ?? null
}
