"use client"

/**
 * The radar's own small panel, bottom-left on the map while the «Wetter» layer is on:
 * ▶/❚❚ over the last hour, a scrubber with the frame's time, opacity, the colour key and the
 * source. Bottom-left because every other corner is taken (zoom + fit-all top-left, the chip
 * row top-right, legend and ⓘ bottom-right).
 *
 * Calm by default: it opens PAUSED on the newest frame. The loop runs only when somebody asks
 * for it, and a scrubbed-back frame always says how old it is («−40 min»), so a past picture is
 * never read as the current one.
 */

import { useCallback, useEffect, useRef, useState } from "react"
import { Pause, Play } from "lucide-react"
import { useTranslations } from "next-intl"
import { Slider } from "@/components/ui/slider"
import { useIntlLocale } from "@/lib/date-locale"
import { formatWeatherTime, frameAgeMinutes, latestFrameIndex, type WeatherRadar } from "@/lib/weather"
import { cn } from "@/lib/utils"

const STEP_MS = 650
/** The shared Slider fills with `--primary`, which is the fire-service red here – reserved for
 *  priority and danger. A scrubber is neither, so it wears the slate selection line. */
const SLATE_SLIDER = "[&_[data-slot=slider-range]]:bg-sel-line [&_[data-slot=slider-thumb]]:border-sel-line"
/** Extra ticks the loop rests on the newest frame before starting over. */
const HOLD_TICKS = 3

/**
 * Frame selection + loop. Follows the newest frame as new ones arrive – unless the operator
 * scrubbed back, then it stays ON THAT FRAME. The pick is stored as the frame's key, not its
 * position: every 5 minutes the hour shifts by one (oldest out, newest in), and a stored index
 * would silently slide to a frame five minutes later. A picked frame that has aged out of the
 * hour falls back to «now».
 */
export function useRadarPlayback(radar: WeatherRadar | null | undefined) {
  const frames = radar?.frames
  const latest = latestFrameIndex(radar)
  const [pickedKey, setPickedKey] = useState<string | null>(null) // null = follow the newest
  const [playing, setPlaying] = useState(false)
  const hold = useRef(0)
  const pickedIndex = pickedKey === null || !frames ? -1 : frames.findIndex((f) => f.key === pickedKey)
  const frameIndex = pickedIndex >= 0 ? pickedIndex : latest

  // The interval reads index and frames through refs, so the step itself is a plain setState –
  // no side effects inside an updater (StrictMode runs those twice).
  const indexRef = useRef(frameIndex)
  const framesRef = useRef(frames)
  useEffect(() => {
    indexRef.current = frameIndex
    framesRef.current = frames
  }, [frameIndex, frames])

  useEffect(() => {
    if (!playing || latest < 1) return
    const timer = setInterval(() => {
      const list = framesRef.current ?? []
      const index = indexRef.current
      const last = list.length - 1
      if (index < last) {
        setPickedKey(list[index + 1].key)
      } else if (hold.current < HOLD_TICKS) {
        hold.current += 1
      } else {
        hold.current = 0
        setPickedKey(list[0]?.key ?? null)
      }
    }, STEP_MS)
    return () => clearInterval(timer)
  }, [playing, latest])

  const pick = useCallback(
    (index: number) => {
      setPlaying(false)
      setPickedKey(index >= latest ? null : frames?.[index]?.key ?? null)
    },
    [latest, frames],
  )
  const togglePlaying = useCallback(() => {
    hold.current = 0
    if (playing) {
      // Stopping lands back on «now» – the state the panel is calm in.
      setPlaying(false)
      setPickedKey(null)
    } else {
      setPlaying(true)
    }
  }, [playing])

  return { frameIndex, playing, pick, togglePlaying }
}

