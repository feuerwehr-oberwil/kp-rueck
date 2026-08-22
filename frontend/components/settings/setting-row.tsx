'use client'

/**
 * Eine Zeile der Einstellungsseite: **Beschriftung + Hinweis links, Bedienelement rechts in
 * einer festen Spalte**, Haarlinie darunter.
 *
 * Das ist für die Einstellungen, was `<DetailField>` für das Einsatzdetail ist – die eine
 * Stelle, an der eine Zeile gebaut wird. Vorher baute sie jeder Abschnitt selbst, und das
 * sah man: vier Beschriftungsklassen im Umlauf (`text-sm font-semibold text-muted-foreground`,
 * `font-medium`, `font-medium flex items-center gap-2`, `font-medium text-sm`), teils zwei
 * davon auf derselben Karte; Kartenpolsterung `p-4`, `p-5` und `p-6` nebeneinander; und die
 * Bedienelemente in `w-24`, `w-48` oder `w-56`, je nachdem, wer die Zeile geschrieben hatte.
 *
 * **Keine Trennlinien.** Eine Zeile bringt schon zwei Signale mit, die sie von der nächsten
 * abheben – eine fette Beschriftung und eine graue zweite Zeile –, und eine Haarlinie
 * dazwischen sagt nichts, was der Zeilenumbruch nicht sagt. Vorher gab es sogar zwei Sorten,
 * die übereinanderfielen: eine unter jeder Zeile und eine über jeder Gruppe, also zwei Striche
 * mit 12 Pixeln Luft dazwischen und sofort wieder einer direkt unter der Überschrift. Das las
 * sich als Gitter, nicht als Gliederung. Getrennt wird jetzt durch Abstand, gruppiert durch
 * eine kleine graue Überschrift, und die Karte ist der Rahmen.
 *
 * Die feste Bedienelementspalte ist der Punkt. Ein rechter Rand, an dem das Auge herunterläuft,
 * ist bei zwanzig Zeilen mehr wert als jede einzelne optimal breite Eingabe – darum füllen
 * Auswahlfelder und Textfelder die Spalte, und nur Zahlenfelder bleiben schmal (eine Minutenzahl
 * in 200 Pixeln liest sich als Fehler).
 *
 * Die drei Teile der Sperre stecken mit drin (`unavailable`), damit «gesperrt» nicht wieder in
 * jedem Abschnitt anders aussieht: Marke an der Beschriftung, Satz in voller Breite unter der
 * Zeile, und das `title` am Bedienelement bleibt Sache der Aufruferin – sie hält es ohnehin
 * schon in der Hand. Siehe `setting-unavailable.tsx`.
 */

import type { ReactNode } from 'react'
import { useTranslations } from 'next-intl'
import { Card } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import {
  SettingUnavailableBadge,
  SettingUnavailableNote,
} from '@/components/settings/setting-unavailable'

/**
 * Breite der Bedienelementspalte. Eine Zahl, damit sie sich nicht wieder aufteilt.
 *
 * `min-w`, nicht `w`: rechtsbündig in einer Flex-Zeile enden alle Bedienelemente ohnehin an
 * derselben Kante, und ein Element, das breiter ist als 200 Pixel – die drei Erscheinungsbild-
 * Knöpfe – darf sich dann nehmen, was es braucht, statt aus einer festen Breite zu ragen.
 */
export const SETTING_CONTROL_COLUMN = 'min-w-[200px]'

interface SettingRowProps {
  label: ReactNode
  /** Verbindet Beschriftung und Bedienelement – bei Schaltern und Eingaben immer setzen. */
  htmlFor?: string
  /** Der Halbsatz unter der Beschriftung. Kurz: er beschreibt, was der Wert bewirkt. */
  hint?: ReactNode
  /**
   * Nur bei Zeilen, die eine *Sache* bezeichnen (Drucker, Lageblatt), nie bei Parametern
   * (Port, Takt) – sonst wird die Spalte zur Bildergalerie. 14px, `text-muted-foreground`.
   */
  icon?: ReactNode
  /**
   * Warum die Zeile nichts bewirken kann. Gesetzt heisst: Marke an der Beschriftung und
   * dieser Satz unter der Zeile. Das `disabled` am Bedienelement setzt die Aufruferin –
   * hier ist nicht bekannt, was das Element sonst noch sperrt (Speichern, Leserechte).
   */
  unavailable?: string | null
  /** Text der Marke. Vorgabe ist `settings.common.notConfiguredBadge` («Nicht eingerichtet»). */
  unavailableBadge?: string
  /** Zusätzliche Zeilen unter der Hauptzeile – der Fortschrittsbalken des Testdrucks etwa. */
  footer?: ReactNode
  /** Das Bedienelement. */
  children?: ReactNode
  className?: string
}

