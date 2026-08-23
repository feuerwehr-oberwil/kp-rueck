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
 * Zwei Teile, einzeln verwendbar:
 * - `<SettingUnavailableBadge>` – die kurze Marke an der Beschriftung.
 * - `<SettingUnavailableNote>` – der Satz, in voller Breite unter der Zeile.
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

/** Der Grund, in voller Breite unter der Zeile: was fehlt, und wo es gesetzt wird. */
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
