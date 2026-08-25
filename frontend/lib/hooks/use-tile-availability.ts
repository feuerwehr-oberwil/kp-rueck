'use client'

/**
 * Sind auf diesem Server echte Offline-Kacheln installiert?
 *
 * Die Frage ist nicht «gibt es eine Kacheldatei». `scripts/init-tileserver.sh` legt beim
 * ersten Start eine gültige, aber LEERE MBTiles-Datei an, damit TileServer GL überhaupt
 * startet. Sie trägt die Beschreibung «Bootstrap MBTiles – …», hat kein einziges Kachel-
 * Byte, und «Nur Offline» darauf ergibt eine schwarze Karte für die ganze Station, ohne
 * jede Meldung. Genau diese Unterscheidung macht `just doctor` schon auf der Kommandozeile;
 * hier steht sie an der Stelle, an der die Entscheidung getroffen wird.
 *
 * Geprüft wird über das TileJSON-Verzeichnis des Kachel-Servers (`/index.json`), das im
 * Dev-Stack direkt auf :8080 und in einer Aufstellung hinter dem gemeinsamen Origin unter
 * `/tiles` liegt – siehe `getTileBaseUrl()`.
 */

import { useCallback, useEffect, useState } from 'react'
import { getTileBaseUrl } from '@/lib/env'

/** Kennzeichen, das `scripts/init-tileserver.sh` der leeren Startdatei mitgibt. */
const BOOTSTRAP_MARKER = 'bootstrap mbtiles'

export type TileAvailability =
  /** Antwort steht noch aus. */
  | { status: 'checking' }
  /** Der Kachel-Server antwortet nicht – wir wissen es schlicht nicht. */
  | { status: 'unreachable' }
  /** Er antwortet, führt aber gar keine Kacheldatei. */
  | { status: 'missing' }
  /** Nur die leere Startdatei: technisch vorhanden, inhaltlich nichts. */
  | { status: 'bootstrap'; name: string; checkedAt: Date }
  /** Echte Kacheln für ein Gebiet. */
  | {
      status: 'installed'
      name: string
      minzoom: number | null
      maxzoom: number | null
      checkedAt: Date
    }

/** Eine Zeile aus dem TileJSON-Verzeichnis des Kachel-Servers – nur die Felder, die zählen. */
interface TileJsonEntry {
  id?: unknown
  name?: unknown
  description?: unknown
  minzoom?: unknown
  maxzoom?: unknown
}

const asString = (value: unknown): string | null => (typeof value === 'string' ? value : null)
const asNumber = (value: unknown): number | null => (typeof value === 'number' ? value : null)

function classify(entries: TileJsonEntry[]): TileAvailability {
  if (entries.length === 0) return { status: 'missing' }

  const checkedAt = new Date()
  // Eine echte Kachelmenge schlägt die Startdatei: Wer nach dem Download eine zweite
  // Region dazulegt, soll nicht wegen der alten leeren Datei als «nicht installiert» gelten.
  const real = entries.find(
    (entry) => !(asString(entry.description) ?? '').toLowerCase().includes(BOOTSTRAP_MARKER),
  )
  if (real) {
    return {
      status: 'installed',
      name: asString(real.name) ?? asString(real.id) ?? '',
      minzoom: asNumber(real.minzoom),
      maxzoom: asNumber(real.maxzoom),
      checkedAt,
    }
  }

  const first = entries[0]
  return {
    status: 'bootstrap',
    name: asString(first.name) ?? asString(first.id) ?? '',
    checkedAt,
  }
}

export function useTileAvailability(): {
  availability: TileAvailability
  recheck: () => void
} {
  const [availability, setAvailability] = useState<TileAvailability>({ status: 'checking' })
  const [attempt, setAttempt] = useState(0)

  const recheck = useCallback(() => {
    setAvailability({ status: 'checking' })
    setAttempt((n) => n + 1)
  }, [])

  useEffect(() => {
    let cancelled = false
    const controller = new AbortController()
    // Der Kachel-Server ist optional und kann tot sein; eine hängende Anfrage darf die
    // Einstellungsseite nicht dauerhaft auf «prüfe…» stehen lassen.
    const timeout = setTimeout(() => controller.abort(), 5000)

    fetch(`${getTileBaseUrl()}/index.json`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(String(response.status))
        const body: unknown = await response.json()
        if (cancelled) return
        setAvailability(classify(Array.isArray(body) ? (body as TileJsonEntry[]) : []))
      })
      .catch(() => {
        if (!cancelled) setAvailability({ status: 'unreachable' })
      })
      .finally(() => clearTimeout(timeout))

    return () => {
      cancelled = true
      controller.abort()
      clearTimeout(timeout)
    }
  }, [attempt])

  return { availability, recheck }
}
