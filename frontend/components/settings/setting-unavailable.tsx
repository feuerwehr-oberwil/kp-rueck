'use client'

/**
 * «Dieser Schalter kann hier nichts bewirken – und das steht dabei.»
 *
 * Eine Einstellung, deren Voraussetzung fehlt, darf sich nicht umlegen lassen und dann
 * schweigen: Der Schalter kippt, es passiert nichts, und auffallen tut das erst im
 * Einsatz – oder nie. Darum immer beides zusammen: das Bedienelement `disabled`, und
 * dazu dieser eine Satz, der sagt, WAS fehlt und WO es gesetzt wird («Einstellungen →
 * Drucker»). Nie nur Farbe, nie nur «nicht verfügbar».
 *
 * Der gespeicherte Wert bleibt dabei unangetastet. Taucht die Voraussetzung auf, wirkt
 * die Einstellung wieder – ohne dass hier jemand etwas nachziehen muss.
 *
 * Drei Teile, einzeln verwendbar:
 * - `<SettingUnavailableBadge>` – die kurze Marke an der Beschriftung.
 * - `<SettingRowNote>` – der Satz unter EINER Zeile, ohne Kasten, in deren Beschreibungsspalte
 *   (`SettingRow` stellt ihn über `unavailable` oder `advice` dorthin).
 * - `<SettingUnavailableNote>` – der Satz im Kasten, über eine ganze Karte: wenn nicht einer
 *   Zeile etwas fehlt, sondern allen (GPS ohne Ortungsdienst, Personal ohne Abgleich).
 *
 * Den Text liefert die Aufruferin: Er nennt die konkrete Voraussetzung und steht darum
 * im Katalog bei der Einstellung, zu der er gehört – nicht hier.
 */

import type { ReactNode } from 'react'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

/** Marke an der Beschriftung: «Nicht eingerichtet». Kurz – der Grund steht in der Notiz. */
export function SettingUnavailableBadge({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <Badge variant="secondary" className={cn('font-normal', className)}>
      {children}
    </Badge>
  )
}

/**
 * Rat oder Grund zu einer Zeile: 12/500 gedämpft, ohne Kasten. Ein Kasten unter der Zeile
 * begann 2 px innerhalb ihrer Textkante und lief unter die Bedienspalte (hill climb r22) –
 * der Satz gehört zur Beschreibung, also steht er an deren Kanten.
 */
export function SettingRowNote({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p role="note" className={cn('type-caption text-muted-foreground', className)}>
      {children}
    </p>
  )
}

/** Der Grund für eine ganze Karte, im Kasten über ihren Zeilen: was fehlt, und wo es gesetzt wird. */
export function SettingUnavailableNote({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <p
      role="note"
      className={cn(
        'rounded-md border bg-muted/30 px-3 py-2 text-xs leading-relaxed text-muted-foreground',
        className,
      )}
    >
      {children}
    </p>
  )
}
