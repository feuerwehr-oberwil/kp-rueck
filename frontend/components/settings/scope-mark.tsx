'use client'

/**
 * Reichweiten-Marke für Einstellungs-Zeilen.
 *
 * Fast jede Zeile der Einstellungsseite ist eine gemeinsame Zeile in der Datenbank:
 * Wer am Kommandoposten die Zeit-Warnungen ausschaltet, schaltet sie auch auf dem
 * Wanddisplay im Magazin aus. Nur wenige Werte (Erscheinungsbild, Sprache, alles was
 * im Browser liegt) gelten wirklich nur hier. Bis jetzt sagte das nichts an der Zeile –
 * vier Beschreibungstexte im ganzen Katalog trugen ein «dieses Gerät», der Rest schwieg.
 *
 * Die Marke ist ein 15-Pixel-Kästchen an der Beschriftung. Sie unterscheidet die beiden
 * Reichweiten dreifach – nie durch Farbe allein:
 *
 * - **Glyph**: gefülltes Quadrat (Station) vs. offener Ring (Gerät)
 * - **Rahmen**: durchgezogen vs. gestrichelt
 * - **Wort**: das Popup beim Zeigen/Fokussieren nennt die Reichweite ausgeschrieben
 *   und dazu die eine Folge, die überrascht.
 *
 * Ausgeschrieben steht die Bedeutung einmal pro Seite – `<ScopeLegend />` zuoberst.
 * Auf `station` gesetzt heisst: Der Wert liegt in der `settings`-Tabelle. Auf `device`:
 * Der Wert liegt lokal (Cookie, localStorage, next-themes). Mehr Datenmodell braucht die
 * Marke nicht – sie beschreibt, wo der Wert schon heute liegt.
 */

import { useTranslations } from 'next-intl'
import { cn } from '@/lib/utils'
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from '@/components/ui/hover-card'

export type SettingScope = 'station' | 'device'

/** Nur der Glyph, ohne Popup – für die Legende und für den Kopf des Popups selbst. */
function ScopeGlyph({ scope, className }: { scope: SettingScope; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        'inline-flex size-[15px] shrink-0 items-center justify-center rounded-[3px]',
        scope === 'station'
          ? 'border border-info/45 bg-info/15'
          : 'border border-dashed border-border bg-transparent',
        className,
      )}
    >
      <span
        className={cn(
          'size-[7px]',
          scope === 'station'
            ? 'rounded-[1px] bg-info'
            : 'rounded-full border-[1.5px] border-muted-foreground',
        )}
      />
    </span>
  )
}

interface ScopeMarkProps {
  scope: SettingScope
  /** Marke am rechten Rand (Abschnittskopf) – das Popup richtet sich dann nach links aus. */
  align?: 'start' | 'end'
  className?: string
}

/**
 * Die Marke an einer Zeile oder an einem Abschnittskopf. Am Abschnittskopf fasst sie
 * zusammen, was innen gilt; eine abweichende Zeile trägt ihre eigene.
 */
export function ScopeMark({ scope, align = 'start', className }: ScopeMarkProps) {
  const t = useTranslations('settings.scope')
  const name = t(`${scope}.name`)

  return (
    <HoverCard openDelay={120} closeDelay={80}>
      <HoverCardTrigger asChild>
        {/* Ein Button, kein <span>: so ist die Marke auch mit der Tastatur erreichbar –
            Radix öffnet das Popup beim Fokus. `type=button`, damit sie in einem
            Dialogformular nichts abschickt. */}
        <button
          type="button"
          aria-label={name}
          className={cn(
            'inline-flex cursor-help rounded-[3px] align-middle focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
            className,
          )}
        >
          <ScopeGlyph scope={scope} />
        </button>
      </HoverCardTrigger>
      <HoverCardContent align={align} side="top" className="w-64 p-3">
        <p className="flex items-center gap-2 text-xs font-semibold">
          <ScopeGlyph scope={scope} />
          {name}
        </p>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          {t(`${scope}.consequence`)}
        </p>
      </HoverCardContent>
    </HoverCard>
  )
}

/**
 * Die Legende – einmal zuoberst auf der Einstellungsseite. Ein zwanzigmal wiederholtes
 * «Ganze Station» an jeder Zeile würde die Liste erschlagen; hier steht es ausgeschrieben.
 */
export function ScopeLegend({ className }: { className?: string }) {
  const t = useTranslations('settings.scope')

  return (
    <div
      className={cn(
        'flex flex-wrap items-center gap-x-5 gap-y-2 rounded-md border bg-muted/30 px-3 py-2',
        className,
      )}
    >
      <span className="text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">
        {t('legendLabel')}
      </span>
      {(['station', 'device'] as const).map((scope) => (
        <span key={scope} className="flex items-center gap-2 text-xs text-muted-foreground">
          <ScopeGlyph scope={scope} />
          <span>
            <b className="font-semibold text-foreground">{t(`${scope}.name`)}</b>
            {' – '}
            {t(`${scope}.legend`)}
          </span>
        </span>
      ))}
    </div>
  )
}