export function WeatherRadarControls({
  radar,
  frameIndex,
  playing,
  onPick,
  onTogglePlaying,
  opacity,
  onOpacityChange,
  stale,
  now,
}: {
  radar: WeatherRadar | null
  frameIndex: number
  playing: boolean
  onPick: (index: number) => void
  onTogglePlaying: () => void
  opacity: number
  onOpacityChange: (opacity: number) => void
  stale: boolean
  now: number
}) {
  const t = useTranslations("map.weather")
  const intlLocale = useIntlLocale()
  const frames = radar?.frames ?? []
  const frame = frames[frameIndex]
  const age = radar && frame ? frameAgeMinutes(radar, frameIndex) : 0

  let status: string | null = null
  if (!radar || frames.length === 0) {
    status = radar?.status.last_error ? t("radarUnavailable") : t("radarPending")
  } else if (stale && radar.data_time) {
    status = t("stale", { time: formatWeatherTime(radar.data_time, intlLocale, now) })
  }

  return (
    <div
      className="absolute bottom-2.5 left-2.5 z-30 w-64 max-w-[calc(100%-5rem)] max-sm:w-56 rounded-lg border border-border bg-card/95 p-2.5 text-xs text-foreground shadow-md backdrop-blur-sm"
      role="group"
      aria-label={t("radarTitle")}
      // Map chrome: dragging the scrubber must never pan the map underneath.
      onPointerDown={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
    >
      {frames.length > 0 && (
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onTogglePlaying}
            disabled={frames.length < 2}
            className="flex size-7 shrink-0 items-center justify-center rounded-sm border border-border bg-background/60 hover:bg-muted disabled:opacity-50"
            aria-label={playing ? t("pause") : t("play")}
            title={playing ? t("pause") : t("play")}
          >
            {playing ? <Pause className="size-3.5" aria-hidden /> : <Play className="size-3.5" aria-hidden />}
          </button>
          <Slider
            min={0}
            max={Math.max(frames.length - 1, 0)}
            step={1}
            value={[frameIndex]}
            onValueChange={([value]) => onPick(value)}
            aria-label={t("frameSlider")}
            className={cn("min-w-0 flex-1", SLATE_SLIDER)}
          />
          <span
            className={cn("shrink-0 text-right font-mono tabular-nums", stale && "text-muted-foreground")}
            aria-live={playing ? "off" : "polite"}
          >
            {frame ? formatWeatherTime(frame.time, intlLocale, now) : ""}
          </span>
        </div>
      )}
      {frames.length > 0 && (
        <div className="mt-1 flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
          <span className="tabular-nums">{age > 0 ? t("frameAgo", { minutes: age }) : t("latest")}</span>
          {/* Phone: the map is 45vh and only looked at – opacity and the colour key stay
              desktop tools so the panel does not cover the town. */}
          <label className="flex min-w-0 items-center gap-1.5 max-sm:hidden">
            <span>{t("opacity")}</span>
            <Slider
              min={20}
              max={100}
              step={10}
              value={[Math.round(opacity * 100)]}
              onValueChange={([value]) => onOpacityChange(value / 100)}
              aria-label={t("opacity")}
              className={cn("w-16", SLATE_SLIDER)}
            />
          </label>
        </div>
      )}
      {radar && radar.legend.length > 0 && (
        <div className="mt-2 max-sm:hidden" aria-hidden>
          <div
            className={cn("h-1.5 rounded-full", stale && "grayscale")}
            style={{ background: `linear-gradient(to right, ${radar.legend.map((step) => step.color).join(", ")})` }}
          />
          <div className="mt-0.5 flex justify-between text-[10px] text-muted-foreground">
            <span>{t("legendLight")}</span>
            <span>{t("legendUnit")}</span>
            <span>{t("legendHeavy")}</span>
          </div>
        </div>
      )}
      {status && <p className="mt-1.5 text-[11px] font-medium text-muted-foreground">{status}</p>}
      {/* CC BY 4.0: the source is named whenever the radar is on. */}
      <p className="mt-1 text-[10px] text-muted-foreground">
        <a
          href={radar?.source_url ?? "https://www.meteoschweiz.admin.ch"}
          target="_blank"
          rel="noreferrer"
          className="underline-offset-2 hover:text-foreground hover:underline"
        >
          {t("radarSource")}
        </a>
      </p>
    </div>
  )
}
