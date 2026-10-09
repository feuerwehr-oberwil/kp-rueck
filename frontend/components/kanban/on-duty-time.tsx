"use client"

/**
 * OnDutyTime — how long somebody has been here, as a quiet mono figure
 * («3h 40'»), amber from the station's fatigue threshold on and red from 1.5 ×
 * (lib/crew-duty.ts). The full sentence — since when, how long in words, and
 * that it is past the threshold — is the tooltip and the accessible name.
 *
 * Its own component so the memoized person row does not re-render every
 * minute: only this span subscribes to the shared minute timer.
 */

import { useTranslations } from "next-intl"
import { useMinuteTick } from "@/components/ui/incident-time"
import { formatDuration, formatDurationLong } from "@/lib/duration"
import { DUTY_TEXT_CLASSES, dutyLevel, dutyMinutes } from "@/lib/crew-duty"
import { useIntlLocale } from "@/lib/date-locale"
import { cn } from "@/lib/utils"

export function useOnDutyLabel(checkedInAt: string | null | undefined, fatigueHours: number) {
  useMinuteTick()
  const t = useTranslations("kanban.crewDuty")
  const tDuration = useTranslations("common.duration")
  const locale = useIntlLocale()
  const minutes = dutyMinutes(checkedInAt)
  if (minutes === null || !checkedInAt) return null
  const level = dutyLevel(minutes, fatigueHours)
  const since = new Date(checkedInAt).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" })
  const long = formatDurationLong(minutes * 60_000, tDuration)
  const label =
    level === "normal"
      ? t("onDutyTooltip", { time: since, duration: long })
      : t("onDutyTooltipOver", { time: since, duration: long, hours: fatigueHours })
  return { minutes, level, since, short: formatDuration(minutes * 60_000), label }
}

export function OnDutyTime({
  checkedInAt,
  fatigueHours,
  className,
}: {
  checkedInAt: string | null | undefined
  fatigueHours: number
  className?: string
}) {
  const duty = useOnDutyLabel(checkedInAt, fatigueHours)
  if (!duty) return null
  return (
    <span
      data-duty-level={duty.level}
      title={duty.label}
      aria-label={duty.label}
      className={cn("shrink-0 font-mono tabular-nums", DUTY_TEXT_CLASSES[duty.level], className)}
    >
      {duty.short}
    </span>
  )
}
