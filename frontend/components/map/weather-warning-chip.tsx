"use client"

/**
 * Official warnings at the station, as one chip in the map's top-right control row.
 *
 * The chip: a dot in the warning's awareness colour, the source's own event word («Starker
 * Regen», «Feuerverbot»), how long it holds, and «+n» for more. A tap opens every warning in
 * full – headline, description and instructions EXACTLY as the source wrote them (MeteoSwiss
 * warnings may only be passed on unaltered), with region, validity and the source named and
 * linked.
 *
 * Shown whenever a warning applies, layer on or off: a fire ban or an orange storm warning is
 * not decoration you opt into. A source that stopped answering keeps its last warnings, greyed,
 * with «Stand hh:mm» – and an expired warning is simply gone.
 */

import { ExternalLink } from "lucide-react"
import { useLocale, useTranslations } from "next-intl"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { useIntlLocale } from "@/lib/date-locale"
import {
  formatWeatherTime,
  warningIsStale,
  warningLevelColor,
  warningText,
  type ApiWeather,
  type WeatherWarning,
} from "@/lib/weather"
import { cn } from "@/lib/utils"

function LevelDot({ level, stale }: { level: number; stale?: boolean }) {
  return (
    <span
      aria-hidden
      className={cn("inline-block size-2.5 shrink-0 rounded-full ring-1 ring-black/20", stale && "grayscale")}
      style={{ backgroundColor: warningLevelColor(level) }}
    />
  )
}

function useValidity() {
  const t = useTranslations("map.weather")
  const intlLocale = useIntlLocale()
  return (warning: WeatherWarning, now: number) => {
    const onset = warning.onset ? Date.parse(warning.onset) : null
    if (onset !== null && onset > now) {
      return t("from", { time: formatWeatherTime(warning.onset!, intlLocale, now) })
    }
    if (warning.expires) return t("until", { time: formatWeatherTime(warning.expires, intlLocale, now) })
    return t("untilRevoked")
  }
}

export function WeatherWarningChip({
  weather,
  warnings,
  now,
}: {
  weather: ApiWeather
  /** `activeWarnings(weather, now)` – already filtered and sorted. */
  warnings: WeatherWarning[]
  now: number
}) {
  const t = useTranslations("map.weather")
  const locale = useLocale()
  const intlLocale = useIntlLocale()
  const validity = useValidity()
  if (warnings.length === 0) return null

  const top = warnings[0]
  const topText = warningText(top, locale)
  const anyStale = warnings.some((w) => warningIsStale(weather, w, now))
  const summary = `${topText.event || topText.headline} · ${validity(top, now)}`

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={t("chipAria", { count: warnings.length, summary })}
          title={summary}
          className={cn(
            "flex h-8 max-w-[min(20rem,calc(100vw-6rem))] items-center gap-1.5 rounded-full border border-border bg-card/95 pl-2.5 pr-3 text-xs font-medium text-foreground shadow-md backdrop-blur-sm hover:bg-card pointer-coarse:h-9",
            anyStale && "text-muted-foreground",
          )}
        >
          <LevelDot level={top.level} stale={anyStale} />
          <span className="min-w-0 truncate">{topText.event || topText.headline}</span>
          <span className="shrink-0 text-muted-foreground">· {validity(top, now)}</span>
          {warnings.length > 1 && (
            <span className="shrink-0 tabular-nums text-muted-foreground">{t("more", { count: warnings.length - 1 })}</span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        collisionPadding={8}
        className="max-h-[min(32rem,70vh)] w-[min(24rem,calc(100vw-1.5rem))] overflow-y-auto p-0"
      >
        <ul className="divide-y divide-border">
          {warnings.map((warning) => {
            const text = warningText(warning, locale)
            const stale = warningIsStale(weather, warning, now)
            return (
              <li key={warning.id} className={cn("space-y-2 p-3 text-sm", stale && "opacity-70")}>
                <div className="flex items-start gap-2">
                  <LevelDot level={warning.level} stale={stale} />
                  <div className="min-w-0 -mt-1">
                    <p className="font-semibold break-words">{text.headline || text.event}</p>
                    <p className="text-xs text-muted-foreground">
                      {/* The colour words are MeteoAlarm's scale. Alertswiss has none of its own
                          on the board, so its alerts are named for what they are. */}
                      {warning.source === "alertswiss"
                        ? t("authorityNotice")
                        : warning.level >= 4
                        ? t("level4")
                        : warning.level === 3
                          ? t("level3")
                          : warning.level === 2
                            ? t("level2")
                            : t("level1")}
                      {warning.region ? ` · ${warning.region}` : ""}
                    </p>
                  </div>
                </div>
                <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
                  <dt className="text-muted-foreground">{t("validity")}</dt>
                  <dd>
                    {warning.onset ? `${formatWeatherTime(warning.onset, intlLocale, now)} – ` : ""}
                    {warning.expires ? formatWeatherTime(warning.expires, intlLocale, now) : t("untilRevoked")}
                  </dd>
                  <dt className="text-muted-foreground">{t("source")}</dt>
                  <dd className="break-words">
                    {warning.source === "meteoswiss"
                      ? t("sourceMeteoswiss")
                      : t("sourceAlertswiss", { publisher: warning.sender })}
                  </dd>
                </dl>
                {/* Verbatim: line breaks as the source set them, nothing cut. */}
                {text.description && <p className="whitespace-pre-line break-words">{text.description}</p>}
                {text.instructions.length > 0 && (
                  <ul className="list-disc space-y-1 pl-4">
                    {text.instructions.map((line, i) => (
                      <li key={i} className="whitespace-pre-line break-words">
                        {line}
                      </li>
                    ))}
                  </ul>
                )}
                {stale && warning.fetched_at && (
                  <p className="text-xs font-medium text-muted-foreground">
                    {t("warningStale", { time: formatWeatherTime(warning.fetched_at, intlLocale, now) })}
                  </p>
                )}
                {warning.link && (
                  <a
                    href={warning.link.startsWith("http") ? warning.link : `https://${warning.link}`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-xs underline underline-offset-2 hover:text-foreground"
                  >
                    {t("moreInfo")}
                    <ExternalLink className="size-3" aria-hidden />
                  </a>
                )}
              </li>
            )
          })}
        </ul>
        <p className="border-t border-border px-3 py-2 text-[11px] text-muted-foreground">{t("verbatimNote")}</p>
      </PopoverContent>
    </Popover>
  )
}