export function SettingRow({
  label,
  htmlFor,
  hint,
  icon,
  unavailable,
  unavailableBadge,
  footer,
  children,
  className,
}: SettingRowProps) {
  const t = useTranslations('settings.common')

  return (
    <div className={cn('py-3', className)}>
      <div className="flex items-center gap-5">
        <div className="min-w-0 flex-1">
          {/* Die Marken stehen NEBEN der Beschriftung, nie darin: ein Button innerhalb
              eines <label> löst beim Klick das Bedienelement aus, zu dem er gehört. */}
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <Label
              htmlFor={htmlFor}
              className="flex items-center gap-1.5 text-sm font-medium leading-snug"
            >
              {icon}
              {label}
            </Label>
            {unavailable && (
              <SettingUnavailableBadge>
                {unavailableBadge ?? t('notConfiguredBadge')}
              </SettingUnavailableBadge>
            )}
          </div>
          {hint && <p className="mt-0.5 text-xs leading-snug text-muted-foreground">{hint}</p>}
        </div>
        {children && (
          <div className={cn('flex shrink-0 justify-end', SETTING_CONTROL_COLUMN)}>{children}</div>
        )}
      </div>
      {unavailable && <SettingUnavailableNote className="mt-2">{unavailable}</SettingUnavailableNote>}
      {footer}
    </div>
  )
}

interface SettingCardProps {
  /** Fehlt der Titel, ist die Karte ein reiner Zeilenbehälter ohne Kopf. */
  title?: ReactNode
  subtitle?: ReactNode
  /** Rechts im Kopf – «Aktualisieren», ein Zustandsabzeichen. */
  action?: ReactNode
  children: ReactNode
  className?: string
}

/**
 * Der Behälter um eine Gruppe von Zeilen. Eine Polsterung für alle (`p-5`), damit die Seite
 * nicht bei jedem Abschnitt eine andere Kante hat.
 */
export function SettingCard({
  title,
  subtitle,
  action,
  children,
  className,
}: SettingCardProps) {
  return (
    <Card className={cn('p-5', className)}>
      {(title || action) && (
        <div className="mb-3 flex items-start gap-4">
          <div className="min-w-0 space-y-0.5">
            {title && <p className="text-sm font-semibold">{title}</p>}
            {subtitle && <p className="text-xs leading-snug text-muted-foreground">{subtitle}</p>}
          </div>
          <div className="ml-auto flex shrink-0 items-center gap-2">
            {action}
          </div>
        </div>
      )}
      <div>{children}</div>
    </Card>
  )
}

/**
 * Die Zeile für alles, was nicht in eine 200-Pixel-Spalte passt: Nachrichtenvorlagen,
 * Chip-Listen, Filterlisten – also mehrzeilige Textfelder.
 *
 * Beschriftung oben, rechts daneben die eine Aktion, die dazugehört («Zurücksetzen»),
 * darunter der Hinweis und dann das Feld über die volle Breite. Sechsmal im Katalog von
 * Hand gebaut gewesen, jedes Mal minim anders.
 */
export function SettingBlock({
  label,
  htmlFor,
  hint,
  action,
  children,
  className,
}: {
  label: ReactNode
  htmlFor?: string
  hint?: ReactNode
  /** Rechts auf der Beschriftungszeile – «Zurücksetzen», ein Zähler. */
  action?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <div className={cn('py-3', className)}>
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor={htmlFor} className="text-sm font-medium">
          {label}
        </Label>
        {action}
      </div>
      {hint && <p className="mt-0.5 text-xs leading-snug text-muted-foreground">{hint}</p>}
      <div className="mt-1.5">{children}</div>
    </div>
  )
}

/**
 * Eine Untergruppe innerhalb einer Karte – «Magazin (Heimatbasis)», «Feinabstimmung».
 * Abstand darüber, kleine graue Überschrift, dann wieder Zeilen. Kein `uppercase`: die
 * Hauptanwendung schreibt in Grossschreibung nur auf dem Wanddisplay.
 */
export function SettingGroup({
  title,
  hint,
  children,
  className,
}: {
  title: ReactNode
  hint?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <div className={cn('mt-6', className)}>
      <p className="text-xs font-semibold text-muted-foreground">{title}</p>
      {hint && <p className="mt-0.5 mb-1 text-xs leading-snug text-muted-foreground">{hint}</p>}
      <div className="mt-1">{children}</div>
    </div>
  )
}

/**
 * Die Knopfreihe am Fuss einer Karte – Knöpfe rechtsbündig, wie in jedem Dialog.
 *
 * `leading` steht links davon und ist für den Satz, den die Knöpfe beantworten: der
 * Druckerzustand gehört neben «Verbindung testen», nicht in eine eigene Karte über dem
 * Formular. «Läuft es?» und «Prüf es nach» sind dieselbe Frage, zweimal gestellt.
 */
export function SettingActions({
  leading,
  children,
  className,
}: {
  leading?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex flex-wrap items-center gap-x-3 gap-y-2 pt-4', className)}>
      {leading}
      <div className="ml-auto flex gap-2">{children}</div>
    </div>
  )
}
